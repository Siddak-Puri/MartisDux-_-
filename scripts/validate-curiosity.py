"""Second ground-truth site: orbital Gale DTM slope vs. Curiosity's measured tilt.

Same method as validate-perseverance.py, applied to a different rover, crater,
DTM and terrain (Gale crater floor and the climb up Mount Sharp):
for every Curiosity waypoint inside the USGS MSL Gale Merged DEM 1 m (v3),
read native 1 m samples around the rover position (exact HTTP byte ranges of
the LZW strips, no resampling), fit a plane over rover-/walker-sized discs, and
compare with the rover attitude (tilt) in NASA's MMGIS MSL waypoint record.

Outputs: public/data/curiosity/validation.json, public/data/curiosity/traverse.json
Requires numpy, requests, imagecodecs.  Run: python -I scripts/validate-curiosity.py
"""
from pathlib import Path
import concurrent.futures, datetime, hashlib, json, math, os, struct, threading, time
from collections import defaultdict
import numpy as np
import requests
import imagecodecs

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'msl'
WORK.mkdir(parents=True, exist_ok=True)
OUT = ROOT / 'public' / 'data' / 'curiosity'; OUT.mkdir(parents=True, exist_ok=True)

MMGIS = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/'
URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
SOURCE = 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
SIZE = 3868256546; IFD = 3867795758
R = 3396190.0
HALF = 16
NODATA = -32767
clients = threading.local()


def read_range(first, last):
    for attempt in range(5):
        try:
            if not hasattr(clients, 'session'): clients.session = requests.Session()
            r = clients.session.get(URL, headers={'Range': f'bytes={first}-{last}'}, timeout=60)
            if r.status_code != 206 or len(r.content) != last - first + 1: raise ValueError('Expected an exact HTTP byte range')
            return r.content
        except Exception:
            if attempt == 4: raise
            time.sleep(2 * (attempt + 1))


def fetch(name):
    path = WORK / name
    if not path.exists():
        r = requests.get(MMGIS + name, timeout=60); r.raise_for_status(); path.write_bytes(r.content)
    return path


tail = read_range(IFD, SIZE - 1)
tags = {}
for i in range(struct.unpack_from('<H', tail, 0)[0]):
    tag, kind, n, value = struct.unpack_from('<HHII', tail, 2 + 12 * i); tags[tag] = (kind, n, value)
W, H = tags[256][2], tags[257][2]
assert tags[259][2] == 5 and tags[339][2] == 3 and tags[258][2] == 32 and tags[278][2] == 1
arr = lambda tag: np.frombuffer(tail[tags[tag][2] - IFD:tags[tag][2] - IFD + 4 * tags[tag][1]], dtype='<u4')
offsets, counts = arr(273), arr(279)
tie = struct.unpack_from('<6d', tail, tags[33922][2] - IFD)
X, Y = tie[3], tie[4]

def pixel(lat, lon):
    return round(math.radians(lon) * R - X - .5), round(Y - .5 - math.radians(lat) * R)

load = lambda name: json.loads(fetch(name).read_bytes().decode('utf-8-sig'))
waypoints = [f['properties'] for f in load('MSL_waypoints.json')['features']]
traverse = load('MSL_traverse.json')['features']

seen, jobs = set(), []
for p in waypoints:
    if p.get('tilt') is None: continue
    col, row = pixel(p['lat'], p['lon'])
    if (col, row) in seen or not (HALF <= col < W - HALF and HALF <= row < H - HALF): continue
    seen.add((col, row)); jobs.append((p, col, row))
print('waypoints', len(waypoints), 'unique inside DTM', len(jobs), flush=True)

windows = {}
cache = WORK / f'windows-{HALF}.npz'
if cache.exists():
    data = np.load(cache)
    windows = {tuple(map(int, k.split('_'))): data[k] for k in data.files}
