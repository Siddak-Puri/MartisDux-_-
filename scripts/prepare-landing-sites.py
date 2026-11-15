"""Candidate human landing sites from NASA's First Landing Site / Exploration Zone
Workshop (Houston, October 2015).

Names and latitudes: Bussey & Hoffman (2016), "Human Mars Landing Site and Impacts
on Mars Surface Operations", IEEE Aerospace Conference, NASA NTRS 20160001040,
Appendix D ("Summary of proposed EZ and ROI locations").
Marker position: centre of the named feature in the IAU/USGS Gazetteer of
Planetary Nomenclature, used only where the Gazetteer feature lies within 3°
of latitude of the proposal (otherwise the site is omitted rather than guessed).
These are feature centres, not the proposers' exact landing ellipses.

  python scripts/prepare-landing-sites.py
Output: public/data/landing-sites.json
"""
from pathlib import Path
import datetime, hashlib, io, json, os, re, struct, zipfile
import requests
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'landing-sites'
WORK.mkdir(parents=True, exist_ok=True)
NTRS = 'https://ntrs.nasa.gov/api/citations/20160001040/downloads/20160001040.pdf'
GAZ = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip'

def cached(name, url):
    p = WORK / name
    if not p.exists():
        r = requests.get(url, timeout=120); r.raise_for_status(); p.write_bytes(r.content)
    return p

pdf = cached('bussey-hoffman-2016.pdf', NTRS)
text = '\n'.join(page.extract_text() or '' for page in PdfReader(pdf).pages)
start = text.rindex('SUMMARY OF PROPOSED EZ AND ROI LOCATIONS')
appendix = text[start:text.index('REFERENCES', start)]
row = re.compile(r'^(?P<who>.+?)\s+(?P<site>[A-Z][A-Za-z’\'\- –]+?)\s+(?P<abs>10\d\d)\s+(?P<id>\d+)\s+(?P<lat>\d+(?:\.\d+)?)(?P<ns>[NS])\s*$')
proposals = {}
for line in appendix.splitlines():
    m = row.match(line.strip())
    if not m: continue
    lat = float(m['lat']) * (1 if m['ns'] == 'N' else -1)
    proposals.setdefault(m['id'], {'raw': line.strip(), 'lat': lat, 'abstracts': set()})['abstracts'].add(int(m['abs']))

SITES = {
    '27': ('Huygens Crater', 'Huygens'), '1': ('Phlegra Dorsa', 'Phlegra Dorsa'), '2': ('Southern Nectaris Fossae', 'Nectaris Fossae'),
    '3': ('Gale Crater', 'Gale'), '43': ('Endeavour Crater', 'Endeavour'), '41': ('Eastern Valles Marineris', None),
    '4': ('Meridiani Planum', 'Meridiani Planum'), '5': ('Hebrus Valles', 'Hebrus Valles'), '22': ('Chryse Planitia (Viking 1)', 'Chryse Planitia'),
    '28': ('Mesopotamia', None), '40': ('Protonilus Mensae', 'Protonilus Mensae'), '42': ('Tempe Terra', 'Tempe Terra'),
    '15': ('Hypanis Valles', 'Hypanis Valles'), '35': ('Ausonia Cavus', 'Ausonia Cavus'), '36': ('Kasei Valles', 'Kasei Valles'),
    '9': ('Deuteronilus Mensae', 'Deuteronilus Mensae'), '34': ('Deuteronilus Mensae (north)', 'Deuteronilus Mensae'), '23': ('Noachis Terra', None),
    '7': ('Mawrth Vallis', 'Mawrth Vallis'), '8': ('Apollinaris Sulci', 'Apollinaris Sulci'), '37': ('Apollinaris Sulci (south)', 'Apollinaris Sulci'),
    '10': ('Valles Marineris mouth', None), '20': ('Newton Crater', 'Newton'), '39': ('Noctis Landing', 'Noctis Labyrinthus'),
    '30': ('Hellas rim', None), '11': ('Gusev Crater', 'Gusev'), '32': ('Columbus Crater', 'Columbus'), '19': ('Ismenius Cavus', 'Ismenius Cavus'),
    '12': ('Nili Fossae', 'Nili Fossae'), '13': ('Melas Chasma', 'Melas Chasma'), '25': ('McLaughlin Crater', 'McLaughlin'),
    '24': ('Equatorial Valles Marineris', None), '29': ('Coprates Chasma', 'Coprates Chasma'), '6': ('Jezero Crater', 'Jezero'),
    '14': ('Firsoff Crater', 'Firsoff'), '31': ('Eastern Hellas', None), '38': ('Aram Chaos', 'Aram Chaos'), '16': ('Hadriacus Palus', 'Hadriacus Palus'),
    '26': ('Hale Crater', 'Hale'), '17': ('Erebus Montes', 'Erebus Montes'), '18': ('Acheron Fossae', 'Acheron Fossae'),
    '44': ('Copernicus Crater', 'Copernicus'), '33': ('Sinus Meridiani', 'Sinus Meridiani'), '21': ('Cerberus', 'Cerberus Fossae'),
}

