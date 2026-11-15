"""Ground-truth check: orbital HiRISE DTM slope vs. Perseverance's measured tilt.

For every Perseverance waypoint inside the Jezero HiRISE DTM, read the native
1 m DTM samples around the rover position (exact HTTP byte ranges, no
resampling) and compute the terrain slope over rover-sized and walker-sized
footprints. Compare with the rover's own attitude (tilt = angle between rover
up-axis and local vertical, from NASA's MMGIS M20 waypoint record).

Outputs:
  public/data/perseverance/traverse.json    compact traverse lines (by sol)
  public/data/perseverance/validation.json  summary statistics + per-waypoint rows

Requires numpy and requests. Run with:  python -I scripts/validate-perseverance.py
"""
from pathlib import Path
import concurrent.futures, datetime, hashlib, json, math, os, struct, threading, time
import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'm20'
WORK.mkdir(parents=True, exist_ok=True)
OUT = ROOT / 'public' / 'data' / 'perseverance'; OUT.mkdir(parents=True, exist_ok=True)

MMGIS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/'
DTM_URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
DTM_SOURCE = 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
R = 3396190.; X = 4577366.; Y = 1106618.; W = 21400; H = 21488
HALF = 16

clients = threading.local()

def fetch(name):
    path = WORK / name
    if not path.exists():
        r = requests.get(MMGIS + name, timeout=60); r.raise_for_status(); path.write_bytes(r.content)
    return path

def read_range(first, last):
    for attempt in range(5):
        try:
            if not hasattr(clients, 'session'): clients.session = requests.Session()
            res = clients.session.get(DTM_URL, headers={'Range': f'bytes={first}-{last}'}, timeout=35)
            data = res.content
            if res.status_code != 206 or len(data) != last - first + 1: raise ValueError('Expected an exact HTTP byte range')
            return data
        except Exception:
            if attempt == 4: raise
            time.sleep(attempt + 1)

header = read_range(0, 16383)
tags = {}
for i in range(struct.unpack_from('<H', header, 8)[0]):
    tag, kind, n, offset = struct.unpack_from('<HHII', header, 10 + 12 * i); tags[tag] = (kind, n, offset)
assert tags[256][2] == W and tags[257][2] == H and tags[259][2] == 1, 'Unexpected DTM layout'
kind, n, offset = tags[273]; assert kind == 4 and n == H
row_offsets = np.frombuffer(read_range(offset, offset + n * 4 - 1), dtype='<u4')

def window(col, row):
    """Native float32 DTM samples rows/cols [row-HALF, row+HALF]; cached per waypoint."""
    cache = WORK / 'windows' / f'{col}_{row}_{HALF}.npy'
    if cache.exists(): return np.load(cache)
    cache.parent.mkdir(exist_ok=True)
    c0 = col - HALF; size = 2 * HALF + 1
    out = np.full((size, size), np.nan, dtype=np.float32)
    for k, r in enumerate(range(row - HALF, row + HALF + 1)):
        if 0 <= r < H and c0 >= 0 and c0 + size <= W:
            first = int(row_offsets[r]) + c0 * 4
            out[k] = np.frombuffer(read_range(first, first + size * 4 - 1), dtype='<f4')
    out[~np.isfinite(out) | (out < -20000) | (out > 30000)] = np.nan
    np.save(cache, out)
    return out

def plane_slope(z, radius):
    """Least-squares plane over the disc of `radius` m around the centre; returns degrees."""
    c = HALF; ys, xs = np.mgrid[-c:c + 1, -c:c + 1]
    mask = (xs ** 2 + ys ** 2 <= radius ** 2) & np.isfinite(z)
    if mask.sum() < 0.9 * (np.pi * radius ** 2): return float('nan')
    A = np.column_stack([xs[mask] * plane_slope.dx, -ys[mask] * 1.0, np.ones(mask.sum())])
    (gx, gy, _), *_ = np.linalg.lstsq(A, z[mask].astype(np.float64), rcond=None)
    return math.degrees(math.atan(math.hypot(gx, gy)))
plane_slope.dx = 1.0

def horn16(z, dx):
    """The app's 16 m context-grid Horn slope at the centre sample."""
    c = HALF; e = lambda dr, dc: z[c + dr * 16, c + dc * 16]
    a, b, cc, d, f, g, h, k = e(-1, -1), e(-1, 0), e(-1, 1), e(0, -1), e(0, 1), e(1, -1), e(1, 0), e(1, 1)
    gx = ((cc + 2 * f + k) - (a + 2 * d + g)) / (8 * 16 * dx)
    gy = ((g + 2 * h + k) - (a + 2 * b + cc)) / (8 * 16)
    return math.degrees(math.atan(math.hypot(gx, gy)))

