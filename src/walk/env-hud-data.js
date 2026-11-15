import { MARS_R, RAD, sampleRaster } from './env-math.js';
import { Route } from './visor/geo.js';

export function createLandingMap([west, south, east, north], start) {
  const latitudeScale = MARS_R * RAD, longitudeScale = latitudeScale * Math.cos(start.lat * RAD);
  const toMap = ({lat, lon}) => ({x:(lon-west)*longitudeScale,z:(north-lat)*latitudeScale});
  const toGeo = (x,z) => ({lat:north-z/latitudeScale,lon:west+x/longitudeScale});
  const size = toMap({lat:south,lon:east});
  return {toMap,toGeo,width:size.x,depth:size.z};
}

export function measuredLandingField(raster, map, [west,south,east,north]) {
  const inside = (x,z) => {
    const {lat,lon}=map.toGeo(x,z);
    return lat>=south&&lat<=north&&lon>=west&&lon<=east;
  };
  const height=(x,z)=>{
    const {lat,lon}=map.toGeo(x,z);
    return inside(x,z)?sampleRaster(raster,lat,lon):NaN;
  };
  const slope=(x,z,span=2)=>Math.atan(Math.hypot(height(x+span,z)-height(x-span,z),height(x,z+span)-height(x,z-span))/(2*span))/RAD;
  return {inside,height,slope};
}

export function routeForLanding(value, map, [west,south,east,north]) {
  const points=value?.points;
  if(!Array.isArray(points)||points.length<2||points.length>12000)return null;
  if(!points.every(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=south&&p.lat<=north&&p.lon>=west&&p.lon<=east))return null;
  const plotted=points.map(point=>{const p=map.toMap(point);return [p.x,p.z];});
  const route=new Route(plotted);
  if(route.length<1||route.length>15000)return null;
  const last=points.at(-1),dest={...last,...map.toMap(last),name:String(value.dest?.name||value.destination?.name||'Waypoint').split(' · ')[0].slice(0,80)};
  return {route, dest, points, origin:points[0], label:value.demo?'Demo walk':value.mode==='direct'?'Direct route':value.mode==='terrain'?'Terrain-screened route':'Jezero reference route'};
}
