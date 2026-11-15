"""Life-size Marswalk data for the AR walk (ar/walk.html), from measured NASA data only.

Terrain: NASA/USGS Jezero HiRISE DTM (1 m grid bundled with the app), resampled
onto a 1 m local metric grid around the route. Surface: HiRISE orthomosaic tiles
from NASA Mars Trek (level 17, ~0.32 m/px). Route: the app's safe route
(scripts/ar-route.mjs). Stops: Perseverance sample sites.

Writes public/ar/walk/:
  terrain.bin   uint16 heights, millimetres above `hmin`, row-major, row 0 = north
  terrain.jpg   orthophoto covering exactly the same box (top = north)
  walk.json     grid + georeference, route (local metres), stops, sources

  node scripts/ar-route.mjs && python scripts/build-walk-data.py
"""
from pathlib import Path
import gzip, io, json, math, os
import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / 'public'
OUT = PUB / 'ar' / 'walk'; OUT.mkdir(parents=True, exist_ok=True)
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'ar-tiles'; WORK.mkdir(parents=True, exist_ok=True)
R = 3396190.0; RAD = math.pi / 180
TRE = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png'
STEP = 1.0
MARGIN_M = 250
LEVEL = 17
TEX_MAX = 4096

route = json.loads((PUB / 'ar' / 'jezero-marswalk.route.json').read_text(encoding='utf-8'))
samples = [s for s in json.loads((PUB / 'data/perseverance/samples.json').read_text(encoding='utf-8'))['samples'] if s['type'] != 'Atmospheric']
meta = json.loads((PUB / 'terrain/jezero.json').read_text(encoding='utf-8'))
info = next(d for d in meta['datasets'] if d['id'] == 'jezero-landing')
raw = np.frombuffer(gzip.decompress((PUB / info['url']).read_bytes()), dtype='<u2').reshape(info['height'], info['width'])
heights = np.where(raw == info['nodata'], np.nan, raw * info['scale'] + info['offset'])

def dtm_index(lat, lon):
    return (info['y0'] - lat * RAD * R) / info['step'], (lon * RAD * R - info['x0']) / info['step']
b = {'west': info['x0'] / R / RAD, 'east': (info['x0'] + (info['width'] - 1) * info['step']) / R / RAD,
     'north': info['y0'] / R / RAD, 'south': (info['y0'] - (info['height'] - 1) * info['step']) / R / RAD}

pts = route['points']
lats = [p['lat'] for p in pts] + [route['base']['lat']]; lons = [p['lon'] for p in pts] + [route['base']['lon']]
lat0 = sum(lats) / len(lats); kx = math.cos(lat0 * RAD) * R * RAD; ky = R * RAD
pad_lat, pad_lon = MARGIN_M / ky, MARGIN_M / kx
box = {'south': max(min(lats) - pad_lat, b['south'] + 2e-5), 'north': min(max(lats) + pad_lat, b['north'] - 2e-5),
       'west': max(min(lons) - pad_lon, b['west'] + 2e-5), 'east': min(max(lons) + pad_lon, b['east'] - 2e-5)}
