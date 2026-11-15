import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Heightfield, Route, bearing, turn, toLatLon } from './walk/geo.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('heightfield: bilinear interpolation and slope on a ramp', () => {
  const data = new Uint16Array([0, 2000, 4000, 0, 2000, 4000, 0, 2000, 4000]);
  const h = new Heightfield({ nx: 3, nz: 3, step: 2, hmin: 0, heightUnit: 0.001 }, data);
  near(h.height(1, 1), 1); near(h.height(3, 3.7), 3);
  near(h.height(-5, 0), 0); near(h.height(99, 0), 4, 1e-4);
  near(h.slope(2, 2, 1), 45, 1e-9);
  near(h.gradeAlong(1, 2, 1, 0, 2), 45, 1e-9); near(h.gradeAlong(3, 2, -1, 0, 2), -45, 1e-9);
  near(h.gradeAlong(2, 1, 0, 1, 2), 0);
});

test('bearings use x = east, z = south', () => {
  near(bearing(0, -1), 0); near(bearing(1, 0), 90); near(bearing(0, 1), 180); near(bearing(-1, 0), 270);
  near(turn(350, 10), 20); near(turn(10, 350), -20); near(turn(0, 180), -180);
});

test('route: positions along it and projection onto it', () => {
  const r = new Route([[0, 0], [10, 0], [10, 10]]);
  assert.equal(r.length, 20);
  const p = r.at(15); near(p.x, 10); near(p.z, 5); near(p.dx, 0); near(p.dz, 1);
  const q = r.project(12, 4); near(q.along, 14); near(q.off, 2);
  assert.equal(r.sample(5).length, 5);
});

test('walk data: grid, route and stops are consistent', () => {
  const walk = JSON.parse(readFileSync(new URL('../public/ar/walk/walk.json', import.meta.url)));
  const bin = readFileSync(new URL('../public/ar/walk/terrain.bin', import.meta.url));
  const g = walk.grid;
  assert.equal(bin.length, g.nx * g.nz * 2);
  const h = new Heightfield(g, new Uint16Array(bin.buffer, bin.byteOffset, bin.length / 2));
  const route = new Route(walk.route.points);
  near(route.length, walk.route.distance, 0.2);
  assert.ok(h.inside(walk.base.x, walk.base.z) && h.inside(walk.dest.x, walk.dest.z));
  assert.ok(Math.hypot(walk.route.points[0][0] - walk.base.x, walk.route.points[0][1] - walk.base.z) < 1);
  const worst = Math.max(...route.sample(2).map(p => h.slope(p.x, p.z, 2)));
  assert.ok(worst < walk.route.maxSlope + 8, `route slope ${worst}`);
  const ll = toLatLon(walk.geo, walk.base.x, walk.base.z);
  near(ll.lat, 18.4446, 1e-6); near(ll.lon, 77.4509, 1e-6);
});