todo = [(c, r) for _, c, r in jobs if (c, r) not in windows]
need = defaultdict(list)
for c, r in todo:
    for k in range(2 * HALF + 1): need[r - HALF + k].append((c, r, k))
for c, r in todo: windows[(c, r)] = np.full((2 * HALF + 1, 2 * HALF + 1), np.nan, dtype=np.float32)
print('rows to read', len(need), flush=True)
bad = []

def get_row(r):
    try:
        data = imagecodecs.lzw_decode(read_range(int(offsets[r]), int(offsets[r]) + int(counts[r]) - 1))
        return r, np.frombuffer(data, dtype='<f4', count=W)
    except Exception as error:
        bad.append(r); print(f'row {r}: {error}', flush=True); return r, None

with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    for i, (r, row) in enumerate(pool.map(get_row, sorted(need))):
        if row is not None:
            for c, wr, k in need[r]:
                windows[(c, wr)][k] = row[c - HALF:c + HALF + 1]
        if i % 1000 == 0: print(f'  {i}/{len(need)}', flush=True)
for z in windows.values():
    z[~np.isfinite(z) | (z <= NODATA + 1) | (z < -20000) | (z > 30000)] = np.nan
np.savez_compressed(cache, **{f'{c}_{r}': z for (c, r), z in windows.items()})


def plane_slope(z, radius, dx):
    c = HALF; ys, xs = np.mgrid[-c:c + 1, -c:c + 1]
    mask = (xs ** 2 + ys ** 2 <= radius ** 2) & np.isfinite(z)
    if mask.sum() < 0.9 * (np.pi * radius ** 2): return float('nan')
    A = np.column_stack([xs[mask] * dx, -ys[mask] * 1.0, np.ones(mask.sum())])
    (gx, gy, _), *_ = np.linalg.lstsq(A, z[mask].astype(np.float64), rcond=None)
    return math.degrees(math.atan(math.hypot(gx, gy)))


def horn16(z, dx):
    c = HALF; e = lambda dr, dc: z[c + dr * 16, c + dc * 16]
    a, b, cc, d, f, g, h, k = e(-1, -1), e(-1, 0), e(-1, 1), e(0, -1), e(0, 1), e(1, -1), e(1, 0), e(1, 1)
    gx = ((cc + 2 * f + k) - (a + 2 * d + g)) / (8 * 16 * dx)
    gy = ((g + 2 * h + k) - (a + 2 * b + cc)) / (8 * 16)
    return math.degrees(math.atan(math.hypot(gx, gy)))


rows = []
for p, col, row in jobs:
    z = windows[(col, row)]
    dx = math.cos(math.radians(p['lat']))
    s3, s5, s9, s16 = plane_slope(z, 1.6, dx), plane_slope(z, 2.6, dx), plane_slope(z, 4.6, dx), horn16(z, dx)
    if not all(map(math.isfinite, (s3, s5, s16))): continue
    rows.append({'rmc': p['RMC'], 'sol': p['sol'], 'lat': round(p['lat'], 7), 'lon': round(p['lon'], 7),
                 'tilt': round(p['tilt'], 2), 'pitch': round(p['pitch'], 2), 'roll': round(p['roll'], 2), 'yaw': round(p['yaw'], 1),
                 'dist': round(p['dist_total_m'], 1), 'dtm3': round(s3, 2), 'dtm5': round(s5, 2),
                 'dtm9': round(s9, 2) if math.isfinite(s9) else None, 'dtm16': round(s16, 2)})


