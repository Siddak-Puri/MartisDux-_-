import test from 'node:test';
import assert from 'node:assert/strict';
import { walkSpeed, metabolicRate, walkLeg, reverseSamples, planMarswalk, walkBackField, timeAt, evaDose, oxygenGrams, EVA_DEFAULTS } from './eva.js';
import { marsClock, sunAt, daylight, nextLocalTime } from './mars-time.js';
import { computeSlope, cellOf, pointOf } from './hazards.js';

test('Mars24 reference epoch (Allison & McEwen 2000, 2000-01-06 00:00 UTC)', () => {
  const c = marsClock(new Date('2000-01-06T00:00:00Z'));
  assert.ok(Math.abs(c.ls - 277.18758) < 0.001, `Ls ${c.ls}`);
  assert.ok(Math.abs(c.mst - (23 + 59 / 60 + 39.068 / 3600)) < 3 / 3600, `MST ${c.mst}`);
});

test('Perseverance landing happened mid-afternoon in early northern spring', () => {
  const s = sunAt({ lat: 18.4446, lon: 77.4509 }, new Date('2021-02-18T20:44:00Z'));
  assert.ok(s.ls > 5 && s.ls < 6, `Ls ${s.ls}`);
  assert.ok(Math.abs(s.lmst - 15.88) < 0.1, `LMST ${s.lmst}`);
  assert.ok(s.elevation > 20 && s.elevation < 50);
});

test('daylight window is symmetric around noon and sun is up at noon', () => {
  const p = { lat: 18.44, lon: 77.45 }, d = daylight(p, new Date('2026-11-10T00:00:00Z'));
  assert.ok(Math.abs(d.start + d.end - 24) < 1e-9 && d.hours > 9 && d.hours < 13);
  const noon = nextLocalTime(p, 12, new Date('2026-11-10T00:00:00Z'));
  assert.ok(Math.abs(sunAt(p, noon).ltst - 12) < 0.02);
  assert.ok(sunAt(p, noon).elevation > 50);
});

test('suited walking is fastest on a gentle downhill and slows on climbs', () => {
  assert.ok(Math.abs(walkSpeed(0) - EVA_DEFAULTS.flatSpeed) < 1e-12);
  assert.ok(walkSpeed(-0.05) > walkSpeed(0) && walkSpeed(0.2) < walkSpeed(0.1) && walkSpeed(0.1) < walkSpeed(0));
});

test('metabolic model is in the range of measured suited EVA work', () => {
  const flat = metabolicRate(walkSpeed(0), 0), climb = metabolicRate(walkSpeed(0.15), 0.15);
  assert.ok(flat > 200 && flat < 500, `flat ${flat} W`);
  assert.ok(climb > flat);
  assert.ok(Math.abs(oxygenGrams(20100) - 1.429) < 1e-9);
  assert.ok(Math.abs(evaDose(86400) - 0.64) < 1e-9);
});

test('a leg walked back reverses its grades', () => {
  const up = [{ d: 0, z: 0 }, { d: 100, z: 10 }, { d: 200, z: 20 }];
  const a = walkLeg(up), b = walkLeg(reverseSamples(up));
  assert.ok(a.time > b.time, 'uphill takes longer than downhill');
  assert.equal(Math.round(b.distance), 200);
  assert.ok(Math.abs(timeAt(a.timeline, 100) - a.time / 2) < 1e-6);
});

function grid(width, height, heightFn, step = 10) {
  const values = new Uint16Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = Math.round((heightFn(c * step, r * step) + 100) / 0.05);
  return { id: 't', values, width, height, step, x0: 0, y0: (height - 1) * step / 2, scale: 0.05, offset: -100, nodata: 65535 };
}

