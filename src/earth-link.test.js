import test from 'node:test';
import assert from 'node:assert/strict';
import { earthMarsDistanceAU, lightTimeSeconds, formatDelay, clockDelay, AU_KM } from './earth-link.js';

test('signal delay matches what NASA quoted on landing days', () => {
  assert.ok(Math.abs(lightTimeSeconds(new Date('2021-02-18T20:55:00Z')) - 682) < 6);
  assert.ok(Math.abs(lightTimeSeconds(new Date('2012-08-06T05:17:00Z')) - 828) < 8);
});

test('closest approaches come out at the published distances', () => {
  assert.ok(Math.abs(earthMarsDistanceAU(new Date('2020-10-06T14:00:00Z')) * AU_KM - 62.07e6) < 0.25e6);
  assert.ok(Math.abs(earthMarsDistanceAU(new Date('2018-07-31T08:00:00Z')) * AU_KM - 57.59e6) < 0.25e6);
});

test('delay stays inside the physical range, about 3 to 22 minutes', () => {
  let min = Infinity, max = 0;
  for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2040, 0, 1); t += 5 * 86400000) {
    const s = lightTimeSeconds(new Date(t)); min = Math.min(min, s); max = Math.max(max, s);
  }
  assert.ok(min > 180 && min < 330, `min ${min}`);
  assert.ok(max > 1250 && max < 1345, `max ${max}`);
});

test('delay formats', () => {
  assert.equal(formatDelay(682), '11 min 22 s');
  assert.equal(formatDelay(601.4), '10 min 01 s');
  assert.equal(clockDelay(682), '11:22');
});