def stats(key):
    a = np.array([r['tilt'] for r in rows if r[key] is not None]); b = np.array([r[key] for r in rows if r[key] is not None])
    err = b - a
    rank = lambda v: np.argsort(np.argsort(v))
    cls = lambda v: np.digitize(v, [10, 20, 30])
    return {'n': int(len(a)), 'pearson': round(float(np.corrcoef(a, b)[0, 1]), 3),
            'spearman': round(float(np.corrcoef(rank(a), rank(b))[0, 1]), 3),
            'bias': round(float(err.mean()), 2), 'mae': round(float(np.abs(err).mean()), 2),
            'medianAbs': round(float(np.median(np.abs(err))), 2), 'rmse': round(float(np.sqrt((err ** 2).mean())), 2),
            'within2': round(float((np.abs(err) <= 2).mean()), 3), 'within3': round(float((np.abs(err) <= 3).mean()), 3),
            'within5': round(float((np.abs(err) <= 5).mean()), 3),
            'classAgreement': round(float((cls(a) == cls(b)).mean()), 3),
            'missedSteep': int(((a >= 10) & (b < 10)).sum()), 'roverSteep': int((a >= 10).sum())}


tilts = np.array([r['tilt'] for r in rows])
summary = {
    'generated': datetime.date.today().isoformat(),
    'question': 'Does slope measured from orbit (Gale 1 m DTM) match the tilt Curiosity actually experienced on the ground?',
    'rover': 'Curiosity', 'site': 'Gale crater / Mount Sharp',
    'waypoints': len(waypoints), 'compared': len(rows), 'lastSol': max(p['sol'] for p in waypoints),
    'baseline': {'label': 'No-skill guess: every waypoint = median rover tilt', 'mae': round(float(np.abs(tilts - np.median(tilts)).mean()), 2),
                 'within2': round(float((np.abs(tilts - np.median(tilts)) <= 2).mean()), 3)},
    'roverTilt': {'mean': round(float(tilts.mean()), 2), 'median': round(float(np.median(tilts)), 2), 'p95': round(float(np.percentile(tilts, 95)), 2), 'max': round(float(tilts.max()), 2)},
    'footprints': {
        'dtm3': {'label': '3 m disc (rover-sized plane fit)', **stats('dtm3')},
        'dtm5': {'label': '5 m disc plane fit', **stats('dtm5')},
        'dtm9': {'label': '9 m disc plane fit', **stats('dtm9')},
        'dtm16': {'label': '16 m Horn (app context grid)', **stats('dtm16')},
    },
    'undecodableRows': len(bad),
    'method': ('Same procedure as the Perseverance check: each unique Curiosity waypoint inside the USGS MSL Gale Merged DEM 1 m (v3) '
               'is mapped to its native pixel; native float32 samples are read from the LZW strips by exact HTTP byte range; a least-squares plane '
               'is fitted over a disc around the position and its slope compared with the rover tilt in the NASA MMGIS MSL localisation record.'),
    'sources': {
        'waypoints': MMGIS + 'MSL_waypoints.json', 'traverse': MMGIS + 'MSL_traverse.json',
        'waypointsSha256': hashlib.sha256((WORK / 'MSL_waypoints.json').read_bytes()).hexdigest(),
        'dtm': SOURCE,
        'credit': 'Curiosity localisation: NASA/JPL-Caltech (MMGIS). DTM: NASA/JPL-Caltech/University of Arizona/USGS.',
    },
}
(OUT / 'validation.json').write_text(json.dumps({**summary, 'rows': rows}, separators=(',', ':')) + '\n')

drives = []
for f in traverse:
    g = f['geometry']; lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    for line in lines:
        pts = [[round(c[0], 7), round(c[1], 7)] for c in line]
        pts = [q for i, q in enumerate(pts) if i == 0 or q != pts[i - 1]]
        if len(pts) > 1: drives.append({'sol': f['properties'].get('sol'), 'm': f['properties'].get('Length') or f['properties'].get('length'), 'c': pts})
(OUT / 'traverse.json').write_text(json.dumps({'source': MMGIS + 'MSL_traverse.json', 'credit': summary['sources']['credit'],
                                              'totalMetres': round(sum(d['m'] or 0 for d in drives), 1), 'drives': drives}, separators=(',', ':')) + '\n')
print(json.dumps({k: v for k, v in summary.items() if k != 'method'}, indent=1))
