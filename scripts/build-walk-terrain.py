"""Terrain for the life-size Mars walk (ar/walk.html): four nested, measured layers around
the Perseverance landing site, so the 1 m ground near the walker continues into real, coarser
terrain out to the horizon instead of ending at the edge of a raster.

  landing  Jezero HiRISE DTM, native 1 m grid (2,049 × 2,049) + HiRISE orthomosaic level 17 (≈0.32 m/px), unresampled
  crater   Jezero HiRISE DTM, every 16th native sample (16 m), gaps filled from the region DEM + MRO CTX level 12 (≈5 m/px)
  region   HRSC/MOLA blended DEM level 7 (≈163 m grid, 200 m source) + MRO CTX V01 level 9 (≈41 m/px), 229 km
  global   HRSC/MOLA blended DEM (≈10.4 km grid) + Viking MDIM 2.1 colour overview, beyond the horizon only

Each layer is cut into chunks; each chunk gets its own imagery page cropped from the native tile
mosaic (no resampling, 1 px overlap), plus one downsampled overview per layer for distant views.
Elevation and imagery stay separate: no image brightness is used as height, nothing is sharpened,
upscaled or generated. Level 17 is the finest level the NASA Mars Trek Jezero HiRISE service offers.

  node scripts/build-walk-terrain-dem.mjs && python scripts/build-walk-terrain.py
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import gzip, io, json, math, os, shutil, hashlib
import numpy as np
import requests
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / 'public'
OUT = PUB / 'ar' / 'walk-env'
WORK = Path(os.environ.get('MARTISDUX_WORK') or (Path(os.environ.get('TMPDIR', '/tmp')) / 'martisdux-work')) / 'mars-terrain'
R = 3396190.0; RAD = math.pi / 180
HIRISE = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png'
CTX = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{z}/{y}/{x}'
session = requests.Session()

if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir(parents=True)

def ground_m(deg, lat=0.0): return deg * RAD * R * math.cos(lat * RAD)

def write_u16(name, values, scale, offset):
    q = np.round((values - offset) / scale)
    assert np.isfinite(q).all() and q.min() >= 0 and q.max() < 65535, name
    (OUT / name).write_bytes(gzip.compress(q.astype('<u2').tobytes(), 9, mtime=0))
    return {'url': f'walk-env/{name}', 'scale': scale, 'offset': offset, 'nodata': 65535}

def fetch_tiles(url, z, xs, ys, size, cache, local=None):
    """Mosaic of z/y/x tiles (original bytes cached on disk). Missing tiles stay transparent."""
    (WORK / cache).mkdir(parents=True, exist_ok=True)
    def get(yx):
        y, x = yx
        if local and (local / f'{y}/{x}.png').exists(): return yx, (local / f'{y}/{x}.png').read_bytes()
        p = WORK / cache / f'{z}_{y}_{x}'
        if not p.exists():
            for _ in range(4):
                try:
                    r = session.get(url.format(z=z, y=y, x=x), timeout=40)
                    if r.status_code == 200: p.write_bytes(r.content); break
                    if r.status_code == 404: p.write_bytes(b''); break
                except requests.RequestException: pass
        return yx, p.read_bytes() if p.exists() else b''
    mosaic = Image.new('LA', (len(xs) * size, len(ys) * size), (0, 0))
    with ThreadPoolExecutor(8) as pool:
        for (y, x), data in pool.map(get, [(y, x) for y in ys for x in xs]):
            if data: mosaic.paste(Image.open(io.BytesIO(data)).convert('LA'), ((x - xs[0]) * size, (y - ys[0]) * size))
    return mosaic

def save_jpeg(img, name, quality=88):
    buf = io.BytesIO(); img.save(buf, 'JPEG', quality=quality, optimize=True); (OUT / name).write_bytes(buf.getvalue())
    return len(buf.getvalue())

def flatten(la, fill=46):
    """Greyscale with transparent (no-data) pixels shown as a flat dark grey, never invented content."""
    base = Image.new('L', la.size, fill); base.paste(la.getchannel('L'), mask=la.getchannel('A')); return base

def pages(layer, img, origin, pdeg, chunk_bounds, mode='L'):
    """Crop one native-resolution page per chunk (+1 px overlap). origin = (lon, lat) of the image's top-left corner."""
    out, total = [], 0
    (OUT / layer).mkdir(exist_ok=True)
    for key, (w, s, e, n) in chunk_bounds.items():
        x0 = math.floor((w - origin[0]) / pdeg[0]) - 1; x1 = math.ceil((e - origin[0]) / pdeg[0]) + 1
        y0 = math.floor((origin[1] - n) / pdeg[1]) - 1; y1 = math.ceil((origin[1] - s) / pdeg[1]) + 1
        crop = img.crop((x0, y0, x1, y1))
        name = f'{layer}/{key}.jpg'; total += save_jpeg(crop.convert(mode), name)
        out.append({'key': key, 'url': f'walk-env/{name}', 'size': list(crop.size),
                    'bounds': [origin[0] + x0 * pdeg[0], origin[1] - y1 * pdeg[1], origin[0] + x1 * pdeg[0], origin[1] - y0 * pdeg[1]]})
    print(f'  {layer}: {len(out)} pages, {total / 1e6:.1f} MB')
    return out

