import test from 'node:test';
import assert from 'node:assert/strict';
import { bilinear,sampleDtm,gridEdgeWeight,coverageDistance,geographicTile,tileBounds,decodeHeightBuffer } from './terrain-grid.js';
import {gzipSync} from 'node:zlib';
import { MARS_RADIUS } from './data.js';

test('Elevation interpolation preserves measured heights and masks missing data',()=>{
  assert.equal(bilinear([10,20,30,40],2,2,.5,.5),25);
  assert.equal(bilinear([10,65535,30,40],2,2,.5,.5,65535),null);
  assert.equal(bilinear([10,20,30,40],2,2,-.1,.5),null);
});
test('Jezero DTM sampling uses its original Mars equirectangular projection and quantization',()=>{
  const rad=Math.PI/180,grid={x0:77*rad*MARS_RADIUS,y0:19*rad*MARS_RADIUS,step:1,width:2,height:2,scale:.05,offset:-2800,nodata:65535,values:[100,200,300,400]};
  const p={lon:(grid.x0+.5)/MARS_RADIUS/rad,lat:(grid.y0-.5)/MARS_RADIUS/rad};
  assert.ok(Math.abs(sampleDtm(grid,p)-(-2787.5))<1e-6);
  assert.equal(sampleDtm(grid,{lat:0,lon:0}),null);
});
test('Terrain tiles use Mars geographic coordinates with a wrapped date line and pole bounds',()=>{
  assert.deepEqual(geographicTile({lat:90,lon:180},0),{x:0,y:0,level:0});
  assert.equal(geographicTile({lat:-90,lon:77},7).y,127);
  assert.deepEqual(tileBounds(0,0,0),{west:-180,east:0,north:90,south:-90});
});
test('The fine elevation grid blends only at its actual coverage edge',()=>{
  const grid={x0:0,y0:100,step:1,width:101,height:101};
  assert.equal(gridEdgeWeight(grid,{lat:0,lon:0},10),0);
  const p={lat:50/MARS_RADIUS*180/Math.PI,lon:50/MARS_RADIUS*180/Math.PI};
  assert.equal(gridEdgeWeight(grid,p,10),1);
});

test('Terrain assets decode once whether HTTP already decompressed gzip or not',async()=>{
  const values=new Uint16Array([0,100,65535,420]);
  const gzip=gzipSync(values);
  const compressed=gzip.buffer.slice(gzip.byteOffset,gzip.byteOffset+gzip.byteLength);
  assert.deepEqual(await decodeHeightBuffer(values.buffer,4),values);
  assert.deepEqual(await decodeHeightBuffer(compressed,4),values);
  await assert.rejects(()=>decodeHeightBuffer(values.buffer,5),/Invalid DTM length/);
});

test('DTM blending feathers at nodata holes, not only at the grid rectangle',()=>{
  const width=101,height=101,values=new Uint16Array(width*height).fill(100);
  for(let r=0;r<height;r++)for(let c=0;c<50;c++)values[r*width+c]=65535;
  const grid={x0:0,y0:100,step:1,width,height,values,nodata:65535};
  grid.coverage=coverageDistance(grid);
  const at=(x,y)=>({lat:(100-y)/MARS_RADIUS*180/Math.PI,lon:x/MARS_RADIUS*180/Math.PI});
  assert.ok(gridEdgeWeight(grid,at(51,50),20)<0.05,'next to the hole the DTM barely contributes');
  assert.ok(gridEdgeWeight(grid,at(60,50),20)>0.1&&gridEdgeWeight(grid,at(60,50),20)<0.9,'ramps across the feather');
  assert.equal(gridEdgeWeight(grid,at(80,50),20),1);
});
