import test from 'node:test';
import assert from 'node:assert/strict';
import Lerc from 'lerc';
import { routeWindow, tilesFor, demGrid, sampleSpacing } from './global-dem.js';
import { computeSlope, findSafePath, routeProfile, cellOf } from './hazards.js';

const URL = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer';
async function fetchTile(x, y, level) {
  const response = await fetch(`${URL}/tile/${level}/${y}/${x}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('tile unavailable');
  const d = Lerc.decode(await response.arrayBuffer());
  return { values: d.pixels[0], width: d.width, height: d.height, nodata: d.statistics?.[0]?.noDataValue };
}

test('route window picks a finer level for shorter routes', () => {
  const short = routeWindow({ lat: -5, lon: 137.4 }, { lat: -5.1, lon: 137.5 });
  const long = routeWindow({ lat: -5, lon: 120 }, { lat: -12, lon: 140 });
  assert.equal(short.level, 7);
  assert.ok(long.level < short.level);
  assert.equal(routeWindow({ lat: 0, lon: -170 }, { lat: 0, lon: 170 }), null);
  assert.ok(Math.abs(sampleSpacing(7) - 162.7) < 1);
});

test('tile index range covers the box', () => {
  const t = tilesFor({ west: -1, east: 1, south: -1, north: 1 }, 7);
  assert.ok(t.x1 > t.x0 && t.y1 > t.y0);
});

test('real DEM: safe descent into Valles Marineris avoids the cliffs', { timeout: 60000 }, async (t) => {
  const A = { lat: -9.0, lon: -73.0 }, B = { lat: -10.0, lon: -73.0 };
  const w = routeWindow(A, B);
  let grid;
  try { grid = await demGrid(fetchTile, w.box, w.level); } catch (e) { t.skip(`offline: ${e.message}`); return; }
  const s = computeSlope(grid);
  assert.ok(cellOf(s, A) && cellOf(s, B));
  const direct = routeProfile(s, [A, B]);
  const t0 = performance.now();
  const path = findSafePath(s, A, B);
  const ms = performance.now() - t0;
  const safe = routeProfile(s, path);
  console.log(`    valles: L${w.level} ${s.width}×${s.height}, direct max ${direct.maxSlope.toFixed(1)}°, safe max ${safe.maxSlope.toFixed(1)}° ${(safe.distance / 1000).toFixed(1)} km vs ${(direct.distance / 1000).toFixed(1)} km, ${ms.toFixed(0)} ms`);
  assert.ok(safe.maxSlope <= 25.5);
});