def chunk_grid(width, height, lon0, lat0, dlon, dlat, chunk):
    grid = {}
    for cy in range(math.ceil((height - 1) / chunk)):
        for cx in range(math.ceil((width - 1) / chunk)):
            c0, c1 = cx * chunk, min((cx + 1) * chunk, width - 1); r0, r1 = cy * chunk, min((cy + 1) * chunk, height - 1)
            grid[f'{cy}_{cx}'] = (lon0 + c0 * dlon, lat0 - r1 * dlat, lon0 + c1 * dlon, lat0 - r0 * dlat)
    return grid

def overview(layer, img, origin, pdeg, bounds, longest=2048, mode='L'):
    w, s, e, n = bounds
    box = (round((w - origin[0]) / pdeg[0]), round((origin[1] - n) / pdeg[1]), round((e - origin[0]) / pdeg[0]), round((origin[1] - s) / pdeg[1]))
    crop = img.crop(box); k = longest / max(crop.size)
    small = crop.resize((max(1, round(crop.size[0] * k)), max(1, round(crop.size[1] * k))), Image.LANCZOS) if k < 1 else crop
    (OUT / layer).mkdir(exist_ok=True); name = f'{layer}/overview.jpg'; save_jpeg(small.convert(mode), name, 86)
    return {'url': f'walk-env/{name}', 'size': list(small.size),
            'bounds': [origin[0] + box[0] * pdeg[0], origin[1] - box[3] * pdeg[1], origin[0] + box[2] * pdeg[0], origin[1] - box[1] * pdeg[1]]}

def dem_meta(width, height, lon0, lat0, dlon, dlat):
    return {'width': width, 'height': height, 'lon0': lon0, 'lat0': lat0, 'dlon': dlon, 'dlat': dlat}

def load_f32(name):
    meta = json.loads((WORK / f'{name}.json').read_text())
    return np.fromfile(WORK / f'{name}.f32', dtype='<f4').reshape(meta['height'], meta['width']), meta

_v = Image.open(PUB / 'data/viking-overview.jpg').convert('RGB')
_vp = 360 / _v.size[0]
_box = (0, round(40 / _vp), _v.size[0], round(140 / _vp))
_m = np.asarray(_v.crop(_box), dtype=np.float64).reshape(-1, 3).mean(0) / 255
_lin = _m ** 2.2; _y = 0.2126 * _lin[0] + 0.7152 * _lin[1] + 0.0722 * _lin[2]
tint = {'rgbLinear': [round(float(c / _y), 4) for c in _lin], 'vikingMeanSrgb': [round(float(c), 4) for c in _m],
        'note': 'Average Viking MDIM 2.1 colour between 50°S and 50°N, applied as a luminance-preserving hue to monochrome imagery.'}
print('tint', tint['rgbLinear'])

layers = []

