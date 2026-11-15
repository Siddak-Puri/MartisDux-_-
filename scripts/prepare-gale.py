"""Reproduce compact, real Gale crater terrain from the USGS MSL Gale Merged DEM 1 m (v3).
Requires numpy, requests and imagecodecs. Only the needed rows are fetched with HTTP
range requests (~380 MB of the 3.87 GB file); rows are cached so reruns resume.
Data are heights from the original DEM; no procedural relief, smoothing or AI is added.
"""
from pathlib import Path
import concurrent.futures, gzip, hashlib, json, math, struct, threading, time
import numpy as np
import requests
import imagecodecs

ROOT = Path(__file__).resolve().parents[1]
import os, tempfile
WORK = Path(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir()) / 'martisdux-work' / 'gale-build'; WORK.mkdir(parents=True, exist_ok=True)
OUT = ROOT / 'public' / 'terrain'
URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
SOURCE = 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
PRODUCT = 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m'
SIZE = 3868256546; IFD = 3867795758
R = 3396190.0
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

tail = read_range(IFD, SIZE - 1)
count = struct.unpack_from('<H', tail, 0)[0]
tags = {}
for i in range(count):
    tag, kind, n, value = struct.unpack_from('<HHII', tail, 2 + 12 * i); tags[tag] = (kind, n, value)
W, H = tags[256][2], tags[257][2]
assert tags[259][2] == 5 and tags[339][2] == 3 and tags[258][2] == 32 and tags[278][2] == 1, 'expected LZW float32, one row per strip'
def array(tag):
    kind, n, value = tags[tag]
    return np.frombuffer(tail[value - IFD:value - IFD + 4 * n], dtype='<u4')
offsets, counts = array(273), array(279)
scale_tag = struct.unpack_from('<3d', tail, tags[33550][2] - IFD)
tie = struct.unpack_from('<6d', tail, tags[33922][2] - IFD)
X, Y = tie[3], tie[4]
assert scale_tag[0] == 1 and scale_tag[1] == 1
NODATA = -32767
bad_rows = []

def lon_lat_to_pixel(lon, lat):
    return round(math.radians(lon) * R - X - .5), round(Y - .5 - math.radians(lat) * R)

def get_row(r):
    path = WORK / f'{r}.row'
    if path.exists(): return r, np.frombuffer(path.read_bytes(), dtype='<f4')
    row = None
    for attempt in range(2):
        try:
            data = imagecodecs.lzw_decode(read_range(int(offsets[r]), int(offsets[r]) + int(counts[r]) - 1))
            row = np.frombuffer(data, dtype='<f4', count=W); break
        except Exception as error:
            print(f'row {r}: {error}', flush=True)
    if row is None:
        bad_rows.append(r)
        for near in (r + 1, r - 1):
            try: return r, get_row(near)[1]
            except Exception: pass
        return r, np.full(W, NODATA, dtype='<f4')
    path.write_bytes(row.tobytes())
    return r, row

centre_col, centre_row = lon_lat_to_pixel(137.4417, -4.5895)
jobs = [('gale-context', 0, 0, W, H, 16), ('gale-landing', centre_col - 1024, centre_row - 1024, 2049, 2049, 1)]
manifest = []
for name, col, row, width, height, step in jobs:
    rows = list(range(row, row + height, step)); cols = slice(col, col + width, step)
    values = np.empty((len(rows), len(range(col, col + width, step))), dtype=np.float32)
    index = {r: i for i, r in enumerate(rows)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i, (r, data) in enumerate(pool.map(get_row, rows)):
            values[index[r]] = data[cols]
            if i % 200 == 0: print(name, i, len(rows), flush=True)
    valid = np.isfinite(values) & (values > NODATA + 1) & (values > -20000) & (values < 30000)
    minimum = float(values[valid].min()); maximum = float(values[valid].max())
    origin = math.floor(minimum / 100) * 100.
    scale = .05 if maximum - origin < 65534 * .05 else .1
    q = np.full(values.shape, 65535, dtype='<u2')
    q[valid] = np.clip(np.round((values[valid] - origin) / scale), 0, 65534).astype('<u2')
    raw = q.tobytes(); path = OUT / f'{name}.u16.gz'
    path.write_bytes(gzip.compress(raw, 9, mtime=0))
    manifest.append({
        'id': name, 'site': 'Gale', 'url': f'terrain/{name}.u16.gz', 'width': q.shape[1], 'height': q.shape[0],
        'x0': X + col + .5, 'y0': Y - row - .5, 'step': step, 'scale': scale, 'offset': origin, 'nodata': 65535,
        'minimum': minimum, 'maximum': maximum, 'validFraction': float(valid.mean()), 'sourceSpacing': 1,
        'deliveredSpacing': step, 'radius': R, 'original': SOURCE, 'sha256': hashlib.sha256(raw).hexdigest(),
    })
    print(name, q.shape, f'{minimum:.1f}..{maximum:.1f} m', f'valid {valid.mean():.2f}', f'{path.stat().st_size / 1e6:.1f} MB', flush=True)

(OUT / 'gale.json').write_text(json.dumps({
    'title': 'USGS MSL Gale Merged DEM 1 m (v3)', 'source': PRODUCT,
    'credit': 'NASA / JPL-Caltech / University of Arizona / USGS', 'datasets': manifest,
    'processing': f'Nearest native pixel-centre sampling at 16 m for context, native 1 m near Bradbury Landing; height quantization to {manifest[0]["scale"]} m steps. Undecodable source rows {bad_rows} replaced by the adjacent native row (1 m away). No synthetic relief, sharpening or AI generation. Nodata remains masked.',
}, indent=2))
print('undecodable rows:', bad_rows)
print('done')