zf = zipfile.ZipFile(cached('MARS_nomenclature_center_pts.zip', GAZ))
dbf = zf.read(next(n for n in zf.namelist() if n.endswith('.dbf')))
count, header_len, record_len = struct.unpack('<IHH', dbf[4:12])
fields, off = [], 32
while dbf[off] != 0x0D:
    fields.append((dbf[off:off + 11].split(b'\0')[0].decode(), dbf[off + 16])); off += 32
features = {}
for i in range(count):
    rec = dbf[header_len + i * record_len: header_len + (i + 1) * record_len]
    pos, row_ = 1, {}
    for name, length in fields:
        row_[name] = rec[pos:pos + length].decode('utf-8', 'replace').strip(); pos += length
    features[row_['clean_name']] = row_

sites, skipped = [], []
for ez, p in sorted(proposals.items(), key=lambda kv: int(kv[0])):
    name, feature = SITES.get(ez, (None, None))
    f = features.get(feature) if feature else None
    if not name: skipped.append((ez, p['raw'], 'unmapped')); continue
    if not f: skipped.append((ez, name, 'no single named feature')); continue
    flat, flon = float(f['center_lat']), float(f['center_lon'])
    flon = flon - 360 if flon > 180 else flon
    if abs(flat - p['lat']) > 3: skipped.append((ez, name, f'feature centre {flat:.1f}° vs proposal {p["lat"]}°')); continue
    sites.append({'ez': int(ez), 'name': name, 'proposalLat': p['lat'], 'lat': round(flat, 4), 'lon': round(flon, 4),
                  'feature': feature, 'type': f['type'], 'abstracts': sorted(p['abstracts']), 'gazetteer': f['link'].replace('http://', 'https://')})

out = ROOT / 'public' / 'data' / 'landing-sites.json'
out.write_text(json.dumps({
    'generated': datetime.date.today().isoformat(),
    'title': 'Candidate human landing sites / Exploration Zones (NASA workshop, 2015)',
    'source': NTRS, 'sourceSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
    'positions': GAZ, 'method': 'Names and latitudes from Bussey & Hoffman (2016) Appendix D; marker at the IAU/USGS Gazetteer feature centre when within 3° latitude of the proposal. Regional proposals without a single named feature are omitted.',
    'sites': sites, 'omitted': [{'ez': int(e), 'name': n, 'reason': r} for e, n, r in skipped]}, indent=1) + '\n')
print(len(proposals), 'proposals;', len(sites), 'placed;', len(skipped), 'omitted')
for s in sites: print(f"EZ{s['ez']:>2} {s['name']:<32} {s['lat']:>8} {s['lon']:>9}  (table {s['proposalLat']})")
for s in skipped: print('omit', s)
