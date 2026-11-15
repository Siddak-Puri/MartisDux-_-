export const DEFAULT_HELMET_PROFILE = Object.freeze({width:88,height:88,offset:0,contrast:false});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const bounded=(n,min,max,fallback)=>Number.isFinite(n)?clamp(n,min,max):fallback;
export function helmetProfile(value={}){
 const p=value||{};
 const height=bounded(p.height,64,94,88),offsetLimit=Math.min(10,(100-height)/2-1);
 return {width:bounded(p.width,70,96,88),height,offset:bounded(p.offset,-offsetLimit,offsetLimit,0),contrast:p.contrast===true};
}
const distance=n=>!Number.isFinite(n)?'—':n>=1000?`${(n/1000).toFixed(2)} km`:`${Math.round(n)} m`;
const cardinals=['N','NE','E','SE','S','SW','W','NW'];
export function helmetReadout(s={}){
 const tracking=s.mode==='stale'?'POSE SIGNAL LOST':s.mode==='waiting'?'AWAITING AR POSE':null;
 const heading=!tracking&&Number.isFinite(s.heading)?((s.heading%360)+360)%360:null;
 const route=!tracking&&Number.isFinite(s.route?.remaining)?s.route:null;
 const turn=Number.isFinite(route?.turnToRoute)?((route.turnToRoute%360+540)%360)-180:null;
 const arrived=route&&route.remaining<2;
 const hazard=s.hazard;
 const level=tracking?'unknown':hazard?.level||'unknown';
 const warning=tracking||({steep:'SLOPE ≥15° AHEAD',caution:'SLOPE ≥10° AHEAD',unknown:'TERRAIN UNKNOWN',low:'LOW GRADE AHEAD'}[level]||'TERRAIN UNKNOWN');
 const details=[];
 if(!tracking&&Number.isFinite(hazard?.slope)&&level!=='unknown')details.push(`${hazard.slope.toFixed(1)}° grade`);
 if(!tracking&&Number.isFinite(hazard?.distance)&&hazard.distance>0)details.push(`${distance(hazard.distance)} ahead`);
 return {heading,headingLabel:heading===null?'—':`${String(Math.round(heading)%360).padStart(3,'0')}° ${cardinals[Math.round(heading/45)%8]}`,turn:arrived?null:turn,
  guidance:tracking?'POSITION UNAVAILABLE':!route?'NO ROUTE':arrived?'WAYPOINT REACHED':route.offRoute>12?'RETURN TO ROUTE':turn===null?'ROUTE DIRECTION UNKNOWN':Math.abs(turn)<8?'STRAIGHT AHEAD':`TURN ${turn<0?'LEFT':'RIGHT'} ${Math.round(Math.abs(turn))}°`,
  remaining:route?distance(route.remaining):'—',destination:route?(s.destination||s.next?.name||'Waypoint'):'—',level,warning,detail:details.join(' · '),mode:s.mode==='ar'?'AR LINKED':tracking?'AR OVERLAY':'SURFACE PREVIEW'};
}

export function helmetSurface({horizontalFov=56,verticalFov=36,distance=1.5,curvature=1,columns=40,rows=24}={}){
 const h=Math.tan(bounded(horizontalFov,20,115,56)*Math.PI/360),v=Math.tan(bounded(verticalFov,15,90,36)*Math.PI/360);
 const d=bounded(distance,.25,10,1.5),bend=bounded(curvature,0,1,1);
 const cols=Math.round(bounded(columns,1,128,40)),lines=Math.round(bounded(rows,1,128,24));
 const positions=[],uvs=[],indices=[];
 for(let row=0;row<=lines;row++)for(let col=0;col<=cols;col++){
  const u=col/cols,w=row/lines,x=(2*u-1)*h,y=(2*w-1)*v;
  const z=d*(1-bend+bend/Math.hypot(x,y,1));
  positions.push(x*z,y*z,-z);uvs.push(u,w);
  if(row<lines&&col<cols){const i=row*(cols+1)+col,j=i+cols+1;indices.push(i,i+1,j,i+1,j+1,j);}
 }
 return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),indices:new Uint16Array(indices)};
}
