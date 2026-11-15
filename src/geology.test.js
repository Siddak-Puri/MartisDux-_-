import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gridIndex, unitAt, unitsAlong, describeAge } from './geology.js';

const meta = JSON.parse(readFileSync(new URL('../public/data/geology/units.json', import.meta.url)));

test('grid index follows the documented layout', () => {
  assert.equal(gridIndex(-180, 90, 360, 180), 0);
  assert.equal(gridIndex(179.99, -89.99, 360, 180), 360 * 180 - 1);
  assert.equal(gridIndex(0.5, 0.5, 360, 180), 89 * 360 + 180);
  assert.equal(gridIndex(180, 0, 360, 180), gridIndex(-180, 0, 360, 180), 'longitude wraps');
});

test('unit lookup and stretches along a path', () => {
  const units = [{ code: 'A' }, { code: 'B' }];
  const geology = { width: 4, height: 2, units, values: new Uint8Array([1, 1, 2, 2, 1, 1, 2, 2]) };
  assert.equal(unitAt(geology, { lon: -10, lat: 10 }).code, 'A');
  assert.equal(unitAt(geology, { lon: 10, lat: -10 }).code, 'B');
  const path = [{ lon: -1, lat: 0 }, { lon: -0.5, lat: 0 }, { lon: 0.5, lat: 0 }, { lon: 1, lat: 0 }];
  const stretches = unitsAlong(geology, path);
  assert.deepEqual(stretches.map(s => s.unit.code), ['A', 'B']);
  assert.ok(stretches[1].to > stretches[1].from);
});

test('SIM 3292 metadata: units, ages and coverage', () => {
  assert.equal(meta.units.length, 44);
  assert.equal(meta.grid.width, 5760);
  assert.ok(meta.grid.coverage > .99);
  const cap = meta.units.find(u => u.code === 'lApc');
  assert.equal(cap.epoch, 'Late Amazonian');
  assert.match(describeAge(cap), /younger than 0.33 billion/);
  const hnt = meta.units.find(u => u.code === 'HNt');
  assert.equal(hnt.period, 'Noachian to Hesperian');
  assert.match(describeAge(hnt), /4.1–3.37/);
});

test('local Jezero geology (USGS SIM 3464) finds the right units at known sites', async () => {
  const fs = await import('node:fs');
  const { localUnitAt } = await import('./geology.js');
  const meta = JSON.parse(fs.readFileSync(new URL('../public/data/geology/jezero/units.json', import.meta.url), 'utf8'));
  assert.ok(meta.units.find(u => u.code === 'Aeb').hazard === 'avoid');
  const local = { ...meta, ppd: 1, width: 1, height: 1, values: new Uint8Array([meta.units.findIndex(u => u.code === 'Njf') + 1]),
    bounds: { west: 77, east: 78, south: 18, north: 19 } };
  assert.equal(localUnitAt(local, { lat: 18.4446, lon: 77.4509 }).code, 'Njf');
  assert.equal(localUnitAt(local, { lat: 17.5, lon: 77.4 }), null);
});
