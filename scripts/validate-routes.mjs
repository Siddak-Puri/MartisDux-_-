import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { computeSlope, findSafePath, routeProfile, cellOf } from '../src/hazards.js';
import { MARS_RADIUS } from '../src/data.js';

const root = new URL('../public/', import.meta.url);
const rad = Math.PI / 180;
const LEG_PATH = 1000, MIN_CHORD = 350;

const meta = JSON.parse(readFileSync(new URL('terrain/jezero.json', root)));
const info = meta.datasets.find(d => d.id === 'jezero-context');
const buf = gunzipSync(readFileSync(new URL(info.url, root)));
const grid = computeSlope({ ...info, values: new Uint16Array(buf.buffer, buf.byteOffset, info.width * info.height) }, 1);

const traverse = JSON.parse(readFileSync(new URL('data/perseverance/traverse.json', root)));
const lat0 = 18.44 * rad, kx = rad * MARS_RADIUS * Math.cos(lat0), ky = rad * MARS_RADIUS;
const xy = p => [p.lon * kx, p.lat * ky];
const metres = (a, b) => Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * ky);
const mapped = p => { const c = cellOf(grid, p); return c && Number.isFinite(grid.slope[c.i]); };

const runs = [[]];
for (const d of traverse.drives) for (const [lon, lat] of d.c) {
  const p = { lat, lon, sol: d.sol }, run = runs.at(-1), last = run.at(-1);
  if (!mapped(p) || (last && metres(last, p) > 60)) { if (run.length) runs.push([]); if (!mapped(p)) continue; }
  runs.at(-1).push(p);
}

const legs = [];
for (const run of runs) {
  let start = 0, acc = 0;
  for (let i = 1; i < run.length; i++) {
    acc += metres(run[i - 1], run[i]);
    if (acc >= LEG_PATH) {
      const leg = run.slice(start, i + 1);
      if (metres(leg[0], leg.at(-1)) >= MIN_CHORD) legs.push(leg);
      start = i; acc = 0;
    }
  }
}

function densify(points, spacing = 4) {
  const out = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], n = Math.max(1, Math.ceil(metres(a, b) / spacing));
    for (let t = 1; t <= n; t++) out.push({ lat: a.lat + (b.lat - a.lat) * t / n, lon: a.lon + (b.lon - a.lon) * t / n });
  }
  return out;
}
function distToPolyline(p, poly) {
  const [px, py] = xy(p); let best = Infinity;
  for (let k = 1; k < poly.length; k++) {
    const [ax, ay] = poly[k - 1], [bx, by] = poly[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}
function deviation(route, roverXY) {
  const d = densify(route).map(p => distToPolyline(p, roverXY)).sort((a, b) => a - b);
  return { mean: d.reduce((s, v) => s + v, 0) / d.length, p90: d[Math.floor(d.length * 0.9)], within50: d.filter(v => v <= 50).length / d.length };
}

const results = [];
let failed = 0;
const t0 = performance.now();
for (const leg of legs) {
  const A = leg[0], B = leg.at(-1), roverXY = leg.map(xy);
  let planned;
  try { planned = findSafePath(grid, A, B); } catch { failed++; continue; }
  const p = deviation(planned, roverXY), s = deviation([A, B], roverXY);
  const roverLen = leg.slice(1).reduce((sum, q, i) => sum + metres(leg[i], q), 0);
  const straightMax = routeProfile(grid, [A, B]).maxSlope;
  results.push({ sol: A.sol, straightMaxSlope: +straightMax.toFixed(1), a: [+A.lat.toFixed(6), +A.lon.toFixed(6)], b: [+B.lat.toFixed(6), +B.lon.toFixed(6)],
    rover: Math.round(roverLen), planner: Math.round(routeProfile(grid, planned).distance), chord: Math.round(metres(A, B)),
    plannerMean: +p.mean.toFixed(1), plannerP90: +p.p90.toFixed(1), plannerWithin50: +p.within50.toFixed(3),
    straightMean: +s.mean.toFixed(1), straightP90: +s.p90.toFixed(1), straightWithin50: +s.within50.toFixed(3) });
}
const ms = performance.now() - t0;
const avg = k => results.reduce((s, r) => s + r[k], 0) / results.length;
const median = k => { const v = results.map(r => r[k]).sort((a, b) => a - b); return v[v.length >> 1]; };

const hard = results.filter(r => r.straightMaxSlope >= 15);
const avgOf = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
const hardSummary = hard.length ? { legs: hard.length,
  plannerMean: +avgOf(hard, 'plannerMean').toFixed(1), straightMean: +avgOf(hard, 'straightMean').toFixed(1),
  closerThanStraight: +(hard.filter(r => r.plannerMean < r.straightMean).length / hard.length).toFixed(3) } : null;

const corridorCells = new Set();
for (const p of runs.flat()) {
  const c = cellOf(grid, p), r = Math.ceil(500 / grid.step);
  for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
    if (dr * dr + dc * dc > r * r) continue;
    const row = c.row + dr, col = c.col + dc;
    if (row >= 0 && col >= 0 && row < grid.height && col < grid.width) corridorCells.add(row * grid.width + col);
  }
}
const corridor = { easy: 0, caution: 0, steep: 0, nogo: 0 }; let corridorN = 0;
for (const i of corridorCells) { const v = grid.slope[i]; if (!Number.isFinite(v)) continue; corridorN++; corridor[v < 10 ? 'easy' : v < 20 ? 'caution' : v < 30 ? 'steep' : 'nogo']++; }
for (const k in corridor) corridor[k] = +(corridor[k] / corridorN).toFixed(4);

const roverProfile = routeProfile(grid, runs.flat());
const share = Object.fromEntries(Object.entries(roverProfile.classes).map(([k, v]) => [k, +(v / (roverProfile.distance - roverProfile.unmapped)).toFixed(4)]));

const summary = {
  generated: new Date().toISOString().slice(0, 10),
  question: 'Given only start/end points and orbital terrain, does the planner route like Perseverance\'s drivers did?',
  grid: `${info.id} (${info.step} m HiRISE DTM samples)`, legLength: LEG_PATH, minChord: MIN_CHORD,
  legs: legs.length, planned: results.length, noRoute: failed, plannerMs: Math.round(ms),
  planner: { meanDeviation: +avg('plannerMean').toFixed(1), medianDeviation: +median('plannerMean').toFixed(1), within50: +avg('plannerWithin50').toFixed(3) },
  straight: { meanDeviation: +avg('straightMean').toFixed(1), medianDeviation: +median('straightMean').toFixed(1), within50: +avg('straightWithin50').toFixed(3) },
  terrainForcedLegs: hardSummary, corridor500m: corridor,
  closerThanStraight: +(results.filter(r => r.plannerMean < r.straightMean).length / results.length).toFixed(3),
  roverPath: { mappedMetres: Math.round(roverProfile.distance - roverProfile.unmapped), maxSlope: +roverProfile.maxSlope.toFixed(1), classShare: share },
  caveats: 'Rover drivers also avoid rocks, sand and wheel hazards below DTM resolution and choose routes for science targets; '
    + 'the planner uses a walking-crew slope model (limit 25°). Agreement shows the orbital cost model captures the terrain that '
    + 'shaped real routes; it is not an operational traverse certification.',
};
writeFileSync(new URL('data/perseverance/routes.json', root), JSON.stringify({ ...summary, results }) + '\n');
console.log(JSON.stringify(summary, null, 1));
