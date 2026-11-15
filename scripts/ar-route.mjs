import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { computeSlope, findSafePath, gridFor, routeProfile } from '../src/hazards.js';

const root = new URL('../public/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('terrain/jezero.json', root)));
const grids = meta.datasets.map(info => {
  const b = gunzipSync(readFileSync(new URL(info.url, root)));
  return computeSlope({ ...info, values: new Uint16Array(b.buffer, b.byteOffset, info.width * info.height) }, info.step === 1 ? 4 : 2);
}).sort((a, b) => a.step - b.step);
const base = { lat: 18.4446, lon: 77.4509, name: 'Octavia E. Butler Landing (base)' };
const samples = JSON.parse(readFileSync(new URL('data/perseverance/samples.json', root))).samples;
const target = samples.find(s => s.name === 'Montdenier');
const dest = { lat: target.lat, lon: target.lon, name: 'Rochette · first rock cores' };
const grid = gridFor(grids, base, dest);
const points = findSafePath(grid, base, dest);
const profile = routeProfile(grid, points);
writeFileSync(new URL('ar/jezero-marswalk.route.json', root), JSON.stringify({ base, dest, grid: grid.source, step: grid.step, distance: profile.distance, maxSlope: profile.maxSlope, points }, null, 1));
console.log(grid.source, grid.step, 'm cells;', points.length, 'points;', Math.round(profile.distance), 'm; max slope', profile.maxSlope.toFixed(1));
