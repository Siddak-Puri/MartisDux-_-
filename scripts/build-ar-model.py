"""Tabletop AR model of the Jezero Marswalk, built only from measured NASA data.

Terrain: NASA/USGS Jezero HiRISE DTM (native 1 m grid bundled with the app),
sampled every 6 m. Surface: NASA/JPL-Caltech/University of Arizona HiRISE
orthomosaic tiles (Mars Trek, level 16, ~0.64 m/px). Route: the app's own safe
route (scripts/ar-route.mjs). Science stops: Perseverance sample sites.

Writes binary glTF (GLB) files for phones (model-viewer: Android Scene Viewer /
WebXR, iOS Quick Look), one at true vertical scale and one with ×3 relief, plus
a JSON sidecar with label positions.

  node scripts/ar-route.mjs && python scripts/build-ar-model.py
"""
from pathlib import Path
import gzip, io, json, math, os, struct, hashlib
import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / 'public'
OUT = PUB / 'ar'; OUT.mkdir(exist_ok=True)
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'ar-tiles'; WORK.mkdir(parents=True, exist_ok=True)
R = 3396190.0; RAD = math.pi / 180
TRE = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png'
SAMPLE_M = 6
TABLE_SIZE = 0.6
MARGIN_M = 250
LEVEL = 16

route = json.loads((OUT / 'jezero-marswalk.route.json').read_text(encoding='utf-8'))
samples = [s for s in json.loads((PUB / 'data/perseverance/samples.json').read_text(encoding='utf-8'))['samples'] if s['type'] != 'Atmospheric']
meta = json.loads((PUB / 'terrain/jezero.json').read_text(encoding='utf-8'))
info = next(d for d in meta['datasets'] if d['id'] == 'jezero-landing')
raw = np.frombuffer(gzip.decompress((PUB / info['url']).read_bytes()), dtype='<u2').reshape(info['height'], info['width'])
heights = np.where(raw == info['nodata'], np.nan, raw * info['scale'] + info['offset'])

def dtm_index(lat, lon):
    return (info['y0'] - lat * RAD * R) / info['step'], (lon * RAD * R - info['x0']) / info['step']
def dtm_bounds():
    s = info['step'] * RAD ** -1 / R
    return {'west': info['x0'] / R / RAD, 'east': (info['x0'] + (info['width'] - 1) * info['step']) / R / RAD,
            'north': info['y0'] / R / RAD, 'south': (info['y0'] - (info['height'] - 1) * info['step']) / R / RAD}

pts = route['points']
lats = [p['lat'] for p in pts] + [route['base']['lat']]; lons = [p['lon'] for p in pts] + [route['base']['lon']]
lat0 = sum(lats) / len(lats); kx = math.cos(lat0 * RAD) * R * RAD; ky = R * RAD
pad_lat, pad_lon = MARGIN_M / ky, MARGIN_M / kx
b = dtm_bounds()
box = {'south': max(min(lats) - pad_lat, b['south']), 'north': min(max(lats) + pad_lat, b['north']),
       'west': max(min(lons) - pad_lon, b['west']), 'east': min(max(lons) + pad_lon, b['east'])}
stops = [s for s in samples if box['south'] <= s['lat'] <= box['north'] and box['west'] <= s['lon'] <= box['east']]
lon0, latc = (box['west'] + box['east']) / 2, (box['south'] + box['north']) / 2
width_m, height_m = (box['east'] - box['west']) * kx, (box['north'] - box['south']) * ky
scale = TABLE_SIZE / max(width_m, height_m)
print(f'area {width_m:.0f} x {height_m:.0f} m, scale 1:{1 / scale:.0f}, {len(stops)} sample sites')

