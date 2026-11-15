import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyProgress, advanceOnTrail } from './journey-geometry.js';
import { distanceBetween,stepOnMars } from './surface-navigation.js';

const start={lat:18.4446,lon:77.4509};
const destination=stepOnMars(start,65,1200);
test('Journey progress and waypoint track the same Mars route in metres',()=>{
  const position=stepOnMars(start,65,300),p=journeyProgress(start,destination,position);
  assert.ok(Math.abs(p.along-300)<.001);
  assert.ok(p.offTrail<.001);
  assert.ok(Math.abs(p.remaining-900)<.001);
  assert.ok(Math.abs(distanceBetween(position,p.target)-50)<.001);
});
test('Free movement returns to the finite trail rather than its infinite extension',()=>{
  const middle=stepOnMars(start,65,300),position=stepOnMars(middle,155,60);
  const p=journeyProgress(start,destination,position);
  assert.ok(Math.abs(p.offTrail-60)<.01);
  assert.ok(distanceBetween(p.closest,p.target)<.001);
  const before=stepOnMars(start,245,50);
  assert.ok(distanceBetween(journeyProgress(start,destination,before).closest,start)<.001);
});
test('Follow trail rejoins after a detour and stops at B without overshoot',()=>{
  const position=stepOnMars(stepOnMars(start,65,300),155,60);
  const rejoined=advanceOnTrail(start,destination,position,100);
  const p=journeyProgress(start,destination,rejoined);
  assert.ok(p.offTrail<.001);
  assert.ok(Math.abs(p.along-340)<.1);
  assert.ok(distanceBetween(advanceOnTrail(start,destination,rejoined,10000),destination)<.001);
});
test('Journey navigation stays finite across the date line and near poles',()=>{
  for(const [a,b] of [[{lat:0,lon:179.9},{lat:0,lon:-179.9}],[{lat:89,lon:20},{lat:89,lon:100}]]){
    const next=advanceOnTrail(a,b,a,100);
    const p=journeyProgress(a,b,next);
    assert.ok(Math.abs(p.along-100)<.01);
    assert.ok(p.offTrail<.01);
    assert.ok(Number.isFinite(p.bearing));
  }
});

import { trackOf, trackProgress, advanceOnTrack, pointOnTrack } from './journey-geometry.js';
test('polyline track: progress and advancing around a corner', () => {
  const A={lat:0,lon:0}, C={lat:0,lon:0.01}, B={lat:0.01,lon:0.01};
  const track=trackOf([A,C,B]);
  const leg=distanceBetween(A,C);
  assert.ok(Math.abs(track.total-2*leg)<1);
  const mid=pointOnTrack(track,leg*1.5);
  assert.ok(Math.abs(mid.lon-0.01)<1e-6 && Math.abs(mid.lat-0.005)<1e-5);
  let pos={...A};
  for(let i=0;i<40;i++)pos=advanceOnTrack(track,pos,leg/10);
  assert.ok(distanceBetween(pos,B)<3,'reaches B via the corner');
  const p=trackProgress(track,mid);
  assert.ok(Math.abs(p.fraction-.75)<.01 && p.offTrail<.5);
});
