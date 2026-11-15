"""Natural radiation shelters: how much of the sky does terrain hide at each point?

Radiation on Mars comes down from the sky, so a cliff or a crater wall that hides part
of the sky also blocks part of the dose. Curiosity's RAD measured this beside butte M12
in the Murray Buttes: 19% of the sky hidden, 4-5% less dose (Ehresmann et al. 2021,
https://doi.org/10.1029/2021JE006851; Guo et al. 2021, https://doi.org/10.1029/2021GL093912).
scripts/validate-rad-shielding.py shows the same sky fraction comes out of elevation data.

This script turns that into a map: for every cell, the horizon angle on 36 azimuths and
the fraction of the sky hemisphere below it (mean of sin(horizon)), for an observer 1 m
above the ground (the same height as the validation).

  jezero-context   bundled 16 m Jezero grid; terrain out to 15 km
  jezero-landing   1 m grid around the landing site: 1 m terrain within 120 m,
                   16 m terrain beyond; stored at 2 m, cropped 120 m in from the edge
  quela            1 m patch at Curiosity's RAD measurement site (Gale), for the in-app check

Output: public/data/shield/<id>.png (value = round(skyBlocked * 400), 255 = no data)
        public/data/shield/shield.json
Needs numpy, Pillow (and the cached 1 m rows from validate-rad-shielding.py for quela).
"""
from pathlib import Path
import gzip, importlib.util, json, math, time
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'data' / 'shield'; OUT.mkdir(parents=True, exist_ok=True)
R = 3396190.0
OBSERVER = 1.0
AZIMUTHS = np.radians(np.arange(0, 360, 10.0))
NEAR = 120
REACH = 15000


def load(site, index):
    meta = json.loads((ROOT / 'public' / 'terrain' / f'{site}.json').read_text())['datasets'][index]
    q = np.frombuffer(gzip.decompress((ROOT / 'public' / meta['url']).read_bytes()), dtype='<u2').reshape(meta['height'], meta['width'])
    z = q.astype(np.float32) * meta['scale'] + meta['offset']; z[q == meta['nodata']] = np.nan
    return meta, z


def steps(first, linear_until, reach, ratio):
    d = list(np.arange(first, linear_until + first / 2, first))
    while d[-1] * ratio < reach: d.append(d[-1] * ratio)
    return np.array(d)


def self_horizon(z, step, lat0, distances, start=0.0):
    """Max tangent of the horizon per azimuth, terrain taken from the grid itself."""
    h, w = z.shape; dy = step; dx = step * math.cos(math.radians(lat0))
    pad = int(max(distances) / min(dx, dy)) + 2
    p = np.full((h + 2 * pad, w + 2 * pad), np.nan, dtype=np.float32); p[pad:pad + h, pad:pad + w] = z
    z0 = z + OBSERVER
    out = []
    for az in AZIMUTHS:
        best = np.full(z.shape, -np.inf, dtype=np.float32); seen = set()
        for d in distances:
            dr = -round(d * math.cos(az) / dy); dc = round(d * math.sin(az) / dx)
            if (dr, dc) in seen or (dr == 0 and dc == 0): continue
            seen.add((dr, dc))
            dist = math.hypot(dr * dy, dc * dx)
            if dist < start: continue
            view = p[pad + dr:pad + dr + h, pad + dc:pad + dc + w]
            np.fmax(best, (view - dist * dist / (2 * R) - z0) / dist, out=best)
        out.append(best)
    return out


def far_horizon(fine_meta, z_fine, coarse_meta, z_coarse, lat0, distances, sub=4):
    """Max tangent per azimuth for fine cells (subsampled by `sub`), terrain from the coarse grid."""
    zs = z_fine[::sub, ::sub]; h, w = zs.shape
    fx = fine_meta['x0'] + np.arange(w) * fine_meta['step'] * sub; fy = fine_meta['y0'] - np.arange(h) * fine_meta['step'] * sub
    cz = np.pad(z_coarse, 1, constant_values=np.nan); ch, cw = z_coarse.shape; cs = coarse_meta['step']
    z0 = zs + OBSERVER; k = math.cos(math.radians(lat0))
    out = []
    for az in AZIMUTHS:
        best = np.full(zs.shape, -np.inf, dtype=np.float32)
        for d in distances:
            cols = np.clip(np.round((fx + d * math.sin(az) / k - coarse_meta['x0']) / cs).astype(int) + 1, 0, cw + 1)
            rows = np.clip(np.round((coarse_meta['y0'] - (fy + d * math.cos(az))) / cs).astype(int) + 1, 0, ch + 1)
            np.fmax(best, (cz[rows[:, None], cols[None, :]] - d * d / (2 * R) - z0) / d, out=best)
        out.append(best)
    return out


def blocked(tangents):
    acc = np.zeros(tangents[0].shape, dtype=np.float32)
    for t in tangents:
        t = np.clip(np.nan_to_num(t, nan=0.0, neginf=0.0), 0, None)
        acc += t / np.sqrt(1 + t * t)
    return acc / len(tangents)


