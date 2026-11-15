import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceAt, pointAt, buildTimeline, stateAt, homePath, lineOfSight, decide, DRILLS } from './mission-control.js';
import { planMarswalk, walkBackField, walkSpeed, timeAt, EVA_DEFAULTS } from './eva.js';

const level = n => Array.from({ length: n + 1 }, (_, i) => ({ d: i * 50, z: 0, lat: 18 + i * 0.0001, lon: 77 }));

test('distanceAt inverts timeAt', () => {
  const plan = planMarswalk({ outbound: level(20), back: level(20), stops: 1 });
  for (const d of [0, 120, 555, 1000]) assert.ok(Math.abs(distanceAt(plan.outbound.timeline, timeAt(plan.outbound.timeline, d)) - d) < 1e-6);
  assert.deepEqual(pointAt(level(2), 25), { lat: 18.00005, lon: 77 });
});

test('timeline: out, science at each station, back; total matches the plan', () => {
  const outbound = level(20), stations = [{ d: 400, name: 'S1' }, { d: 1000, name: 'S2' }];
  const plan = planMarswalk({ outbound, back: level(20), stops: stations.length });
  const tl = buildTimeline(plan, stations, EVA_DEFAULTS.stopMinutes * 60);
  assert.deepEqual(tl.phases.map(p => p.kind), ['out', 'science', 'out', 'science', 'back']);
  assert.ok(Math.abs(tl.total - plan.total) < 1e-6);
  const sci = tl.phases[1], s1 = stateAt(tl, plan, (sci.t0 + sci.t1) / 2);
  assert.equal(s1.phase.kind, 'science'); assert.equal(s1.d, 400);
  assert.ok(Math.abs(stateAt(tl, plan, 100).d - 100 * EVA_DEFAULTS.flatSpeed) < 1e-6);
  const back = tl.phases.at(-1), s2 = stateAt(tl, plan, (back.t0 + back.t1) / 2);
  assert.equal(s2.phase.kind, 'back'); assert.ok(Math.abs(s2.d - 500) < 1e-6);
  assert.equal(stateAt(tl, plan, tl.total + 5).done, true);
  assert.equal(stateAt(tl, plan, tl.total + 5).d, 0);
});

test('fastest way home follows the walk-back field around a wall', () => {
  const width = 30, height = 20, slope = new Float32Array(width * height).fill(2);
  for (let r = 0; r < 15; r++) slope[r * width + 15] = 60;
  const grid = { width, height, dx: 10, dy: 10, slope };
  const base = 5 * width + 5, time = walkBackField(grid, base);
  const start = 5 * width + 25, path = homePath({ ...grid, time }, start);
  assert.equal(path.cells.at(-1), base);
  assert.ok(path.cells.every(i => slope[i] < 25), 'never crosses the cliff');
  assert.ok(path.cells.some(i => ((i / width) | 0) >= 15), 'goes round through the gap');
  let walked = 0;
  for (let k = 1; k < path.cells.length; k++) {
    const a = path.cells[k - 1], b = path.cells[k];
    assert.ok(time[b] < time[a]);
    const len = Math.hypot(((a % width) - (b % width)) * 10, (((a / width) | 0) - ((b / width) | 0)) * 10);
    walked += len / walkSpeed(Math.tan(2 * Math.PI / 180));
  }
  assert.ok(Math.abs(walked - time[start]) / time[start] < 1e-6);
  assert.equal(homePath({ ...grid, time }, 3 * width + 15), null, 'no way home from inside the cliff');
});

test('radio line of sight: ridges block, masts help, the planet curves', () => {
  const width = 200, height = 3, elevation = new Float32Array(width * height);
  const grid = { width, height, elevation, dx: 100, dy: 100 };
  const a = { row: 1, col: 0 }, near = { row: 1, col: 40 }, far = { row: 1, col: 199 };
  assert.equal(lineOfSight(grid, a, near), true);
  assert.equal(lineOfSight(grid, a, far), false);
  assert.equal(lineOfSight(grid, a, far, 40, 40), true);
  for (let r = 0; r < height; r++) elevation[r * width + 20] = 30;
  assert.equal(lineOfSight(grid, a, near), false);
  assert.equal(lineOfSight(grid, a, near, 70, 2), true);
  elevation[1 * width + 40] = NaN;
  assert.equal(lineOfSight(grid, a, near), null);
});

test('drill decisions', () => {
  const s = { elapsed: 3600, usable: 7.25 * 3600, walkHome: 17 * 60, rideHome: null, travel: 'foot' };
  const storm = decide('storm', s);
  assert.equal(storm.title, 'WALK HOME NOW'); assert.equal(storm.level, 'warn'); assert.equal(storm.spare, 3 * 60);
  assert.match(storm.text, /3 min to spare/);
  assert.equal(decide('storm', { ...s, walkHome: 26 * 60 }).level, 'bad');
  assert.match(decide('storm', { ...s, walkHome: 26 * 60 }).text, /6 min in the open/);
  const leak = decide('leak', s);
  assert.equal(leak.spare, DRILLS.leak.air - 17 * 60); assert.match(leak.text, /23 min of air left/);
  assert.equal(decide('leak', { ...s, walkHome: 52 * 60 }).title, 'SHARE AIR AND GO');
  const injury = decide('injury', s);
  assert.equal(injury.home, 34 * 60); assert.equal(injury.slow, 2); assert.equal(injury.title, 'TURN BACK NOW');
  assert.equal(decide('injury', { ...s, elapsed: 7 * 3600 }).title, 'CALL FOR PICKUP');
  const r = { ...s, travel: 'rover', rideHome: 4 * 60, walkHome: 72 * 60 };
  assert.equal(decide('storm', r).title, 'DRIVE HOME NOW'); assert.equal(decide('storm', r).means, 'ride');
  const dead = decide('rover', r);
  assert.equal(dead.means, 'walk'); assert.equal(dead.home, 72 * 60); assert.match(dead.text, /walkback limit/);
});
