"""Science stops: Perseverance's sealed sample tubes placed on its recorded route.

Facts (sample name, number, feature, type, sol sealed, rock type) come from NASA's
official sample list. Each sample is located at the rover's last recorded MMGIS
waypoint on or before the sol it was sealed (the rover does not drive while
coring, so this is its sampling position to within localisation accuracy).

  python scripts/prepare-science.py
Output: public/data/perseverance/samples.json
"""
from pathlib import Path
import html, json, os, re, hashlib, datetime
import requests

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'm20'
WORK.mkdir(parents=True, exist_ok=True)
PAGE = 'https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/'
WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json'

def cached(name, url):
    path = WORK / name
    if not path.exists():
        r = requests.get(url, timeout=60); r.raise_for_status(); path.write_bytes(r.content)
    return path

raw = cached('samples.html', PAGE).read_text(encoding='utf-8', errors='ignore')
text = re.sub(r'<script.*?</script>|<style.*?</style>', '', raw, flags=re.S)
text = html.unescape(re.sub(r'<[^>]+>', '\n', text)).replace(' ', ' ').replace('�', ' ')
lines = [l.strip() for l in text.split('\n') if l.strip()]

samples = []
for i, line in enumerate(lines):
    m = re.fullmatch(r'Sample No\. (\d+)', line)
    if not m: continue
    name = lines[i - 1]
    if name.startswith('('): name = f'{lines[i - 2]} {name}'
    rec = {'number': int(m.group(1)), 'name': name}
    for j in range(i + 1, min(i + 30, len(lines)) - 1):
        key = lines[j].rstrip(':')
        if lines[j].endswith(':') and key in ('Feature Name', 'Sample Type', 'Sol Sealed', 'Date Sealed', 'Rock Type', 'Current Location'):
            rec[key] = lines[j + 1].strip()
        if re.fullmatch(r'Sample No\. \d+', lines[j]): break
    if 'Sol Sealed' in rec and rec['Sol Sealed'].isdigit(): samples.append(rec)
assert len(samples) >= 20, f'parsed only {len(samples)} samples; page layout changed?'

wps = sorted((f['properties'] for f in json.loads(cached('M20_waypoints.json', WAYPOINTS).read_text())['features']), key=lambda p: (p['sol'], p['dist_total_m']))
stops = []
for s in sorted(samples, key=lambda s: s['number']):
    sol = int(s['Sol Sealed'])
    before = [w for w in wps if w['sol'] <= sol]
    if not before: continue
    w = before[-1]
    kind = s.get('Sample Type', '')
    stops.append({'number': s['number'], 'name': s['name'], 'feature': s.get('Feature Name'), 'type': kind,
                  'rock': s.get('Rock Type'), 'sol': sol, 'date': s.get('Date Sealed'), 'stored': s.get('Current Location'),
                  'lat': round(w['lat'], 7), 'lon': round(w['lon'], 7), 'waypoint': w['RMC'], 'waypointSol': w['sol']})

out = ROOT / 'public' / 'data' / 'perseverance' / 'samples.json'
out.write_text(json.dumps({
    'generated': datetime.date.today().isoformat(), 'source': PAGE, 'positions': WAYPOINTS,
    'sourceSha256': hashlib.sha256((WORK / 'samples.html').read_bytes()).hexdigest(),
    'method': 'Sample facts from the NASA sample list; position = last MMGIS waypoint on or before the sol sealed.',
    'credit': 'NASA/JPL-Caltech', 'samples': stops}, indent=1) + '\n')
print(len(stops), 'samples'); [print(s['number'], s['name'], s['type'], s['rock'], s['sol'], s['lat'], s['lon']) for s in stops]
