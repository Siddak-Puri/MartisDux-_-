import {MARS_RADIUS} from './data.js';
import {distanceBetween} from './surface-navigation.js';
export function createTerrainPlanner(terrain){
 let worker, rejectPending, sequence=0;
 function cancel(){sequence++;worker?.terminate();worker=null;rejectPending?.(new Error('Route planning cancelled.'));rejectPending=null;}
 async function plan(start,destination){
  cancel();const token=sequence;
  const check=()=>{if(token!==sequence)throw new Error('Route planning cancelled.');};
  const direct=distanceBetween(start,destination);
  if(direct<1||direct>4000)throw new Error('Fine terrain check needs pins 1 m–4 km apart.');
  await terrain.ready;check();
  if(terrain.localHeightAt(start)===null||terrain.localHeightAt(destination)===null)throw new Error('No 1 m elevation model covers both pins.');
  const lat=(start.lat+destination.lat)/2,cos=Math.cos(lat*Math.PI/180),m=MARS_RADIUS*Math.PI/180;
  const project=p=>({x:(p.lon-start.lon)*m*cos,y:(p.lat-start.lat)*m}),end=project(destination);
  const step=4,pad=Math.max(100,Math.min(400,direct*.35));
  const x0=Math.min(0,end.x)-pad,y0=Math.min(0,end.y)-pad,width=Math.ceil((Math.abs(end.x)+2*pad)/step)+1,height=Math.ceil((Math.abs(end.y)+2*pad)/step)+1;
  if(width*height>250000)throw new Error('Route area is too large for detailed terrain. Move the pins closer.');
  const point=i=>({lat:start.lat+(y0+Math.floor(i/width)*step)/m,lon:start.lon+(x0+i%width*step)/(m*cos)});
  const heights=new Float32Array(width*height);
  for(let y=0;y<height;y++){
   for(let x=0;x<width;x++){const i=y*width+x;heights[i]=terrain.localHeightAt(point(i))??NaN;}
   if(y%24===0){await new Promise(r=>setTimeout(r,0));check();}
  }
  const index=p=>Math.round((p.y-y0)/step)*width+Math.round((p.x-x0)/step);
  const task=new Worker(new URL('./route-worker.js',import.meta.url),{type:'module'});worker=task;
  try{
   const result=await new Promise((resolve,reject)=>{rejectPending=reject;task.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);task.onerror=()=>reject(new Error('Terrain analysis failed. Try again.'));task.postMessage({heights,width,height,step,start:index({x:0,y:0}),end:index(end)},[heights.buffer]);});
   check();
   function verified(indices){
    const points=[start,...indices.map(point),destination];let distance=0;
    for(let i=1;i<points.length;i++){
     const a=points[i-1],b=points[i],length=distanceBetween(a,b),count=Math.max(1,Math.ceil(length));
     let previous=terrain.localHeightAt(a);
     for(let j=1;j<=count;j++){
      const h=terrain.localHeightAt({lat:a.lat+(b.lat-a.lat)*j/count,lon:a.lon+(b.lon-a.lon)*j/count});
      if(!Number.isFinite(h)||!Number.isFinite(previous)||(length>.01&&Math.abs(h-previous)/(length/count)>Math.tan(15*Math.PI/180)))return null;
      previous=h;
     }
     distance+=length;
    }
    return {points,distance};
   }
   const trail=verified(result.indices)||(result.raw&&verified(result.raw));
   if(!trail)throw new Error('Fine terrain check found a steep or unknown segment. Move the pins; no verified trail was drawn.');
   const {points,distance}=trail;
   return {points,distance,mode:'terrain',assessment:{maxSlope:15,gridStep:step,source:'HiRISE DTM · 1 m',radiation:'unknown',rocks:'unknown',dust:'unknown',soil:'unknown',depressions:'elevation proxy',operationallyValidated:false}};
  }finally{task.terminate();if(worker===task){worker=null;rejectPending=null;}}
 }
 return {plan,cancel};
}
