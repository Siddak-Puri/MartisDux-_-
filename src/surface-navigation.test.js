import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceBetween, bearingTo, stepOnMars, headingDelta, routeSketch } from './surface-navigation.js';

test('Local surface steps retain metre distance and requested heading on Mars',()=>{
  for (const point of [{lat:18.4446,lon:77.4509},{lat:-43,lon:170}]) {
    for (const heading of [0,90,180,270,357]) {
      const next=stepOnMars(point,heading,25);
      assert.ok(Math.abs(distanceBetween(point,next)-25)<1e-6);
      assert.ok(Math.abs(headingDelta(bearingTo(point,next),heading))<1e-6);
    }
  }
});
test('Crossing the longitude seam keeps the destination pointer and step correct',()=>{
  const start={lat:0,lon:179.9999}, end={lat:0,lon:-179.9999};
  assert.equal(bearingTo(start,end),90);
  const next=stepOnMars(start,90,25);
  assert.ok(next.lon<0);
  assert.ok(Math.abs(distanceBetween(start,next)-25)<1e-6);
  assert.equal(headingDelta(1,359),2);
  assert.equal(headingDelta(359,1),-2);
});
test('Pole crossings and coincident positions stay finite',()=>{
  const start={lat:89.9999,lon:0}, next=stepOnMars(start,0,25);
  assert.ok(Number.isFinite(next.lat) && Number.isFinite(next.lon));
  assert.ok(Math.abs(distanceBetween(start,next)-25)<.001);
  assert.equal(distanceBetween(start,start),0);
});
test('Route overview remains north-up and within frame for local and global routes',()=>{
  const points=routeSketch({lat:0,lon:179.99},[{lat:0,lon:179.99},{lat:0,lon:-179.99},{lat:.01,lon:179.99}]);
  assert.ok(points[1].x>points[0].x);
  assert.ok(points[2].y<points[0].y);
  for(const p of points) assert.ok(p.x>=22 && p.x<=138 && p.y>=22 && p.y<=138);
});
