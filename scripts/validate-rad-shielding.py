"""Does terrain-blocked sky computed from an orbital DTM match what Curiosity's RAD saw?

Ground truth (the only in-situ measurement of natural radiation shielding on Mars):
  Ehresmann, B., et al. (2021), Natural radiation shielding on Mars measured with the
  MSL/RAD instrument, JGR Planets 126, e2021JE006851, https://doi.org/10.1029/2021JE006851
  Guo, J., et al. (2021), Directionality of the Martian surface radiation and derivation of
  the upward albedo radiation, GRL 48, e2021GL093912, https://doi.org/10.1029/2021GL093912
While Curiosity was parked beside butte M12 in the Murray Buttes (sols 1456-1467, the Quela
drill site), a sky-visibility map built from the rover's own panoramas showed 19% of the sky
blocked (against ~10% in an average reference period) and RAD measured a 4-5% lower dose rate.

This script computes the same quantity, the fraction of the sky hemisphere hidden by terrain,
from elevation data alone: the USGS MSL Gale merged DEM at 1 m near the rover (fetched with
HTTP range requests, ~600 rows) and the app's bundled 16 m Gale grid for distant terrain
(Mount Sharp, the crater rim). No tuning: observer height is RAD's height on the rover deck.

Output: public/data/shield/validation.json
Needs numpy, requests, imagecodecs. Usage: python scripts/validate-rad-shielding.py
"""
from pathlib import Path
import concurrent.futures, gzip, json, math, os, struct, tempfile, threading, time
import numpy as np
import requests
import imagecodecs

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir()) / 'martisdux-work' / 'gale-build'; WORK.mkdir(parents=True, exist_ok=True)
MSL = WORK.parent / 'msl'
OUT = ROOT / 'public' / 'data' / 'shield'; OUT.mkdir(parents=True, exist_ok=True)
URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
SIZE = 3868256546; IFD = 3867795758
R = 3396190.0
NEAR = 300
OBSERVER = 1.0
QUELA = (137.3530064, -4.69520223)
clients = threading.local()


def read_range(first, last):
    for attempt in range(6):
        try:
            if not hasattr(clients, 'session'): clients.session = requests.Session()
            r = clients.session.get(URL, headers={'Range': f'bytes={first}-{last}'}, timeout=60)
            if r.status_code != 206 or len(r.content) != last - first + 1: raise ValueError('Expected an exact HTTP byte range')
            return r.content
        except Exception:
            if attempt == 5: raise
            time.sleep(2 * (attempt + 1))


def open_dem():
    tail = read_range(IFD, SIZE - 1)
    count = struct.unpack_from('<H', tail, 0)[0]
    tags = {}
    for i in range(count):
        tag, kind, n, value = struct.unpack_from('<HHII', tail, 2 + 12 * i); tags[tag] = (kind, n, value)
    W = tags[256][2]
    arr = lambda tag: np.frombuffer(tail[tags[tag][2] - IFD:tags[tag][2] - IFD + 4 * tags[tag][1]], dtype='<u4')
    tie = struct.unpack_from('<6d', tail, tags[33922][2] - IFD)
    return W, arr(273), arr(279), tie[3], tie[4]


def window(lon, lat, half):
    """1 m heights in a (2*half+1)^2 window centred on lon/lat. Rows are cached on disk."""
    W, offsets, counts, X, Y = open_dem()
    col, row = round(math.radians(lon) * R - X - .5), round(Y - .5 - math.radians(lat) * R)

    def get_row(r):
        path = WORK / f'{r}.row'
        if path.exists(): return np.frombuffer(path.read_bytes(), dtype='<f4')
        data = imagecodecs.lzw_decode(read_range(int(offsets[r]), int(offsets[r]) + int(counts[r]) - 1))
        line = np.frombuffer(data, dtype='<f4', count=W)
        path.write_bytes(line.tobytes())
        return line

    rows = list(range(row - half, row + half + 1))
    out = np.empty((len(rows), 2 * half + 1), dtype=np.float32)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for i, line in enumerate(pool.map(get_row, rows)):
            out[i] = line[col - half:col + half + 1]
            if i % 100 == 0: print('rows', i, len(rows), flush=True)
    out[(out < -20000) | (out > 30000)] = np.nan
    return out


def context():
    meta = json.loads((ROOT / 'public' / 'terrain' / 'gale.json').read_text())['datasets'][0]
    q = np.frombuffer(gzip.decompress((ROOT / 'public' / 'terrain' / 'gale-context.u16.gz').read_bytes()), dtype='<u2').reshape(meta['height'], meta['width'])
    z = q.astype(np.float32) * meta['scale'] + meta['offset']; z[q == meta['nodata']] = np.nan
    return meta, z


def far_profile(meta, z, lon, lat, z0, azimuths, start, reach=60000):
    """Horizon elevation angle (rad) per azimuth from the 16 m grid, from `start` m outwards."""
    x = math.radians(lon) * R; y = math.radians(lat) * R; step = meta['step']
    d = np.arange(max(start, step), reach, step, dtype=np.float64)
    out = np.zeros(len(azimuths))
    for k, az in enumerate(azimuths):
        cols = np.round((x + d * math.sin(az) / math.cos(math.radians(lat)) - meta['x0']) / step).astype(int)
        rows = np.round((meta['y0'] - (y + d * math.cos(az))) / step).astype(int)
        ok = (cols >= 0) & (cols < meta['width']) & (rows >= 0) & (rows < meta['height'])
        h = np.full(len(d), np.nan); h[ok] = z[rows[ok], cols[ok]]
        ang = np.arctan2(h - d * d / (2 * R) - z0, d)
        out[k] = np.nanmax(ang) if np.isfinite(ang).any() else 0.0
    return out