test('walk-back field: flat ground time = distance / speed; walls force detours', () => {
  const flat = computeSlope(grid(60, 60, () => 0));
  const base = cellOf(flat, pointOf(flat, 10, 30));
  const t = walkBackField(flat, base.i);
  const far = t[30 * flat.width + 50];
  assert.ok(Math.abs(far - 400 / EVA_DEFAULTS.flatSpeed) < 2, `got ${far}`);
  const wall = computeSlope(grid(60, 60, (x, y) => (x >= 280 && x <= 310 && y < 480) ? 40 : 0));
  const w = walkBackField(wall, base.i);
  assert.ok(w[30 * wall.width + 50] > far * 1.3, 'detour around the wall takes longer');
  assert.equal(w[30 * wall.width + 29], Infinity, 'cells on the cliff are unreachable');
});

test('Marswalk plan flags the point of no return', () => {
  const outbound = [{ d: 0, z: 0 }, { d: 3000, z: 0 }];
  const ok = planMarswalk({ outbound, back: reverseSamples(outbound), stops: 1, points: [{ d: 3000 }], toBase: () => 3000 / 0.9 });
  assert.ok(ok.ok && ok.checks.walkBack && ok.total < ok.usable);
  const tight = { ...EVA_DEFAULTS, budgetHours: 1.5 };
  const bad = planMarswalk({ outbound, back: reverseSamples(outbound), stops: 1, points: [{ d: 1500 }, { d: 3000 }], toBase: p => p.d / 0.9 }, tight);
  assert.equal(bad.ok, false);
  assert.ok(bad.noReturn && bad.noReturn.d === 1500, 'first point where elapsed + walk home exceeds the usable budget');
});

test('season climatology comes from real REMS sols and Jezero comparison is computed', async () => {
  const { readFileSync } = await import('node:fs');
  const { climateAt, dustSeason, jezeroVsGale } = await import('./conditions.js');
  const d = JSON.parse(readFileSync(new URL('../public/data/weather/conditions.json', import.meta.url)));
  assert.equal(d.climate.length, 36);
  const c = climateAt(d, 365);
  assert.equal(c.ls, 0);
  assert.ok(c.airMin.median < c.airMax.median && c.airMin.median < -40, 'Mars nights are far below freezing');
  assert.ok(c.pressure.median > 600 && c.pressure.median < 1000, 'Gale pressure ~700–900 Pa');
  assert.ok(dustSeason(250) && !dustSeason(90));
  const j = jezeroVsGale(d.jezero.sharedSols);
  assert.ok(j.sols >= 1 && Number.isFinite(j.night) && Number.isFinite(j.day));
});

test('offline pack covers the walk with real NASA tile URLs at every product level', async () => {
  const { tilesFor, boxAround } = await import('./offline.js');
  const box = boxAround([{ lat: 18.4446, lon: 77.4509 }, { lat: 18.4307, lon: 77.4444 }], 500);
  const urls = tilesFor(box);
  assert.ok(urls.some(u => u.includes('JEZ_hirise') && u.includes('/17/')), 'HiRISE finest level');
  assert.ok(urls.some(u => u.includes('CTX1') && u.includes('/tile/12/')), 'CTX finest level');
  assert.ok(urls.length > 100 && urls.length <= 1500, `${urls.length} tiles`);
  const span = 180 / 2 ** 17;
  assert.ok(urls.includes(`https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/17/${Math.floor((90 - 18.4446) / span)}/${Math.floor((77.4509 + 180) / span)}.png`));
});

test('rover mode drives faster but keeps the walking walk-back limit', async () => {
  const { ROVER_SPEED } = await import('./eva.js');
  const outbound = Array.from({ length: 51 }, (_, i) => ({ d: i * 200, z: 0 }));
  const back = outbound.map(s => ({ ...s }));
  const foot = planMarswalk({ outbound, back, stops: 1, toBase: s => s.d / 0.9, points: outbound });
  const rover = planMarswalk({ outbound, back, stops: 1, toBase: s => s.d / 0.9, points: outbound, mode: 'rover' });
  assert.ok(Math.abs(rover.outbound.time - 10000 / ROVER_SPEED) < 1);
  assert.ok(rover.total < foot.total);
  assert.ok(rover.energy < foot.energy);
  const far = planMarswalk({ outbound, back, stops: 1, toBase: s => s.d / 0.3, points: outbound, mode: 'rover' });
  assert.ok(far.noReturn, 'a slow walk home from 10 km must break the walkback limit');
});