print('global')
gdem, gm = load_f32('global-dem')
viking = Image.open(PUB / 'data/viking-overview.jpg').convert('RGB')
vpd = 360 / viking.size[0]
wrap = Image.new('RGB', (viking.size[0] + 2, viking.size[1] + 2))
wrap.paste(viking, (1, 1)); wrap.paste(viking.crop((viking.size[0] - 1, 0, viking.size[0], viking.size[1])), (0, 1))
wrap.paste(viking.crop((0, 0, 1, viking.size[1])), (viking.size[0] + 1, 1))
wrap.paste(wrap.crop((0, 1, wrap.size[0], 2)), (0, 0)); wrap.paste(wrap.crop((0, wrap.size[1] - 2, wrap.size[0], wrap.size[1] - 1)), (0, wrap.size[1] - 1))
gchunks = chunk_grid(gm['width'], gm['height'], -180, 90, gm['dlon'], gm['dlat'], 128)
layers.append({
    'id': 'global', 'name': 'Mars · whole planet', 'parent': None, 'chunk': 128, 'blendM': 0,
    'bounds': [-180, -90, 180, 90],
    'dem': {**dem_meta(gm['width'], gm['height'], -180, 90, gm['dlon'], gm['dlat']), **write_u16('global.u16.gz', gdem, 0.5, -8600),
            'label': 'USGS HRSC/MOLA blended DEM v2', 'sourceSpacingM': 200, 'spacingM': round(ground_m(gm['dlat'])),
            'note': 'Level-2 service tiles (≈5.2 km) filtered and decimated to a ≈10.4 km grid for the whole-planet mesh.'},
    'imagery': {'label': 'Viking MDIM 2.1 colour mosaic', 'sourceMpp': 232, 'mpp': round(ground_m(vpd)), 'mode': 'RGB',
                'note': 'Bundled 8,192 × 4,096 version of the official 1 km browse product (2.6 km/px at the equator).',
                'overview': overview('global', wrap, (-180 - vpd, 90 + vpd), (vpd, vpd), (-180, -90, 180, 90), 4096, 'RGB'),
                'pages': []},
    'credit': 'DEM: NASA/MGS/MOLA, ESA/DLR/FU Berlin HRSC, USGS; Esri LERC tiles. Imagery: NASA/JPL/USGS/NASA Ames.',
})

print('region')
rdem, rm = load_f32('region-dem')
span9 = 180 / 2 ** 9; xs9 = list(range(727, 738)); ys9 = list(range(198, 209))
ctx9 = fetch_tiles(CTX, 9, xs9, ys9, 512, 'ctx9')
o9 = (-180 + xs9[0] * span9, 90 - ys9[0] * span9); p9 = (span9 / 512, span9 / 512)
rchunks = chunk_grid(rm['width'], rm['height'], rm['lon0'], rm['lat0'], rm['dlon'], rm['dlat'], 128)
rb = (rm['lon0'], rm['lat0'] - (rm['height'] - 1) * rm['dlat'], rm['lon0'] + (rm['width'] - 1) * rm['dlon'], rm['lat0'])
layers.append({
    'id': 'region', 'name': 'Jezero region · Isidis rim', 'parent': 'global', 'chunk': 128, 'blendM': 3000, 'bounds': list(rb),
    'dem': {**dem_meta(rm['width'], rm['height'], rm['lon0'], rm['lat0'], rm['dlon'], rm['dlat']), **write_u16('region.u16.gz', rdem, 0.25, -8600),
            'label': 'USGS HRSC/MOLA blended DEM v2', 'sourceSpacingM': 200, 'spacingM': round(ground_m(rm['dlat'])),
            'note': 'Level-7 service tiles, unchanged samples (grid finer than the ≈200 m source; no added detail).'},
    'imagery': {'label': 'MRO CTX V01 global mosaic (monochrome)', 'sourceMpp': 5, 'mpp': round(ground_m(p9[1])), 'mode': 'L',
                'note': 'Level-9 tiles (≈41 m/px), one native tile per chunk.',
                'overview': overview('region', ctx9, o9, p9, rb), 'pages': pages('region', ctx9, o9, p9, rchunks)},
    'credit': 'DEM: NASA/MGS/MOLA, ESA/DLR/FU Berlin HRSC, USGS. Imagery: NASA/JPL/MSSS/Caltech Murray Lab; tiles Esri.',
})