def near_profile(win, azimuths, z0, reach):
    c = win.shape[0] // 2
    d = np.arange(1.0, reach, 1.0)
    out = np.zeros(len(azimuths))
    for k, az in enumerate(azimuths):
        cols = np.round(c + d * math.sin(az)).astype(int); rows = np.round(c - d * math.cos(az)).astype(int)
        ang = np.arctan2(win[rows, cols] - z0, d)
        out[k] = np.nanmax(ang) if np.isfinite(ang).any() else 0.0
    return out


def blocked(horizon):
    """Fraction of the sky hemisphere (solid angle) below the terrain horizon."""
    return float(np.mean(np.sin(np.clip(horizon, 0, None))))


def main():
    az = np.radians(np.arange(0, 360, 1.0))
    meta, z = context()
    lon, lat = QUELA
    win = window(lon, lat, NEAR + 5)
    c = win.shape[0] // 2
    ground = float(np.nanmean(win[c - 1:c + 2, c - 1:c + 2]))
    z0 = ground + OBSERVER
    near = near_profile(win, az, z0, NEAR)
    far = far_profile(meta, z, lon, lat, z0, az, NEAR)
    both = np.maximum(near, far)
    result = {'sky': blocked(both), 'near': blocked(near), 'far': blocked(far)}
    spread = {}
    for dy in range(-4, 5, 2):
        for dx in range(-4, 5, 2):
            w2 = np.roll(np.roll(win, -dy, axis=0), -dx, axis=1)
            h0 = float(np.nanmean(w2[c - 1:c + 2, c - 1:c + 2])) + OBSERVER
            spread[(dx, dy)] = blocked(np.maximum(near_profile(w2, az, h0, NEAR - 6), far_profile(meta, z, lon, lat, h0, az, NEAR - 6)))
    ring = lambda r: [v for (dx, dy), v in spread.items() if math.hypot(dx, dy) <= r]
    heights = {str(h): blocked(np.maximum(near_profile(win, az, ground + h, NEAR), far_profile(meta, z, lon, lat, ground + h, az, NEAR))) for h in (0.5, 1.5, 2.0)}
    print(f"Sensitivity: within 2 m of the waypoint {min(ring(2)):.1%}-{max(ring(2)):.1%}; within 4 m {min(ring(4)):.1%}-{max(ring(4)):.1%}; detector 0.5-2 m high {heights['0.5']:.1%}-{heights['2.0']:.1%}")
    print(f"Quela, sols 1456-1467: sky blocked {result['sky']:.1%} (near field alone {result['near']:.1%}, distant terrain alone {result['far']:.1%}); RAD team: 19%")

    ref = []
    try:
        feats = json.loads((MSL / 'MSL_waypoints.json').read_text(encoding='utf8'))['features']
        for f in feats[::4]:
            p = f['properties']; lo, la = p['lon'], p['lat']
            col = round((math.radians(lo) * R - meta['x0']) / meta['step']); row = round((meta['y0'] - math.radians(la) * R) / meta['step'])
            if not (0 <= col < meta['width'] and 0 <= row < meta['height']) or not np.isfinite(z[row, col]): continue
            ref.append({'sol': p['sol'], 'sky': blocked(far_profile(meta, z, lo, la, float(z[row, col]) + OBSERVER, az[::4], meta['step']))})
    except FileNotFoundError:
        print('MSL_waypoints.json not cached: reference skipped')
    ref_values = np.array([r['sky'] for r in ref]) if ref else np.array([np.nan])
    print(f"Reference, {len(ref)} waypoints on the 16 m grid: median {np.nanmedian(ref_values):.1%}, mean {np.nanmean(ref_values):.1%}; RAD team's average reference: ~10%")

    profile = [{'az': a, 'deg': round(float(np.degrees(np.max(both[a:a + 5]))), 1)} for a in range(0, 360, 5)]
    json.dump({
        'question': "Does sky blocked by terrain, computed from orbital elevation data, match the sky-visibility map Curiosity's RAD team built from the rover's panoramas?",
        'site': {'name': 'Quela drill site, butte M12, Murray Buttes (Gale crater)', 'lon': lon, 'lat': lat, 'sols': '1456-1467'},
        'measured': {'skyBlocked': 0.19, 'referenceSkyBlocked': 0.10, 'doseDrop': 0.04, 'doseDropGuo': 0.05, 'neutralDrop': 0.075,
                     'sources': ['https://doi.org/10.1029/2021JE006851', 'https://doi.org/10.1029/2021GL093912']},
        'computed': {'skyBlocked': round(result['sky'], 4), 'nearFieldOnly': round(result['near'], 4), 'distantTerrainOnly': round(result['far'], 4),
                     'within2m': [round(min(ring(2)), 4), round(max(ring(2)), 4)], 'within4m': [round(min(ring(4)), 4), round(max(ring(4)), 4)],
                     'observerHalfMetre': round(heights['0.5'], 4), 'observerTwoMetres': round(heights['2.0'], 4),
                     'referenceMedian': round(float(np.nanmedian(ref_values)), 4), 'referenceMean': round(float(np.nanmean(ref_values)), 4), 'referenceCount': len(ref)},
        'method': f'Horizon angle on 360 azimuths: USGS MSL Gale merged DEM 1 m within {NEAR} m, bundled 16 m grid beyond (to 60 km), planet curvature included, observer {OBSERVER} m above ground. Sky blocked = mean of sin(horizon angle), the solid-angle fraction of the hemisphere.',
        'profile': profile,
    }, open(OUT / 'validation.json', 'w', encoding='utf8'), indent=1)
    print('wrote', OUT / 'validation.json')


if __name__ == '__main__':
    main()
