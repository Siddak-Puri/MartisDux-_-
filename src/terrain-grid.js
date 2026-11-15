import { MARS_RADIUS } from './data.js';
const rad=Math.PI/180;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export async function decodeHeightBuffer(buffer,count) {
  const signature=new Uint8Array(buffer,0,Math.min(2,buffer.byteLength));
  if(signature[0]===31&&signature[1]===139)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(buffer.byteLength!==count*2)throw new Error('Invalid DTM length');
  return new Uint16Array(buffer);
}

export function bilinear(values,width,height,x,y,nodata) {
  if(x<0||y<0||x>width-1||y>height-1)return null;
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,width-1),y1=Math.min(y0+1,height-1);
  const a=values[y0*width+x0],b=values[y0*width+x1],c=values[y1*width+x0],d=values[y1*width+x1];
  if([a,b,c,d].some(v=>!Number.isFinite(v)||v===nodata||v< -1e10))return null;
  return (a*(1-(x-x0))+b*(x-x0))*(1-(y-y0))+(c*(1-(x-x0))+d*(x-x0))*(y-y0);
}
export function sampleDtm(grid,point) {
  const x=(point.lon*rad*MARS_RADIUS-grid.x0)/grid.step,y=(grid.y0-point.lat*rad*MARS_RADIUS)/grid.step;
  const value=bilinear(grid.values,grid.width,grid.height,x,y,grid.nodata);
  return value===null?null:value*grid.scale+grid.offset;
}
export function coverageDistance(grid) {
  const {width:w,height:h,values,nodata,step}=grid,INF=1e9,d=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){const v=values[i];d[i]=(v===nodata||!Number.isFinite(v))?0:INF;}
  const at=(r,c)=>r<0||c<0||r>=h||c>=w?0:d[r*w+c];
  for(let r=0;r<h;r++)for(let c=0;c<w;c++){const i=r*w+c;if(!d[i])continue;
    d[i]=Math.min(d[i],at(r,c-1)+3,at(r-1,c)+3,at(r-1,c-1)+4,at(r-1,c+1)+4);}
  for(let r=h-1;r>=0;r--)for(let c=w-1;c>=0;c--){const i=r*w+c;if(!d[i])continue;
    d[i]=Math.min(d[i],at(r,c+1)+3,at(r+1,c)+3,at(r+1,c+1)+4,at(r+1,c-1)+4);}
  for(let i=0;i<w*h;i++)d[i]=d[i]/3*step;
  return d;
}
export function gridEdgeWeight(grid,point,feather=80) {
  const x=point.lon*rad*MARS_RADIUS-grid.x0,y=grid.y0-point.lat*rad*MARS_RADIUS;
  let edge=Math.min(x,y,(grid.width-1)*grid.step-x,(grid.height-1)*grid.step-y);
  if(grid.coverage&&edge>0){const c=clamp(Math.round(x/grid.step),0,grid.width-1),r=clamp(Math.round(y/grid.step),0,grid.height-1);edge=Math.min(edge,grid.coverage[r*grid.width+c]);}
  const f=clamp(edge/feather,0,1);return f*f*(3-2*f);
}
export function geographicTile(point,level) {
  const rows=2**level,cols=rows*2;
  const lon=((point.lon+180)%360+360)%360-180;
  return {x:clamp(Math.floor((lon+180)/360*cols),0,cols-1),y:clamp(Math.floor((90-point.lat)/180*rows),0,rows-1),level};
}
export function tileBounds(x,y,level) {
  const span=180/2**level;return {west:-180+x*span,east:-180+(x+1)*span,north:90-y*span,south:90-(y+1)*span};
}