print('crater')
meta = json.loads((PUB / 'terrain/jezero.json').read_text())
def dtm(id_):
    info = next(d for d in meta['datasets'] if d['id'] == id_)
    raw = np.frombuffer(gzip.decompress((PUB / info['url']).read_bytes()), dtype='<u2').reshape(info['height'], info['width'])
    return info, raw
cinfo, craw = dtm('jezero-context')
k = 1 / (R * RAD)
clon0, clat0, cd = cinfo['x0'] * k, cinfo['y0'] * k, cinfo['step'] * k
valid = craw != cinfo['nodata']
ch = np.where(valid, craw * cinfo['scale'] + cinfo['offset'], np.nan)
rows, cols = np.mgrid[0:cinfo['height'], 0:cinfo['width']]
fr = (rm['lat0'] - (clat0 - rows * cd)) / rm['dlat']; fc = ((clon0 + cols * cd) - rm['lon0']) / rm['dlon']
r0_, c0_ = np.floor(fr).astype(int), np.floor(fc).astype(int); a, b = fr - r0_, fc - c0_
parent = (rdem[r0_, c0_] * (1 - a) * (1 - b) + rdem[r0_, c0_ + 1] * (1 - a) * b + rdem[r0_ + 1, c0_] * a * (1 - b) + rdem[r0_ + 1, c0_ + 1] * a * b)
band = round(350 / cinfo['step']); weight = np.zeros(valid.shape, np.float32); m = valid.copy()
for _ in range(band):
    weight += m; e = m.copy()
    e[1:] &= m[:-1]; e[:-1] &= m[1:]; e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]; m = e
weight /= band
filled = np.where(valid, parent + (np.nan_to_num(ch) - parent) * weight, parent)
xs12 = range(math.floor((clon0 + 180) / (180 / 4096)), math.floor((clon0 + (cinfo['width'] - 1) * cd + 180) / (180 / 4096)) + 1)
ys12 = range(math.floor((90 - clat0) / (180 / 4096)), math.floor((90 - (clat0 - (cinfo['height'] - 1) * cd)) / (180 / 4096)) + 1)
xs12, ys12 = list(xs12), list(ys12)
ctx12 = fetch_tiles(CTX, 12, xs12, ys12, 512, 'ctx12')
span12 = 180 / 4096; o12 = (-180 + xs12[0] * span12, 90 - ys12[0] * span12); p12 = (span12 / 512, span12 / 512)
cchunks = chunk_grid(cinfo['width'], cinfo['height'], clon0, clat0, cd, cd, 128)
cb = (clon0, clat0 - (cinfo['height'] - 1) * cd, clon0 + (cinfo['width'] - 1) * cd, clat0)
layers.append({
    'id': 'crater', 'name': 'Jezero crater floor & delta', 'parent': 'region', 'chunk': 128, 'blendM': 350, 'bounds': list(cb),
    'dem': {**dem_meta(cinfo['width'], cinfo['height'], clon0, clat0, cd, cd), **write_u16('crater.u16.gz', filled, 0.1, -4500),
            'label': 'NASA/USGS Jezero HiRISE DTM (Mars 2020 TRN)', 'sourceSpacingM': 1, 'spacingM': cinfo['step'],
            'validFraction': round(float(valid.mean()), 3),
            'note': f'Every 16th native 1 m sample. {100 - valid.mean() * 100:.0f}% of this box has no HiRISE DTM; there the 200 m HRSC/MOLA DEM is used, blended over 350 m.'},
    'imagery': {'label': 'MRO CTX V01 global mosaic (monochrome)', 'sourceMpp': 5, 'mpp': round(ground_m(p12[1]), 1), 'mode': 'L',
                'note': 'Level-12 tiles (≈5 m/px), native pixels.',
                'overview': overview('crater', ctx12, o12, p12, cb), 'pages': pages('crater', ctx12, o12, p12, cchunks)},
    'credit': 'DTM: NASA/JPL-Caltech/University of Arizona/USGS. Imagery: NASA/JPL/MSSS/Caltech Murray Lab; tiles Esri.',
})

