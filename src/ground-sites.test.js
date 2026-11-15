import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_SITES,nearbyGroundSite,groundSitesForRoute,panoramaFrame } from './ground-sites.js';

test('Each supported station resolves to its own distinct NASA photograph',()=>{
  assert.equal(nearbyGroundSite({lat:18.4446,lon:77.4509}).id,'jezero');
  assert.equal(nearbyGroundSite({lat:-4.5895,lon:137.4417}).id,'gale');
  assert.equal(new Set(GROUND_SITES.map(site=>site.image)).size,GROUND_SITES.length);
});
test('Uncovered pins never silently fall back to a distant rover image',()=>{
  for(const p of [{lat:16.22929,lon:-133.69335},{lat:0,lon:0},{lat:18.47,lon:77.49},null,{lat:NaN,lon:0}])assert.equal(nearbyGroundSite(p),null);
});
test('Both route endpoints are checked and the same station is only offered once',()=>{
  assert.deepEqual(groundSitesForRoute({start:GROUND_SITES[0],destination:GROUND_SITES[0]}).map(p=>p.id),['jezero']);
  assert.deepEqual(groundSitesForRoute({start:GROUND_SITES[0],destination:GROUND_SITES[1]}).map(p=>p.id),['jezero','gale']);
  assert.deepEqual(groundSitesForRoute({start:{lat:0,lon:0},destination:null}),[]);
});
test('Panorama framing preserves aspect ratio and observed vertical bounds at mobile and desktop sizes',()=>{
  for(const site of GROUND_SITES)for(const size of [[390,610],[760,550],[1200,400]])for(const y of [-1,.2,2]) {
    const frame=panoramaFrame(site.width,site.height,...size,76,359,y);
    assert.ok(Math.abs(frame.sw/frame.sh-size[0]/size[1])<1e-8);
    assert.ok(frame.sy>=-1e-8 && frame.sy+frame.sh<=site.height+1e-8);
    assert.ok(frame.first>0 && frame.first<=frame.sw);
  }
});
test('Photo station matching treats equivalent east-positive longitude correctly',()=>{
  const station=GROUND_SITES[0];
  assert.equal(nearbyGroundSite({...station,lon:station.lon-360}).id,station.id);
});