width_m, depth_m = (box['east'] - box['west']) * kx, (box['north'] - box['south']) * ky
nx, nz = int(width_m // STEP) + 1, int(depth_m // STEP) + 1
width_m, depth_m = (nx - 1) * STEP, (nz - 1) * STEP
box['east'] = box['west'] + width_m / kx; box['south'] = box['north'] - depth_m / ky

def to_local(lat, lon): return ((lon - box['west']) * kx, (box['north'] - lat) * ky)

X, Z = np.meshgrid(np.arange(nx) * STEP, np.arange(nz) * STEP)
ri, ci = dtm_index(box['north'] - Z / ky, box['west'] + X / kx)
r0, c0 = np.floor(ri).astype(int), np.floor(ci).astype(int); fr, fc = ri - r0, ci - c0
def at(r, c): return heights[np.clip(r, 0, info['height'] - 1), np.clip(c, 0, info['width'] - 1)]
H = at(r0, c0) * (1 - fr) * (1 - fc) + at(r0, c0 + 1) * (1 - fr) * fc + at(r0 + 1, c0) * fr * (1 - fc) + at(r0 + 1, c0 + 1) * fr * fc
assert np.isfinite(H).all(), 'walk area must be fully inside the DTM'
hmin = float(H.min()); hmax = float(H.max())
assert (hmax - hmin) * 1000 < 65535
(OUT / 'terrain.bin').write_bytes(np.round((H - hmin) * 1000).astype('<u2').tobytes())
print(f'grid {nx} x {nz} at {STEP} m ({width_m:.0f} x {depth_m:.0f} m), relief {hmax - hmin:.1f} m')

span = 180 / 2 ** LEVEL
tx0, tx1 = int((box['west'] + 180) // span), int((box['east'] + 180) // span)
ty0, ty1 = int((90 - box['north']) // span), int((90 - box['south']) // span)
mosaic = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), (120, 104, 92))
session = requests.Session(); fetched = missing = 0
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        path = WORK / f'{LEVEL}_{ty}_{tx}.png'
        if not path.exists():
            r = session.get(TRE.format(z=LEVEL, y=ty, x=tx), timeout=40)
            if r.status_code == 200: path.write_bytes(r.content); fetched += 1
            else: missing += 1
        if path.exists(): mosaic.paste(Image.open(path).convert('RGB'), ((tx - tx0) * 256, (ty - ty0) * 256))
mw, mn = -180 + tx0 * span, 90 - ty0 * span
px = lambda lon: (lon - mw) / span * 256; py = lambda lat: (mn - lat) / span * 256
crop = mosaic.crop((round(px(box['west'])), round(py(box['north'])), round(px(box['east'])), round(py(box['south']))))
k = min(1, TEX_MAX / max(crop.size))
tex = crop.resize((round(crop.size[0] * k), round(crop.size[1] * k)), Image.LANCZOS)
jpg = io.BytesIO(); tex.save(jpg, 'JPEG', quality=84, optimize=True, progressive=True)
(OUT / 'terrain.jpg').write_bytes(jpg.getvalue())
print(f'texture {crop.size} -> {tex.size}, {width_m / tex.size[0]:.2f} m/px, {len(jpg.getvalue()) // 1024} KB, {fetched} tiles fetched, {missing} missing')

line = [to_local(p['lat'], p['lon']) for p in pts]
clean = [line[0]]
for p in line[1:]:
    if math.dist(p, clean[-1]) > 0.05: clean.append(p)
dist = [0.0]
for a, c in zip(clean, clean[1:]): dist.append(dist[-1] + math.dist(a, c))

def project(p):
    best = (1e18, 0.0)
    for (a, c), d0 in zip(zip(clean, clean[1:]), dist):
        vx, vz = c[0] - a[0], c[1] - a[1]; L2 = vx * vx + vz * vz
        t = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2)) if L2 else 0
        q = (a[0] + vx * t, a[1] + vz * t); e = math.dist(p, q)
        if e < best[0]: best = (e, d0 + math.sqrt(L2) * t)
    return best

stops, seen = [], {}
for s in samples:
    x, z = to_local(s['lat'], s['lon'])
    if not (0 <= x <= width_m and 0 <= z <= depth_m): continue
    key = (round(x, 1), round(z, 1)); name = s['name'].split(' (')[0]
    if key in seen: seen[key]['name'] += ' · ' + name; continue
    off, along = project((x, z))
    seen[key] = {'id': f"s{s['number']}", 'name': name, 'detail': f"{s['rock']} rock core, sealed sol {s['sol']}",
                 'x': round(x, 2), 'z': round(z, 2), 'along': round(along, 1), 'offRoute': round(off, 1)}
stops = sorted(seen.values(), key=lambda s: s['along'])

bx, bz = to_local(route['base']['lat'], route['base']['lon']); dx, dz = to_local(route['dest']['lat'], route['dest']['lon'])
walk = {
    'title': 'Jezero Marswalk · life size',
    'grid': {'nx': nx, 'nz': nz, 'step': STEP, 'width': width_m, 'depth': depth_m, 'hmin': round(hmin, 3), 'hmax': round(hmax, 3),
             'heights': 'terrain.bin', 'heightUnit': 0.001, 'texture': 'terrain.jpg'},
    'geo': {'north': box['north'], 'west': box['west'], 'metresPerDegLon': kx, 'metresPerDegLat': ky,
            'note': 'x = (lon - west) * metresPerDegLon (east), z = (north - lat) * metresPerDegLat (south); heights are MOLA areoid metres'},
    'base': {'name': route['base']['name'], 'x': round(bx, 2), 'z': round(bz, 2)},
    'dest': {'name': route['dest']['name'], 'x': round(dx, 2), 'z': round(dz, 2)},
    'route': {'distance': round(dist[-1], 1), 'maxSlope': round(route['maxSlope'], 1), 'points': [[round(x, 2), round(z, 2)] for x, z in clean]},
    'stops': stops,
    'sources': {
        'terrain': 'NASA/JPL-Caltech/University of Arizona/USGS HiRISE DTM, Jezero crater (1 m)',
        'imagery': 'NASA/JPL-Caltech/University of Arizona HiRISE orthomosaic via NASA Mars Trek',
        'samples': 'NASA/JPL-Caltech Mars 2020 sample list',
    },
}
(OUT / 'walk.json').write_text(json.dumps(walk, indent=1), encoding='utf-8')
print(f"route {dist[-1]:.0f} m, {len(stops)} stops: " + ', '.join(f"{s['name']} ({s['along']:.0f} m, {s['offRoute']:.0f} m off)" for s in stops))