def save(name, sky, valid):
    q = np.clip(np.round(sky * 400), 0, 254).astype(np.uint8); q[~valid] = 255
    Image.fromarray(q).save(OUT / f'{name}.png', optimize=True)
    return (OUT / f'{name}.png').stat().st_size


def fine_map(fine_meta, z_fine, coarse_meta, z_coarse, lat0):
    near = self_horizon(z_fine, fine_meta['step'], lat0, steps(1, 40, NEAR, 1.05))
    far = far_horizon(fine_meta, z_fine, coarse_meta, z_coarse, lat0, steps(100, 100, REACH, 1.06))
    h, w = z_fine.shape
    both = [np.fmax(n, np.repeat(np.repeat(f, 4, axis=0), 4, axis=1)[:h, :w]) for n, f in zip(near, far)]
    return blocked(both)


def main():
    t0 = time.time(); grids = []
    cm, cz = load('jezero', 0); lat0 = math.degrees((cm['y0'] - cm['height'] * cm['step'] / 2) / R)
    sky = blocked(self_horizon(cz, cm['step'], lat0, steps(cm['step'], 40 * cm['step'], REACH, 1.06)))
    size = save('jezero-context', sky, np.isfinite(cz))
    grids.append({'id': 'jezero-context', 'site': 'Jezero', 'file': 'jezero-context.png', 'x0': cm['x0'], 'y0': cm['y0'], 'step': cm['step'], 'width': cm['width'], 'height': cm['height']})
    v = sky[np.isfinite(cz)]
    print(f"jezero-context {sky.shape} median {np.median(v):.1%} p95 {np.percentile(v, 95):.1%} max {v.max():.1%} {size / 1e3:.0f} kB {time.time() - t0:.0f}s", flush=True)

    fm, fz = load('jezero', 1)
    sky = fine_map(fm, fz, cm, cz, lat0)
    crop = NEAR; sky = sky[crop:-crop, crop:-crop]; ok = np.isfinite(fz[crop:-crop, crop:-crop])
    hh, ww = (sky.shape[0] // 2) * 2, (sky.shape[1] // 2) * 2
    pooled = sky[:hh, :ww].reshape(hh // 2, 2, ww // 2, 2).mean(axis=(1, 3)); okp = ok[:hh, :ww].reshape(hh // 2, 2, ww // 2, 2).all(axis=(1, 3))
    size = save('jezero-landing', pooled, okp)
    grids.append({'id': 'jezero-landing', 'site': 'Jezero', 'file': 'jezero-landing.png', 'x0': fm['x0'] + crop + .5, 'y0': fm['y0'] - crop - .5, 'step': 2, 'width': ww // 2, 'height': hh // 2})
    print(f"jezero-landing {pooled.shape} median {np.median(pooled[okp]):.1%} p95 {np.percentile(pooled[okp], 95):.1%} max {pooled[okp].max():.1%} {size / 1e3:.0f} kB {time.time() - t0:.0f}s", flush=True)

    try:
        spec = importlib.util.spec_from_file_location('v', ROOT / 'scripts' / 'validate-rad-shielding.py'); val = importlib.util.module_from_spec(spec); spec.loader.exec_module(val)
        gm, gz = load('gale', 0); lon, lat = val.QUELA; half = 305
        win = val.window(lon, lat, half)
        W, offsets, counts, X, Y = val.open_dem()
        col, row = round(math.radians(lon) * R - X - .5), round(Y - .5 - math.radians(lat) * R)
        qm = {'x0': X + (col - half) + .5, 'y0': Y - (row - half) - .5, 'step': 1}
        sky = fine_map(qm, win, gm, gz, lat)
        at_rover = float(sky[half, half])
        sky = sky[crop:-crop, crop:-crop]; ok = np.isfinite(win[crop:-crop, crop:-crop])
        size = save('quela', sky, ok)
        grids.append({'id': 'quela', 'site': 'Gale', 'file': 'quela.png', 'x0': qm['x0'] + crop, 'y0': qm['y0'] - crop, 'step': 1, 'width': sky.shape[1], 'height': sky.shape[0],
                      'rover': {'lon': lon, 'lat': lat, 'mapValue': round(at_rover, 4)}})
        print(f"quela {sky.shape} at the rover {at_rover:.1%} (full 360-azimuth check: see validation.json) {size / 1e3:.0f} kB {time.time() - t0:.0f}s", flush=True)
    except Exception as error:
        print('quela patch skipped:', error)

    json.dump({
        'title': 'Sky hidden by terrain (natural radiation shelter)',
        'method': f'Horizon angle on {len(AZIMUTHS)} azimuths, observer {OBSERVER} m above ground, planet curvature included. Value = fraction of the sky hemisphere below the horizon (mean of sin(horizon)).',
        'encoding': 'PNG value / 400 = sky blocked; 255 = no data',
        'radius': R, 'grids': grids,
        'sources': ['NASA/USGS Jezero HiRISE DTM (Mars 2020 TRN)', 'USGS MSL Gale merged DEM 1 m v3', 'Ehresmann et al. 2021, JGR Planets, 10.1029/2021JE006851', 'Guo et al. 2021, GRL, 10.1029/2021GL093912'],
    }, open(OUT / 'shield.json', 'w', encoding='utf8'), indent=1)
    print('done', f'{time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