waypoints = [f['properties'] for f in json.loads(fetch('M20_waypoints.json').read_text())['features']]
traverse = json.loads(fetch('M20_traverse.json').read_text())['features']

def pixel(lat, lon):
    return round(math.radians(lon) * R - X - .5), round(Y - .5 - math.radians(lat) * R)

seen, jobs = set(), []
for p in waypoints:
    col, row = pixel(p['lat'], p['lon'])
    key = (col, row)
    if key in seen or not (HALF <= col < W - HALF and HALF <= row < H - HALF): continue
    seen.add(key); jobs.append((p, col, row))
print('waypoints', len(waypoints), 'unique inside DTM', len(jobs), flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    windows = list(pool.map(lambda j: window(j[1], j[2]), jobs))

rows = []
for (p, col, row), z in zip(jobs, windows):
    dx = math.cos(math.radians(p['lat']))
    plane_slope.dx = dx
    s3, s5, s9 = plane_slope(z, 1.6), plane_slope(z, 2.6), plane_slope(z, 4.6)
    s16 = horn16(z, dx)
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
    'question': 'Does slope measured from orbit (HiRISE 1 m DTM) match the tilt Perseverance actually experienced on the ground?',
    'waypoints': len(waypoints), 'compared': len(rows),
    'baseline': {'label': 'No-skill guess: every waypoint = median rover tilt', 'mae': round(float(np.abs(tilts - np.median(tilts)).mean()), 2),
                 'within2': round(float((np.abs(tilts - np.median(tilts)) <= 2).mean()), 3)},
    'roverTilt': {'mean': round(float(tilts.mean()), 2), 'median': round(float(np.median(tilts)), 2), 'p95': round(float(np.percentile(tilts, 95)), 2), 'max': round(float(tilts.max()), 2)},
    'footprints': {
        'dtm3': {'label': '3 m disc (rover-sized plane fit)', **stats('dtm3')},
        'dtm5': {'label': '5 m disc plane fit', **stats('dtm5')},
        'dtm9': {'label': '9 m disc plane fit', **stats('dtm9')},
        'dtm16': {'label': '16 m Horn (app context grid)', **stats('dtm16')},
    },
    'method': ('Each unique Perseverance waypoint inside the Jezero HiRISE DTM footprint is mapped to its native 1 m pixel '
               '(planetocentric lat/lon on the 3,396,190 m sphere, equirectangular latTs=0). Native float32 samples are read by exact '
               'HTTP byte range; a least-squares plane is fitted over a disc around the position and its slope compared with the '
               'rover attitude (tilt) recorded at that waypoint in the NASA MMGIS localisation record. Rover tilt includes rocks, wheel sinkage and localisation error; the DTM '
               'resolves features of roughly 3 m and larger. Agreement classes: <10, 10-20, 20-30, >=30 degrees.'),
    'sources': {
        'waypoints': MMGIS + 'M20_waypoints.json', 'traverse': MMGIS + 'M20_traverse.json',
        'waypointsSha256': hashlib.sha256((WORK / 'M20_waypoints.json').read_bytes()).hexdigest(),
        'traverseSha256': hashlib.sha256((WORK / 'M20_traverse.json').read_bytes()).hexdigest(),
        'dtm': DTM_SOURCE,
        'credit': 'Perseverance localisation: NASA/JPL-Caltech (MMGIS). DTM: NASA/JPL-Caltech/University of Arizona/USGS.',
    },
}
(OUT / 'validation.json').write_text(json.dumps({**summary, 'rows': rows}, separators=(',', ':')) + '\n')

drives = []
for f in traverse:
    pts = [[round(c[0], 7), round(c[1], 7)] for c in f['geometry']['coordinates']]
    pts = [q for i, q in enumerate(pts) if i == 0 or q != pts[i - 1]]
    if len(pts) > 1: drives.append({'sol': f['properties']['sol'], 'm': f['properties']['length'], 'c': pts})
(OUT / 'traverse.json').write_text(json.dumps({'source': MMGIS + 'M20_traverse.json', 'credit': summary['sources']['credit'],
                                              'totalMetres': round(sum(d['m'] for d in drives), 1), 'drives': drives}, separators=(',', ':')) + '\n')
print(json.dumps(summary, indent=1))
