import {bearing,turn} from './geo.js';
export const LIMITS={caution:10,steep:15,lookAhead:80};
export function scanTerrain(hf,position,heading){
 const samples=[];
 for(let distance=8;distance<=LIMITS.lookAhead;distance+=4){
  for(const offset of [-18,0,18]){
   const angle=(heading+offset)*Math.PI/180,x=position.x+Math.sin(angle)*distance,z=position.z-Math.cos(angle)*distance;
   if(!hf.inside(x-3,z-3)||!hf.inside(x+3,z+3)){samples.push({distance,unknown:true,x,z});continue;}
   const slope=hf.slope(x,z,2);samples.push({distance,slope,x,z,unknown:!Number.isFinite(slope)});
  }
 }
 const danger=samples.filter(p=>p.slope>=LIMITS.steep).sort((a,b)=>a.distance-b.distance)[0];
 const caution=samples.filter(p=>p.slope>=LIMITS.caution).sort((a,b)=>a.distance-b.distance)[0];
 const missing=samples.filter(p=>p.unknown).sort((a,b)=>a.distance-b.distance)[0];
 const nearest=danger||caution||missing;
 return {level:danger?'steep':caution?'caution':missing?'unknown':'low',title:danger?'Steep terrain':caution?'Uneven approach':missing?'Coverage edge':'Low grade ahead',distance:nearest?.distance??80,slope:nearest?.slope??Math.max(0,...samples.map(p=>p.slope||0)),point:nearest||null};
}
export function validatePose(value,meta){
 if(!value||!Number.isFinite(value.heading))return null;
 const position=value.position;
 if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.z)||position.x<0||position.z<0||position.x>meta.grid.width||position.z>meta.grid.depth)return null;
 if(value.pitch!==undefined&&(!Number.isFinite(value.pitch)||Math.abs(value.pitch)>90))return null;
 return {position:{x:position.x,z:position.z},heading:((value.heading%360)+360)%360,pitch:value.pitch??0};
}
export function routeState(route,position,heading){
 if(!route)return null;
 const p=route.project(position.x,position.z),next=p.off>12?p:route.at(Math.min(route.length,p.along+20));
 return {walked:p.along,length:route.length,remaining:Math.max(0,route.length-p.along)+(p.off>12?p.off:0),offRoute:p.off,turnToRoute:turn(heading,bearing(next.x-position.x,next.z-position.z))};
}
export function classifySlope(slope){return !Number.isFinite(slope)?'unknown':slope>=15?'steep':slope>=10?'caution':'low';}
