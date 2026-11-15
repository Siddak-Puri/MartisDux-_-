export function findTerrainPath({heights,width,height,step,start,end,maxSlope=15}){
 const n=width*height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||!Number.isFinite(step)||step<=0||!Number.isFinite(maxSlope)||maxSlope<=0||maxSlope>=90||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<0||start>=n||end>=n||heights.length!==n||n>250000)throw new Error('Route grid is too large.');
 const valid=new Uint8Array(n),cost=new Float32Array(n),limit=Math.tan(maxSlope*Math.PI/180),ring=Math.max(2,Math.round(40/step));
 const at=(x,y)=>x>=0&&y>=0&&x<width&&y<height?heights[y*width+x]:NaN;
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=y*width+x,z=heights[i],a=at(x-1,y),b=at(x+1,y),c=at(x,y-1),d=at(x,y+1);
  if(![z,a,b,c,d].every(Number.isFinite))continue;
  const grade=Math.max(Math.abs(a-z),Math.abs(b-z),Math.abs(c-z),Math.abs(d-z))/step;
  if(grade>limit)continue;
  const outer=[at(x-ring,y),at(x+ring,y),at(x,y-ring),at(x,y+ring)].filter(Number.isFinite);
  const depression=outer.length===4?Math.max(0,outer.reduce((a,b)=>a+b,0)/4-z):0;
  if(depression>5)continue;
  valid[i]=1;cost[i]=1+4*(grade/limit)**2+Math.min(8,Math.abs(z-(a+b+c+d)/4)*5)+Math.min(12,depression*3);
 }
 if(!valid[start]||!valid[end])throw new Error('An endpoint is outside usable terrain or exceeds the terrain limits. Move the pin.');
 const g=new Float64Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),closed=new Uint8Array(n),heap=[];g[start]=0;
 const heuristic=i=>Math.hypot(i%width-end%width,Math.floor(i/width)-Math.floor(end/width))*step;
 const push=(i,f)=>{let k=heap.length;heap.push({i,f});while(k){let p=(k-1)>>1;if(heap[p].f<=f)break;heap[k]=heap[p];k=p;}heap[k]={i,f};};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[k]=heap[c];k=c;}heap[k]=last;}return first.i;};
 push(start,heuristic(start));
 while(heap.length){const i=pop();if(closed[i])continue;closed[i]=1;if(i===end){const result=[];for(let j=end;j!==-1;j=parent[j])result.push(j);result.reverse();return {indices:smoothPath(result,{heights,width,valid,cost,limit,step}),raw:result,maxSlope,gridStep:step};}
  const x=i%width,y=Math.floor(i/width);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<1||yy<1||xx>=width-1||yy>=height-1)continue;
   const j=yy*width+xx;if(!valid[j]||closed[j]||(dx&&dy&&(!valid[y*width+xx]||!valid[yy*width+x])))continue;
   const length=step*Math.hypot(dx,dy);if(Math.abs(heights[j]-heights[i])/length>limit)continue;
   const candidate=g[i]+length*(cost[i]+cost[j])/2;if(candidate<g[j]){g[j]=candidate;parent[j]=i;push(j,candidate+heuristic(j));}
  }
 }
 throw new Error('No route found within the terrain limits and available coverage. Move the pins closer.');
}

export function smoothPath(path,{heights,width,valid,cost,limit,step}){
 if(path.length<3)return path;
 const xy=i=>[i%width,Math.floor(i/width)];
 function clear(a,b,worst){
  const [x0,y0]=xy(a),[x1,y1]=xy(b),n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));let prev=a;
  for(let k=1;k<=n;k++){
   const x=Math.round(x0+(x1-x0)*k/n),y=Math.round(y0+(y1-y0)*k/n),j=y*width+x;
   if(!valid[j]||cost[j]>worst+1e-6)return false;
   const [px,py]=xy(prev);if(Math.abs(heights[j]-heights[prev])/(step*Math.hypot(x-px,y-py)||1)>limit)return false;
   if(x!==px&&y!==py&&(!valid[py*width+x]||!valid[y*width+px]))return false;
   prev=j;
  }
  return true;
 }
 const out=[path[0]];let anchor=0;
 while(anchor<path.length-1){
  let best=anchor+1,worst=Math.max(cost[path[anchor]],cost[path[anchor+1]]);
  for(let j=anchor+2;j<path.length&&j-anchor<=150;j++){worst=Math.max(worst,cost[path[j]]);if(clear(path[anchor],path[j],worst))best=j;}
  out.push(path[best]);anchor=best;
 }
 return out;
}