nx, nz = int(width_m // SAMPLE_M) + 1, int(height_m // SAMPLE_M) + 1
glon = np.linspace(box['west'], box['east'], nx); glat = np.linspace(box['north'], box['south'], nz)
LON, LAT = np.meshgrid(glon, glat)
ri, ci = dtm_index(LAT, LON)
r0, c0 = np.floor(ri).astype(int), np.floor(ci).astype(int); fr, fc = ri - r0, ci - c0
def at(r, c): return heights[np.clip(r, 0, info['height'] - 1), np.clip(c, 0, info['width'] - 1)]
H = (at(r0, c0) * (1 - fr) * (1 - fc) + at(r0, c0 + 1) * (1 - fr) * fc + at(r0 + 1, c0) * fr * (1 - fc) + at(r0 + 1, c0 + 1) * fr * fc)
assert np.isfinite(H).all(), 'model area must be fully inside the DTM'
hmin = float(H.min())
def height_at(lat, lon):
    r, c = dtm_index(lat, lon); r0_, c0_ = int(r), int(c); a, bb = r - r0_, c - c0_
    return float(at(r0_, c0_) * (1 - a) * (1 - bb) + at(r0_, c0_ + 1) * (1 - a) * bb + at(r0_ + 1, c0_) * a * (1 - bb) + at(r0_ + 1, c0_ + 1) * a * bb)

span = 180 / 2 ** LEVEL
tx0, tx1 = int((box['west'] + 180) // span), int((box['east'] + 180) // span)
ty0, ty1 = int((90 - box['north']) // span), int((90 - box['south']) // span)
mosaic = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), (120, 104, 92))
session = requests.Session(); fetched = 0
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        path = WORK / f'{LEVEL}_{ty}_{tx}.png'
        if not path.exists():
            r = session.get(TRE.format(z=LEVEL, y=ty, x=tx), timeout=40)
            if r.status_code == 200: path.write_bytes(r.content); fetched += 1
        if path.exists(): mosaic.paste(Image.open(path).convert('RGB'), ((tx - tx0) * 256, (ty - ty0) * 256))
mw, mn = -180 + tx0 * span, 90 - ty0 * span
px = lambda lon: (lon - mw) / span * 256; py = lambda lat: (mn - lat) / span * 256
crop = mosaic.crop((round(px(box['west'])), round(py(box['north'])), round(px(box['east'])), round(py(box['south']))))
longest = max(crop.size); tex_size = min(4096, 2 ** math.ceil(math.log2(longest)))
texture = crop.resize((tex_size, tex_size), Image.LANCZOS)
jpeg = io.BytesIO(); texture.save(jpeg, 'JPEG', quality=86, optimize=True); jpeg = jpeg.getvalue()
print(f'texture {crop.size} -> {tex_size}px, {len(jpeg) // 1024} KB, {fetched} tiles fetched')

def local(lat, lon, h, exag, lift=0.0, base=0.012):
    return ((lon - lon0) * kx * scale, base + ((h - hmin) * exag + lift) * scale, -(lat - latc) * ky * scale)

class Mesh:
    def __init__(self, material): self.p, self.n, self.uv, self.i, self.material = [], [], [], [], material
    def add(self, p, n, uv=(0, 0)): self.p.append(p); self.n.append(n); self.uv.append(uv); return len(self.p) - 1
    def tri(self, a, b, c): self.i += [a, b, c]

def build(exag):
    base = 0.012
    terrain = Mesh('terrain')
    P = np.stack([(LON - lon0) * kx * scale, base + (H - hmin) * exag * scale, -(LAT - latc) * ky * scale], -1)
    gx, gz = np.gradient(P[..., 1], axis=1) / np.gradient(P[..., 0], axis=1), np.gradient(P[..., 1], axis=0) / np.gradient(P[..., 2], axis=0)
    N = np.stack([-gx, np.ones_like(gx), -gz], -1); N /= np.linalg.norm(N, axis=-1, keepdims=True)
    for r in range(nz):
        for c in range(nx):
            terrain.add(tuple(P[r, c]), tuple(N[r, c]), (c / (nx - 1), r / (nz - 1)))
    for r in range(nz - 1):
        for c in range(nx - 1):
            a = r * nx + c; terrain.tri(a, a + nx, a + 1); terrain.tri(a + 1, a + nx, a + nx + 1)
    plinth = Mesh('plinth')
    edges = [([(0, c) for c in range(nx)], (0, 0, -1)), ([(nz - 1, c) for c in reversed(range(nx))], (0, 0, 1)),
             ([(r, nx - 1) for r in range(nz)], (1, 0, 0)), ([(r, 0) for r in reversed(range(nz))], (-1, 0, 0))]
    for cells, normal in edges:
        for (r1, c1), (r2, c2) in zip(cells, cells[1:]):
            t1, t2 = tuple(P[r1, c1]), tuple(P[r2, c2])
            a, bb = plinth.add(t1, normal), plinth.add(t2, normal)
            c_, d = plinth.add((t1[0], 0, t1[2]), normal), plinth.add((t2[0], 0, t2[2]), normal)
            plinth.tri(a, c_, bb); plinth.tri(bb, c_, d)
    x0_, x1_, z0_, z1_ = P[0, 0, 0], P[0, -1, 0], P[0, 0, 2], P[-1, 0, 2]
    q = [plinth.add((x, 0, z), (0, -1, 0)) for x, z in ((x0_, z0_), (x1_, z0_), (x0_, z1_), (x1_, z1_))]
    plinth.tri(q[0], q[1], q[2]); plinth.tri(q[1], q[3], q[2])
    ribbon = Mesh('route'); dense = []
    for a, bb in zip(pts, pts[1:]):
        n = max(1, int(math.hypot((bb['lon'] - a['lon']) * kx, (bb['lat'] - a['lat']) * ky) // 3))
        dense += [(a['lat'] + (bb['lat'] - a['lat']) * t / n, a['lon'] + (bb['lon'] - a['lon']) * t / n) for t in range(n)]
    dense.append((pts[-1]['lat'], pts[-1]['lon']))
    half = 7 * scale
    for k, (la, lo) in enumerate(dense):
        p0 = local(la, lo, height_at(la, lo), exag, lift=3)
        la2, lo2 = dense[min(k + 1, len(dense) - 1)] if k + 1 < len(dense) else dense[k - 1]
        p1 = local(la2, lo2, height_at(la2, lo2), exag, lift=3)
        dx, dz = (p1[0] - p0[0], p1[2] - p0[2]) if k + 1 < len(dense) else (p0[0] - p1[0], p0[2] - p1[2])
        L = math.hypot(dx, dz) or 1; sx, sz = -dz / L * half, dx / L * half
        ribbon.add((p0[0] + sx, p0[1], p0[2] + sz), (0, 1, 0)); ribbon.add((p0[0] - sx, p0[1], p0[2] - sz), (0, 1, 0))
        if k: a = 2 * k; ribbon.tri(a - 2, a - 1, a); ribbon.tri(a - 1, a + 1, a)
    def pin(mesh, lat, lon, height_m=110, radius_m=9, sides=12):
        g = local(lat, lon, height_at(lat, lon), exag); top = g[1] + height_m * scale; rr = radius_m * scale
        ring = [(g[0] + rr * math.cos(2 * math.pi * s / sides), g[2] + rr * math.sin(2 * math.pi * s / sides)) for s in range(sides)]
        for s in range(sides):
            (xa, za), (xb, zb) = ring[s], ring[(s + 1) % sides]
            nrm = (math.cos(2 * math.pi * (s + .5) / sides), 0, math.sin(2 * math.pi * (s + .5) / sides))
            a = mesh.add((xa, g[1], za), nrm); bb = mesh.add((xb, g[1], zb), nrm); c_ = mesh.add((xa, top, za), nrm); d = mesh.add((xb, top, zb), nrm)
            mesh.tri(a, c_, bb); mesh.tri(bb, c_, d)
            cap = mesh.add((g[0], top + rr * 2.2, g[2]), (0, 1, 0)); e = mesh.add((xa, top, za), (0, 1, 0)); f = mesh.add((xb, top, zb), (0, 1, 0))
            mesh.tri(e, cap, f)
        return (g[0], top + rr * 3, g[2])
    base_pin = Mesh('base'); sci = Mesh('science')
    anchors = [{'id': 'base', 'label': 'A · Base', 'position': pin(base_pin, route['base']['lat'], route['base']['lon'], 150, 12)},
               {'id': 'dest', 'label': 'B · ' + route['dest']['name'], 'position': None}]
    seen = {}
    for s in stops:
        key = (s['lat'], s['lon'])
        if key in seen: seen[key]['label'] += ' · ' + s['name'].split(' (')[0]; continue
        seen[key] = {'id': f"s{s['number']}", 'label': s['name'].split(' (')[0], 'detail': f"{s['rock']}, sealed sol {s['sol']}", 'position': pin(sci, s['lat'], s['lon'])}
    anchors += list(seen.values())
    dest_g = local(route['dest']['lat'], route['dest']['lon'], height_at(route['dest']['lat'], route['dest']['lon']), exag, lift=3)
    anchors[1]['position'] = (dest_g[0], dest_g[1] + 0.004, dest_g[2])
    return [terrain, plinth, ribbon, base_pin, sci], anchors

MATERIALS = {
    'terrain': {'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}},
    'plinth': {'pbrMetallicRoughness': {'baseColorFactor': [0.09, 0.06, 0.045, 1], 'metallicFactor': 0, 'roughnessFactor': .9}},
    'route': {'pbrMetallicRoughness': {'baseColorFactor': [1, 0.55, 0.22, 1], 'metallicFactor': 0, 'roughnessFactor': .6}, 'emissiveFactor': [1, 0.45, 0.12], 'doubleSided': True},
    'base': {'pbrMetallicRoughness': {'baseColorFactor': [1, 0.61, 0.3, 1], 'metallicFactor': 0, 'roughnessFactor': .5}, 'emissiveFactor': [0.5, 0.25, 0.08]},
    'science': {'pbrMetallicRoughness': {'baseColorFactor': [0.48, 0.83, 1, 1], 'metallicFactor': 0, 'roughnessFactor': .5}, 'emissiveFactor': [0.15, 0.35, 0.5]},
}

def write_glb(meshes, path):
    binary, views, accessors, gl_meshes, nodes, materials = bytearray(), [], [], [], [], []
    def view(data, target=None):
        while len(binary) % 4: binary.append(0)
        views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data), **({'target': target} if target else {})})
        binary.extend(data); return len(views) - 1
    def accessor(arr, kind, ctype, target, minmax=False):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': ctype, 'count': len(arr), 'type': kind}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accessors.append(a); return len(accessors) - 1
    image_view = view(jpeg)
    for m in meshes:
        if not m.i: continue
        materials.append({'name': m.material, **MATERIALS[m.material]})
        attrs = {'POSITION': accessor(np.array(m.p, np.float32), 'VEC3', 5126, 34962, True), 'NORMAL': accessor(np.array(m.n, np.float32), 'VEC3', 5126, 34962)}
        if m.material == 'terrain': attrs['TEXCOORD_0'] = accessor(np.array(m.uv, np.float32), 'VEC2', 5126, 34962)
        idx = accessor(np.array(m.i, np.uint32), 'SCALAR', 5125, 34963)
        gl_meshes.append({'name': m.material, 'primitives': [{'attributes': attrs, 'indices': idx, 'material': len(materials) - 1}]})
        nodes.append({'mesh': len(gl_meshes) - 1, 'name': m.material})
    gltf = {'asset': {'version': '2.0', 'generator': 'MartisDux build-ar-model.py',
                      'copyright': 'Terrain and imagery: NASA/JPL-Caltech/University of Arizona/USGS. Model: Team MartisDux.'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': gl_meshes, 'materials': materials,
            'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
            'images': [{'bufferView': image_view, 'mimeType': 'image/jpeg'}], 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': 0}]}
    while len(binary) % 4: binary.append(0)
    gltf['buffers'][0]['byteLength'] = len(binary)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    data = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + bytes(binary)
    path.write_bytes(data); return len(data)

sidecar = {'title': 'Jezero Marswalk · tabletop', 'scale': f'1:{round(1 / scale)}', 'areaMetres': [round(width_m), round(height_m)],
           'reliefMetres': round(float(H.max() - hmin), 1), 'route': {'distance': round(route['distance']), 'maxSlope': round(route['maxSlope'], 1)},
           'sources': {'terrain': info['original'], 'imagery': TRE.split('{z}')[0], 'samples': 'https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/'},
           'models': {}}
for exag in (1, 3):
    meshes, anchors = build(exag)
    name = f'jezero-marswalk-x{exag}.glb'
    size = write_glb(meshes, OUT / name)
    sidecar['models'][f'x{exag}'] = {'file': name, 'bytes': size, 'sha256': hashlib.sha256((OUT / name).read_bytes()).hexdigest(),
                                     'anchors': [{**a, 'position': [round(v, 4) for v in a['position']]} for a in anchors]}
    print(name, f'{size / 1e6:.1f} MB', sum(len(m.p) for m in meshes), 'vertices')
(OUT / 'jezero-marswalk.json').write_text(json.dumps(sidecar, indent=1) + '\n')
