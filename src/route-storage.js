import { MARS_RADIUS } from './data.js';
import { surfaceRoute } from './route-geometry.js';
import { distanceBetween } from './surface-navigation.js';
export const ROUTE_FORMAT='martisdux-route-v1';
export function validateRoute(value) {
  if(!value || value.format!==ROUTE_FORMAT || value.body!=='Mars' || value.radiusMetres!==MARS_RADIUS) throw new Error('Choose a MartisDux Mars route JSON.');
  const point=p=>{
    if(!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat)>90 || p.lon < -180 || p.lon>180) throw new Error('Invalid Mars coordinates.');
    return {lat:p.lat,lon:p.lon,...(typeof p.name==='string'?{name:p.name.slice(0,100)}:{})};
  };
  const start=point(value.start),destination=point(value.destination),mode=value.mode==='safe'?'terrain':value.mode||'direct';
  if(!['direct','terrain'].includes(mode))throw new Error('Unknown route method.');
  const direct=surfaceRoute(start,destination);let points=direct.points,distance=direct.distance;
  if(mode==='terrain'){
    if(!Array.isArray(value.points)||value.points.length<2||value.points.length>12000)throw new Error('Invalid terrain path.');
    points=value.points.map(point);
    if(distanceBetween(points[0],start)>.1||distanceBetween(points.at(-1),destination)>.1)throw new Error('Path endpoints do not match the pins.');
    distance=0;for(let i=1;i<points.length;i++){const d=distanceBetween(points[i-1],points[i]);if(d>50000)throw new Error('Terrain path has a gap.');distance+=d;}
    if(distance>3_000_000||distance<1)throw new Error('Invalid terrain path length.');
  }
  return {format:ROUTE_FORMAT,body:'Mars',radiusMetres:MARS_RADIUS,name:String(value.name||'Untitled route').slice(0,100),start,destination,mode,points,distanceMetres:distance};
}
export const documentMode=state=>state.mode==='direct'||!state.points?'direct':'terrain';
export function routeDocument(state) {
  const mode=documentMode(state);
  return {...validateRoute({format:ROUTE_FORMAT,body:'Mars',radiusMetres:MARS_RADIUS,start:state.start,destination:state.destination,mode,points:state.points,name:state.name||`${state.start?.name||'Pin A'} → ${state.destination?.name||'Pin B'}`}),
    coordinateSystem:'Planetocentric latitude; east-positive longitude; degrees',
    method:mode==='direct'?'Shortest great-circle line. Slopes and hazards not evaluated.':state.fine?'Elevation-cost A* on the native 1 m HiRISE DTM: 4 m grid, 15° slope limit, depression and roughness penalties, every metre re-checked. Not operationally validated.':`Slope-cost A* on ${state.gridLabel||'the finest available elevation model'}, slopes under 25°. Not operationally validated.`,
    hazards:{radiation:'unknown',rocks:'unknown',dust:'unknown',soil:'unknown',craters:mode==='terrain'?(state.fine?'depression proxy (pits deeper than 5 m avoided)':'slope only'):'not evaluated'},
    sources:['https://trek.nasa.gov/mars/','https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer']};
}
