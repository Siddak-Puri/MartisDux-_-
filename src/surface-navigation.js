import { MARS_RADIUS, normalizeLongitude } from './data.js';

const rad = Math.PI / 180;
export const wrapHeading = degrees => ((degrees % 360) + 360) % 360;
export const headingDelta = (target, heading) => ((target - heading + 540) % 360 + 360) % 360 - 180;

export function distanceBetween(a, b) {
  const dLat = (b.lat-a.lat)*rad, dLon = (b.lon-a.lon)*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 2*MARS_RADIUS*Math.atan2(Math.sqrt(Math.max(0,h)), Math.sqrt(Math.max(0,1-h)));
}

export function bearingTo(a, b) {
  const lat1=a.lat*rad, lat2=b.lat*rad, lon=(b.lon-a.lon)*rad;
  return wrapHeading(Math.atan2(Math.sin(lon)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon))/rad);
}

export function stepOnMars(point, heading, metres) {
  const angular=metres/MARS_RADIUS, course=heading*rad, lat=point.lat*rad;
  const nextLat=Math.asin(Math.max(-1,Math.min(1,Math.sin(lat)*Math.cos(angular)+Math.cos(lat)*Math.sin(angular)*Math.cos(course))));
  const nextLon=point.lon*rad+Math.atan2(Math.sin(course)*Math.sin(angular)*Math.cos(lat),Math.cos(angular)-Math.sin(lat)*Math.sin(nextLat));
  return { lat:nextLat/rad, lon:normalizeLongitude(nextLon/rad) };
}

export function routeSketch(origin, points) {
  const xy=points.map(p=>{
    const distance=distanceBetween(origin,p), bearing=bearingTo(origin,p)*rad;
    return {x:distance*Math.sin(bearing),y:-distance*Math.cos(bearing)};
  });
  const xs=xy.map(p=>p.x), ys=xy.map(p=>p.y);
  const xmin=Math.min(0,...xs), xmax=Math.max(0,...xs), ymin=Math.min(0,...ys), ymax=Math.max(0,...ys);
  const scale=116/Math.max(25,xmax-xmin,ymax-ymin);
  return xy.map(p=>({x:80+(p.x-(xmin+xmax)/2)*scale,y:80+(p.y-(ymin+ymax)/2)*scale}));
}
