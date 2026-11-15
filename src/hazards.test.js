import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { computeSlope, findSafePath, routeProfile, slopeAt, slopeClass, cellOf, pointOf, walkCost, gridFor } from './hazards.js';
import { MARS_RADIUS } from './data.js';

const rad = Math.PI / 180;
function grid(width, height, heightFn, step = 10) {
  const values = new Uint16Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = Math.round((heightFn(c * step, r * step) + 100) / 0.05);
  return { id: 'test', values, width, height, step, x0: 0, y0: (height - 1) * step / 2, scale: 0.05, offset: -100, nodata: 65535 };
}

test('Horn slope recovers a known incline', () => {
  const s = computeSlope(grid(30, 30, x => x * Math.tan(20 * rad)));
  const mid = s.slope[15 * s.width + 15];
  assert.ok(Math.abs(mid - 20) < 0.3, `expected ~20°, got ${mid}`);
  assert.ok(Number.isNaN(s.slope[0]), 'edges are unmapped');
});

test('nodata stays unmapped', () => {
  const g = grid(10, 10, () => 0); g.values[55] = g.nodata;
  const s = computeSlope(g);
  assert.ok(Number.isNaN(s.slope[55]) && Number.isNaN(s.slope[54]));
});

test('slope classes and costs are ordered', () => {
  assert.equal(slopeClass(5).id, 'easy');
  assert.equal(slopeClass(15).id, 'caution');
  assert.equal(slopeClass(25).id, 'steep');
  assert.equal(slopeClass(40).id, 'nogo');
  assert.ok(walkCost(0) < walkCost(10) && walkCost(10) < walkCost(20));
  assert.equal(walkCost(26), Infinity);
});

test('cell and point conversion round-trip', () => {
  const s = computeSlope(grid(20, 20, () => 0));
  const p = pointOf(s, 7, 11), c = cellOf(s, p);
  assert.deepEqual([c.col, c.row], [7, 11]);
});

test('safe path detours around a steep ridge the direct line crosses', () => {
  const g = grid(60, 60, (x, y) => (x >= 280 && x <= 310 && y < 480) ? 40 : 0);
  const s = computeSlope(g);
  const A = pointOf(s, 10, 20), B = pointOf(s, 50, 20);
  const direct = routeProfile(s, [A, B]);
  assert.ok(direct.maxSlope > 30, 'direct line hits the wall');
  const path = findSafePath(s, A, B);
  const safe = routeProfile(s, path);
  assert.ok(safe.maxSlope <= 25.5, `safe max ${safe.maxSlope}`);
  assert.ok(safe.distance > direct.distance, 'detour is longer');
  assert.deepEqual(path[0], A); assert.deepEqual(path.at(-1), B);
});

test('flat ground gives a near-straight path', () => {
  const s = computeSlope(grid(50, 50, () => 0));
  const A = pointOf(s, 5, 5), B = pointOf(s, 44, 30);
  const path = findSafePath(s, A, B), p = routeProfile(s, path), d = routeProfile(s, [A, B]);
  assert.ok(path.length <= 4, `smoothed to ${path.length} points`);
  assert.ok(p.distance < d.distance * 1.02);
});

test('unreachable destination explains why', () => {
  const g = grid(40, 40, (x, y) => Math.hypot(x - 200, y - 200) < 60 ? -60 : 0);
  const s = computeSlope(g);
  assert.throws(() => findSafePath(s, pointOf(s, 3, 3), pointOf(s, 20, 20)), /No walkable route/);
});

test('real Jezero DTM: slope, routing speed and hazard avoidance', () => {
  const meta = JSON.parse(readFileSync(new URL('../public/terrain/jezero.json', import.meta.url)));
  const grids = meta.datasets.map(info => {
    const buf = gunzipSync(readFileSync(new URL(`../public/${info.url}`, import.meta.url)));
    return { ...info, values: new Uint16Array(buf.buffer, buf.byteOffset, info.width * info.height) };
  });
  const context = computeSlope(grids.find(g => g.id === 'jezero-context'), 2);
  const landing = computeSlope(grids.find(g => g.id === 'jezero-landing'), 4);
  const finite = [...context.slope].filter(Number.isFinite);
  assert.ok(finite.length > 100_000);
  assert.ok(finite.reduce((m, v) => Math.max(m, v), 0) > 25, 'Jezero has steep terrain somewhere (delta front / crater rim)');
  const A = { lat: 18.4447, lon: 77.4508 };
  assert.equal(gridFor([landing, context], A), landing);
  const B = { lat: 18.48, lon: 77.40 };
  const s = gridFor([landing, context], A, B);
  assert.equal(s, context);
  const t0 = performance.now();
  const path = findSafePath(s, A, B);
  const ms = performance.now() - t0;
  const p = routeProfile(s, path);
  assert.ok(ms < 3000, `routing took ${ms.toFixed(0)} ms`);
  assert.ok(p.maxSlope <= 25.5, `max ${p.maxSlope}`);
  console.log(`    jezero route: ${path.length} pts, ${(p.distance / 1000).toFixed(2)} km, max ${p.maxSlope.toFixed(1)}°, ${ms.toFixed(0)} ms`);
  assert.ok(Number.isFinite(slopeAt(landing, A)));
});

test('real Gale DTM: Bradbury Landing toward Mount Sharp', () => {
  const meta = JSON.parse(readFileSync(new URL('../public/terrain/gale.json', import.meta.url)));
  const load = id => { const info = meta.datasets.find(d => d.id === id); const buf = gunzipSync(readFileSync(new URL(`../public/${info.url}`, import.meta.url))); return { ...info, values: new Uint16Array(buf.buffer, buf.byteOffset, info.width * info.height) }; };
  const landing = computeSlope(load('gale-landing'), 4), context = computeSlope(load('gale-context'), 2);
  const A = { lat: -4.5895, lon: 137.4417 }, B = { lat: -4.75, lon: 137.40 };
  assert.equal(gridFor([landing, context], A), landing);
  const s = gridFor([landing, context], A, B);
  assert.equal(s, context);
  const t0 = performance.now(), path = findSafePath(s, A, B), ms = performance.now() - t0;
  const p = routeProfile(s, path), d = routeProfile(s, [A, B]);
  console.log(`    gale route: ${(p.distance / 1000).toFixed(2)} km max ${p.maxSlope.toFixed(1)}° (direct ${d.maxSlope.toFixed(1)}°), climb ${p.ascent.toFixed(0)} m, ${ms.toFixed(0)} ms`);
  assert.ok(p.maxSlope <= 25.5 && ms < 3000);
});
