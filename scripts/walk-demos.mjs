import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { computeSlope, findSafePath, gridFor, routeProfile } from '../src/hazards.js';
import { createLandingMap, measuredLandingField } from '../src/walk/env-hud-data.js';

const root = new URL('../public/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('terrain/jezero.json', root)));
const grids = meta.datasets.map(info => {
  const b = gunzipSync(readFileSync(new URL(info.url, root)));
  return computeSlope({ ...info, values: new Uint16Array(b.buffer, b.byteOffset, info.width * info.height) }, info.step === 1 ? 4 : 2);
}).sort((a, b) => a.step - b.step);
const samples = JSON.parse(readFileSync(new URL('data/perseverance/samples.json', root))).samples;

const env = JSON.parse(readFileSync(new URL('ar/walk-env/terrain.json', root)));
const landing = env.layers.find(l => l.id === 'landing');
const map = createLandingMap(landing.imagery.overview.bounds, env.start);
const dem = gunzipSync(readFileSync(new URL('ar/' + landing.dem.url, root)));
const raw = new Uint16Array(dem.buffer, dem.byteOffset, dem.length / 2);
const field = measuredLandingField({ ...landing.dem, h: Float32Array.from(raw, v => v === landing.dem.nodata ? NaN : v * landing.dem.scale + landing.dem.offset) }, map, landing.bounds);
function steepest(points) {
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    const a = map.toMap(points[i - 1]), b = map.toMap(points[i]), steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let j = 0; j <= steps; j++) { const s = field.slope(a.x + (b.x - a.x) * j / steps, a.z + (b.z - a.z) * j / steps); if (!Number.isFinite(s)) throw new Error('route leaves the 1 m DEM'); max = Math.max(max, s); }
  }
  return max;
}

const base = { lat: 18.4446, lon: 77.4509, name: 'Octavia E. Butler Landing (base)' };
const DEMOS = [
  { id: 'sid', tag: 'SHORT', sample: 'Atsá', title: 'First steps to Sid', name: 'Sid · Ha’ahóni and Atsá cores' },
  { id: 'rochette', tag: 'TRY', sample: 'Montdenier', title: 'Rochette, the first rock cores', name: 'Rochette · first rock cores' },
  { id: 'brac', tag: 'SÉÍTAH', sample: 'Salette', title: 'Brac, in South Séítah', name: 'Brac · Salette and Coulettes cores' },
  { id: 'issole', tag: 'FAR', sample: 'Robine', title: 'Issole, the longest walk', name: 'Issole · Robine and Malay cores' },
];
const demos = DEMOS.map(d => {
  const s = samples.find(x => x.name.startsWith(d.sample));
  const dest = { lat: s.lat, lon: s.lon, name: d.name };
  const grid = gridFor(grids, base, dest), points = findSafePath(grid, base, dest), profile = routeProfile(grid, points);
  const maxSlope = +steepest(points).toFixed(1);
  console.log(d.id, grid.source, grid.step, 'm cells;', points.length, 'points;', Math.round(profile.distance), 'm; planner max slope', profile.maxSlope.toFixed(1), '; 1 m DEM max slope', maxSlope);
  return { id: d.id, tag: d.tag, title: d.title, rock: s.feature, sol: s.sol, base, dest, grid: grid.source, step: grid.step,
    distance: Math.round(profile.distance), maxSlope, plannerSlope: +profile.maxSlope.toFixed(1), points };
});
writeFileSync(new URL('ar/walk-demos.json', root), JSON.stringify({ note: 'Planned by MartisDux (slope-cost A* on the HiRISE DTM, 4 m grid). maxSlope is re-measured on the 1 m DEM over a 4 m baseline. Planning aid, not safety-certified.', demos }, null, 1));
