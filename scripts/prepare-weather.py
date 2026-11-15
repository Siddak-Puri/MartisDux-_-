"""Surface conditions: bundled offline copy of NASA's rover weather records.

- Curiosity REMS (Gale crater) daily summaries, 2012 onward: latest sols plus a
  climatology binned by solar longitude (Ls), so an EVA on any future date gets
  the range of conditions actually measured in that season.
- Perseverance MEDA (Jezero) sols from the public feed, compared with REMS on
  the same Earth dates to show how Jezero differs from Gale.

  python scripts/prepare-weather.py
Output: public/data/weather/conditions.json
"""
from pathlib import Path
import datetime, hashlib, json, os, statistics
import requests

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('LOCALAPPDATA', ROOT.parent.parent / 'work')) / 'martisdux-work' / 'weather'
WORK.mkdir(parents=True, exist_ok=True)
FEED = 'https://mars.nasa.gov/rss/api/?feed=weather&category={}&feedtype=json'
BIN = 10

def get(category):
    path = WORK / f'{category}.json'
    if not path.exists():
        r = requests.get(FEED.format(category), timeout=60); r.raise_for_status(); path.write_bytes(r.content)
    return path

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

rems_path, meda_path = get('msl'), get('mars2020')
rems = json.loads(rems_path.read_text(encoding='utf-8'))['soles']
meda = json.loads(meda_path.read_text(encoding='utf-8'))['sols']

rows = []
for s in rems:
    ls = num(s.get('ls'))
    if ls is None: continue
    rows.append({'date': s['terrestrial_date'], 'sol': int(s['sol']), 'ls': ls,
                 'airMin': num(s.get('min_temp')), 'airMax': num(s.get('max_temp')),
                 'groundMin': num(s.get('min_gts_temp')), 'groundMax': num(s.get('max_gts_temp')),
                 'pressure': num(s.get('pressure')), 'uv': s.get('local_uv_irradiance_index') if s.get('local_uv_irradiance_index') not in ('--', '') else None,
                 'opacity': s.get('atmo_opacity'), 'sunrise': s.get('sunrise'), 'sunset': s.get('sunset')})
rows.sort(key=lambda r: r['sol'])

def pct(values, q):
    v = sorted(values); return round(v[min(len(v) - 1, int(q * (len(v) - 1) + .5))], 1)

climate = []
for b in range(0, 360, BIN):
    sel = [r for r in rows if b <= r['ls'] < b + BIN]
    entry = {'ls': b, 'sols': len(sel), 'years': len({r['date'][:4] for r in sel})}
    for key in ('airMin', 'airMax', 'groundMin', 'groundMax', 'pressure'):
        vals = [r[key] for r in sel if r[key] is not None]
        if vals: entry[key] = {'p10': pct(vals, .1), 'median': round(statistics.median(vals), 1), 'p90': pct(vals, .9), 'n': len(vals)}
    uv = [r['uv'] for r in sel if r['uv']]
    entry['uv'] = {k: round(uv.count(k) / len(uv), 3) for k in sorted(set(uv))} if uv else {}
    op = [r['opacity'] for r in sel if r['opacity']]
    entry['opacity'] = {k: round(op.count(k) / len(op), 3) for k in sorted(set(op))} if op else {}
    climate.append(entry)

by_date = {r['date']: r for r in rows}
compare = []
for m in meda:
    g = by_date.get(m['terrestrial_date'])
    jmin, jmax, jp = num(m.get('min_temp')), num(m.get('max_temp')), num(m.get('pressure'))
    if g and jmin is not None and jmax is not None and g['airMin'] is not None:
        compare.append({'date': m['terrestrial_date'], 'ls': num(m['ls']), 'jezero': {'airMin': jmin, 'airMax': jmax, 'pressure': jp},
                        'gale': {'airMin': g['airMin'], 'airMax': g['airMax'], 'pressure': g['pressure']}})

out = ROOT / 'public' / 'data' / 'weather'; out.mkdir(parents=True, exist_ok=True)
(out / 'conditions.json').write_text(json.dumps({
    'generated': datetime.date.today().isoformat(),
    'station': {'name': 'Curiosity REMS', 'site': 'Gale crater', 'lat': -4.59, 'lon': 137.44,
                'credit': 'NASA/JPL-Caltech/Centro de Astrobiología (CAB)', 'feed': FEED.format('msl'),
                'note': 'REMS daily summaries are provided by CAB for outreach; scientific data are in the NASA PDS.'},
    'jezero': {'name': 'Perseverance MEDA', 'feed': FEED.format('mars2020'), 'credit': 'NASA/JPL-Caltech/CAB', 'sharedSols': compare},
    'sha256': {'msl': hashlib.sha256(rems_path.read_bytes()).hexdigest(), 'mars2020': hashlib.sha256(meda_path.read_bytes()).hexdigest()},
    'binDegrees': BIN, 'climate': climate, 'latest': rows[-20:], 'firstSol': rows[0]['date'], 'lastSol': rows[-1]['date'], 'totalSols': len(rows),
}, separators=(',', ':')) + '\n')
print(len(rows), 'REMS sols', rows[0]['date'], 'to', rows[-1]['date'], '| shared MEDA sols', len(compare))
for c in climate[::6]: print(c['ls'], c['sols'], c.get('airMin', {}).get('median'), c.get('airMax', {}).get('median'), c['uv'], c['opacity'])
