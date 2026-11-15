import test from 'node:test';
import assert from 'node:assert/strict';
import { MARS_RADIUS } from './data.js';
import { surfaceRoute } from './route-geometry.js';

test('Surface distance uses a Mars great circle rather than an Earth radius or chord', () => {
  const route = surfaceRoute({lat:0,lon:0}, {lat:0,lon:90});
  assert.ok(Math.abs(route.distance-MARS_RADIUS*Math.PI/2) < 1e-7);
  assert.ok(route.distance > MARS_RADIUS*Math.sqrt(2));
  assert.ok(Math.abs(route.midpoint.lon-45) < 1e-10);
});
test('A route crosses the antimeridian by the short two-degree arc', () => {
  const route = surfaceRoute({lat:0,lon:179}, {lat:0,lon:-179});
  assert.ok(Math.abs(route.distance-MARS_RADIUS*Math.PI/90) < 1e-7);
  assert.ok(Math.abs(Math.abs(route.midpoint.lon)-180) < 1e-10);
  assert.ok(route.points.every(p => Math.abs(p.lon) >= 179-1e-10));
});
test('Polar routes remain finite and retain the endpoints', () => {
  const a={lat:85,lon:0}, b={lat:85,lon:180}, route=surfaceRoute(a,b);
  assert.deepEqual(route.points[0],a);
  assert.deepEqual(route.points.at(-1),{lat:85,lon:-180});
  assert.ok(route.midpoint.lat > 89.9999);
  assert.ok(route.points.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
});
test('Degenerate, antipodal and invalid endpoints do not produce a misleading trail', () => {
  for (const end of [{lat:0,lon:0},{lat:0,lon:180},{lat:91,lon:0},{lat:NaN,lon:1}]) {
    assert.throws(()=>surfaceRoute({lat:0,lon:0},end));
  }
  assert.throws(()=>surfaceRoute(null,{lat:1,lon:1}));
});
test('A short local route stays accurate and supports 0–360 east longitudes', () => {
  const route=surfaceRoute({lat:0,lon:359.999}, {lat:0,lon:0});
  assert.ok(Math.abs(route.distance-MARS_RADIUS*Math.PI/180_000) < 1e-6);
  assert.ok(route.points.every(p => Math.abs(p.lat) < 1e-10));
});
