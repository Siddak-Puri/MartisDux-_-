import { MARS_RADIUS } from './data.js';
import { bearingTo, distanceBetween, headingDelta, stepOnMars } from './surface-navigation.js';

export function journeyProgress(start, destination, position, lookAhead=50) {
  const total=distanceBetween(start,destination), course=bearingTo(start,destination);
  const angle=distanceBetween(start,position)/MARS_RADIUS;
  const delta=headingDelta(bearingTo(start,position),course)*Math.PI/180;
  const cross=MARS_RADIUS*Math.asin(Math.max(-1,Math.min(1,Math.sin(angle)*Math.sin(delta))));
  const rawAlong=MARS_RADIUS*Math.atan2(Math.sin(angle)*Math.cos(delta),Math.cos(angle));
  const along=Math.max(0,Math.min(total,rawAlong));
  const closest=stepOnMars(start,course,along);
  const offTrail=distanceBetween(position,closest);
  const remaining=distanceBetween(position,destination);
  const target=offTrail>12?closest:stepOnMars(start,course,Math.min(total,along+lookAhead));
  return {total,along,cross,offTrail,remaining,closest,target,arrived:remaining<=3,
    fraction:along/total, bearing:bearingTo(position,target)};
}

export function advanceOnTrail(start,destination,position,metres) {
  const progress=journeyProgress(start,destination,position);
  const toTrail=progress.offTrail;
  if(toTrail>metres)return stepOnMars(position,bearingTo(position,progress.closest),metres);
  const along=Math.min(progress.total,progress.along+Math.max(0,metres-toTrail));
  return stepOnMars(start,bearingTo(start,destination),along);
}

export function trackOf(points) {
  const cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+distanceBetween(points[i-1],points[i]));
  return {points,cumulative,total:cumulative.at(-1)};
}
export function pointOnTrack(track,s) {
  const {points,cumulative}=track;s=Math.max(0,Math.min(track.total,s));
  let i=1;while(i<points.length-1&&cumulative[i]<s)i++;
  const a=points[i-1],b=points[i],len=cumulative[i]-cumulative[i-1];
  return len<1e-6?{...b}:stepOnMars(a,bearingTo(a,b),s-cumulative[i-1]);
}
export function trackProgress(track,position,lookAhead=50) {
  const {points,cumulative,total}=track,destination=points.at(-1);
  let best=null;
  for(let i=1;i<points.length;i++){
    const len=cumulative[i]-cumulative[i-1];if(len<1e-6)continue;
    const p=journeyProgress(points[i-1],points[i],position,0);
    if(!best||p.offTrail<best.offTrail-1e-6)best={offTrail:p.offTrail,closest:p.closest,along:cumulative[i-1]+p.along};
  }
  if(!best)best={offTrail:distanceBetween(position,points[0]),closest:{...points[0]},along:0};
  const remainingAlong=total-best.along,remaining=best.offTrail+remainingAlong;
  const target=best.offTrail>12?best.closest:pointOnTrack(track,best.along+lookAhead);
  return {total,along:best.along,offTrail:best.offTrail,closest:best.closest,remaining,target,
    arrived:distanceBetween(position,destination)<=3,fraction:total?best.along/total:1,bearing:bearingTo(position,target)};
}
export function advanceOnTrack(track,position,metres) {
  const p=trackProgress(track,position);
  if(p.offTrail>metres)return stepOnMars(position,bearingTo(position,p.closest),metres);
  return pointOnTrack(track,p.along+Math.max(0,metres-p.offTrail));
}
