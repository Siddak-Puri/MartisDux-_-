import test from 'node:test';
import assert from 'node:assert/strict';
import {findTerrainPath} from './terrain-routing.js';
const grid=(width=80,height=80)=>({width,height,step:4,heights:new Float32Array(width*height),start:40*width+10,end:40*width+70});
test('terrain planner detours around steep crater walls',()=>{
 const g=grid();for(let y=30;y<=50;y++)for(let x=32;x<=48;x++)g.heights[y*g.width+x]=-30;
 const r=findTerrainPath(g);assert.equal(r.indices[0],g.start);assert.equal(r.indices.at(-1),g.end);
 assert.ok(r.indices.some(i=>Math.floor(i/g.width)<29||Math.floor(i/g.width)>51));
 assert.ok(r.indices.every(i=>g.heights[i]===0));
});
test('unknown terrain is impassable and a missing barrier never becomes a direct line',()=>{
 const g=grid();for(let y=0;y<g.height;y++)g.heights[y*g.width+40]=NaN;
 assert.throws(()=>findTerrainPath(g),/No route/);g.heights[g.start]=NaN;assert.throws(()=>findTerrainPath(g),/endpoint/);
});
test('gentle depressions incur cost before they become steep barriers',()=>{
 const g=grid();for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++)g.heights[y*g.width+x]=-3*Math.exp(-((x-40)**2+(y-40)**2)/80);
 const r=findTerrainPath(g);assert.ok(r.indices.some(i=>Math.abs(Math.floor(i/g.width)-40)>8));
});
test('planner rejects malformed grids and cannot cut diagonal unknown corners',()=>{
 const g=grid();assert.throws(()=>findTerrainPath({...g,step:0}));assert.throws(()=>findTerrainPath({...g,end:-1}));
 const h={width:9,height:9,step:4,heights:new Float32Array(81).fill(NaN),start:20,end:60};
 for(const [x,y]of [[2,2],[2,1],[2,3],[1,2],[3,2],[6,6],[5,6],[7,6],[6,5],[6,7]])h.heights[y*9+x]=0;
 assert.throws(()=>findTerrainPath(h),/No route/);
});
test('smoothed trail drops the grid staircase but never crosses blocked cells',()=>{
 const flat=grid(),r=findTerrainPath({...flat,end:60*flat.width+70});
 assert.ok(r.indices.length<=3,`flat ground gives a near-straight trail (${r.indices.length} points)`);
 assert.equal(r.indices[0],r.raw[0]);assert.equal(r.indices.at(-1),r.raw.at(-1));
 const g=grid();for(let y=30;y<=50;y++)for(let x=32;x<=48;x++)g.heights[y*g.width+x]=-30;
 const s=findTerrainPath(g),w=g.width;assert.ok(s.indices.length<s.raw.length);
 for(let k=1;k<s.indices.length;k++){
  const [x0,y0]=[s.indices[k-1]%w,Math.floor(s.indices[k-1]/w)],[x1,y1]=[s.indices[k]%w,Math.floor(s.indices[k]/w)],n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
  for(let t=0;t<=n;t++){const x=Math.round(x0+(x1-x0)*t/n),y=Math.round(y0+(y1-y0)*t/n);assert.equal(g.heights[y*w+x],0,'segment stays on the level ground');}
 }
});
