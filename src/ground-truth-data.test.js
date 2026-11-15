import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = name => JSON.parse(readFileSync(new URL(`../public/data/perseverance/${name}.json`, import.meta.url)));

test('validation summary is reproducible from its own rows', () => {
  const v = load('validation');
  assert.equal(v.rows.length, v.compared);
  for (const [key, f] of Object.entries(v.footprints)) {
    const rows = v.rows.filter(r => r[key] !== null);
    const err = rows.map(r => r[key] - r.tilt);
    const mae = err.reduce((s, e) => s + Math.abs(e), 0) / err.length;
    assert.equal(f.n, rows.length, key);
    assert.ok(Math.abs(mae - f.mae) < 0.02, `${key} MAE ${mae} vs ${f.mae}`);
    const within5 = err.filter(e => Math.abs(e) <= 5).length / err.length;
    assert.ok(Math.abs(within5 - f.within5) < 0.002, key);
  }
  assert.ok(v.footprints.dtm16.mae < v.baseline.mae / 2);
});

test('waypoints sit inside the Jezero HiRISE footprint and carry physical tilts', () => {
  const v = load('validation');
  for (const r of v.rows) {
    assert.ok(r.lat > 18.3 && r.lat < 18.7 && r.lon > 77.2 && r.lon < 77.6, r.rmc);
    assert.ok(r.tilt >= 0 && r.tilt < 35 && r.dtm16 >= 0 && r.dtm16 < 60, r.rmc);
  }
});

test('route check numbers are internally consistent', () => {
  const r = load('routes'), t = load('traverse');
  assert.equal(r.results.length, r.planned);
  const share = Object.values(r.roverPath.classShare).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(share - 1) < 0.01);
  assert.ok(t.drives.length > 500 && t.totalMetres > 40000);
});