print('landing')
linfo, lraw = dtm('jezero-landing')
assert (lraw != linfo['nodata']).all() and linfo['step'] == 1
shutil.copyfile(PUB / linfo['url'], OUT / 'landing.u16.gz')
llon0, llat0, ld = linfo['x0'] * k, linfo['y0'] * k, linfo['step'] * k
span17 = 180 / 2 ** 17
xs17 = list(range(math.floor((llon0 + 180) / span17), math.floor((llon0 + (linfo['width'] - 1) * ld + 180) / span17) + 1))
ys17 = list(range(math.floor((90 - llat0) / span17), math.floor((90 - (llat0 - (linfo['height'] - 1) * ld)) / span17) + 1))
hirise = fetch_tiles(HIRISE, 17, xs17, ys17, 256, 'hirise17', local=PUB / 'data/jezero-detail/17')
o17 = (-180 + xs17[0] * span17, 90 - ys17[0] * span17); p17 = (span17 / 256, span17 / 256)
hirise_l = flatten(hirise)
lchunks = chunk_grid(linfo['width'], linfo['height'], llon0, llat0, ld, ld, 128)
lb = (llon0, llat0 - (linfo['height'] - 1) * ld, llon0 + (linfo['width'] - 1) * ld, llat0)
coverage = np.array(hirise.getchannel('A').crop((round((lb[0] - o17[0]) / p17[0]), round((o17[1] - lb[3]) / p17[1]), round((lb[2] - o17[0]) / p17[0]), round((o17[1] - lb[1]) / p17[1])))) > 0
layers.append({
    'id': 'landing', 'name': 'Perseverance landing area', 'parent': 'crater', 'chunk': 128, 'blendM': 100, 'bounds': list(lb),
    'dem': {**dem_meta(linfo['width'], linfo['height'], llon0, llat0, ld, ld), 'url': 'walk-env/landing.u16.gz',
            'scale': linfo['scale'], 'offset': linfo['offset'], 'nodata': linfo['nodata'],
            'label': 'NASA/USGS Jezero HiRISE DTM (Mars 2020 TRN)', 'sourceSpacingM': 1, 'spacingM': 1, 'validFraction': 1.0,
            'note': 'Native 1 m samples (2,049 × 2,049), unchanged; heights quantised to 0.05 m for delivery.'},
    'walkable': True,
    'imagery': {'label': 'HiRISE Jezero orthomosaic (monochrome)', 'sourceMpp': 0.25, 'mpp': round(ground_m(p17[1]), 2), 'mode': 'L',
                'coverage': round(float(coverage.mean()), 4),
                'note': f'Level-17 Mars Trek tiles (the service maximum), native pixels ({len(xs17)} × {len(ys17)} tiles); one page per 128 m chunk.',
                'overview': overview('landing', hirise_l, o17, p17, lb), 'pages': pages('landing', hirise_l, o17, p17, lchunks)},
    'credit': 'DTM and imagery: NASA/JPL-Caltech/University of Arizona/USGS.',
})

manifest = {
    'title': 'MartisDux life-size Mars walk terrain', 'radius': R,
    'start': {'lat': 18.4447, 'lon': 77.4508, 'name': 'Perseverance landing site (Octavia E. Butler Landing)'},
    'tint': tint,
    'frame': 'Planetocentric latitude, east-positive longitude, Mars 2000 sphere (radius 3,396,190 m). Heights are areoid elevations applied as radial offsets.',
    'reconstruction': 'A reconstruction from archived orbital mission data. Not live imagery and not current conditions on Mars.',
    'layers': layers,
}
(OUT / 'terrain.json').write_text(json.dumps(manifest, indent=1) + '\n')
size = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
print(f'wrote {OUT.relative_to(ROOT)} · {size / 1e6:.1f} MB')
