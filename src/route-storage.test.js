import test from 'node:test';
import assert from 'node:assert/strict';
import { routeDocument, validateRoute } from './route-storage.js';
const state={start:{lat:18.4446,lon:77.4509,name:'Jezero'},destination:{lat:18.4377,lon:77.4581}};
test('Mars route export round-trips endpoints and recomputes distance',()=>{const doc=routeDocument(state);doc.distanceMetres=123456789;const parsed=validateRoute(JSON.parse(JSON.stringify(doc)));assert.deepEqual(parsed.start,state.start);assert.deepEqual(parsed.destination,state.destination);assert.ok(parsed.distanceMetres>100&&parsed.distanceMetres<1000);});
test('route import rejects Earth, invalid coordinates and non-finite values',()=>{const doc=routeDocument(state);assert.throws(()=>validateRoute({...doc,body:'Earth'}));assert.throws(()=>validateRoute({...doc,radiusMetres:6378137}));for(const lat of [NaN,Infinity,91,'18'])assert.throws(()=>validateRoute({...doc,start:{lat,lon:77}}));});
test('route import rejects degenerate endpoints and oversized names are bounded',()=>{const doc=routeDocument(state);assert.throws(()=>validateRoute({...doc,destination:doc.start}));assert.equal(validateRoute({...doc,name:'x'.repeat(1000)}).name.length,100);});
test('terrain export preserves bends and ignores imported safety claims',()=>{
 const start={lat:18,lon:77},bend={lat:18.0001,lon:77},destination={lat:18.0001,lon:77.0001};
 const doc=routeDocument({start,destination,mode:'terrain',points:[start,bend,destination]});const parsed=validateRoute({...doc,distanceMetres:1,assessment:{radiation:'safe'}});
 assert.deepEqual(parsed.points,[start,bend,destination]);assert.ok(parsed.distanceMetres>11);assert.equal(parsed.assessment,undefined);assert.equal(doc.hazards.radiation,'unknown');
 assert.throws(()=>validateRoute({...doc,points:[start,{lat:20,lon:80},destination]}),/gap/);
});
test('Safest-walk app state is stored as a terrain route; a direct fallback stays direct',()=>{
 const start={lat:18.44,lon:77.45},bend={lat:18.441,lon:77.452},destination={lat:18.43,lon:77.444};
 const doc=routeDocument({start,destination,mode:'safe',points:[start,bend,destination],gridLabel:'Jezero HiRISE DTM · 4 m cells'});
 assert.equal(doc.mode,'terrain');assert.equal(doc.points.length,3);assert.match(doc.method,/Jezero HiRISE DTM/);
 assert.equal(validateRoute({...doc,mode:'safe'}).mode,'terrain');
 assert.equal(routeDocument({start,destination,mode:'direct',points:[start,destination]}).mode,'direct');
});
