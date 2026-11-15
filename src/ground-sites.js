import { MARS_RADIUS } from './data.js';

export const GROUND_SITES = [
  {
    id:'jezero', name:'Jezero Crater', station:'Perseverance landing site', rover:'Perseverance',
    lat:18.4446, lon:77.4509, cameraHeight:16000, date:'21 February 2021',
    image:'/panoramas/perseverance-sol3.jpg', width:9238, height:2451,
    credit:'NASA / JPL-Caltech / MSSS / ASU', product:'PIA24264',
    source:'https://www.jpl.nasa.gov/images/pia24264-mastcam-zs-first-360-degree-panorama/',
    note:'Recorded Mastcam-Z panorama · Sol 3', yaw:50, vertical:.22,
  },
  {
    id:'gale', name:'Gale Crater', station:'Curiosity landing site', rover:'Curiosity',
    lat:-4.5895, lon:137.4417, cameraHeight:110000, date:'8 August 2012 (UTC)',
    image:'/panoramas/curiosity-navcam.jpg', width:7703, height:1678,
    credit:'NASA / JPL-Caltech', product:'PIA16074',
    source:'https://science.nasa.gov/resource/all-around-curiosity/',
    note:'Recorded Navcam panorama · Original monochrome', yaw:155, vertical:.20,
  },
];

export function surfaceDistance(a,b) {
  const rad=Math.PI/180, deltaLat=(b.lat-a.lat)*rad, deltaLon=(b.lon-a.lon)*rad;
  const h=Math.sin(deltaLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(deltaLon/2)**2;
  return 2*MARS_RADIUS*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}

export function nearbyGroundSite(point) {
  if(!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat)>90)return null;
  return GROUND_SITES.find(site=>surfaceDistance(point,site)<=150) || null;
}

export function groundSitesForRoute({start,destination}) {
  return [...new Set([nearbyGroundSite(start),nearbyGroundSite(destination)].filter(Boolean))];
}

export function panoramaFrame(imageWidth,imageHeight,width,height,fov,yaw,vertical) {
  const actualFov=Math.min(Math.max(15,fov),110,360*imageHeight/imageWidth*width/height);
  const sw=imageWidth*actualFov/360, sh=sw*height/width;
  const sx=((yaw/360*imageWidth-sw/2)%imageWidth+imageWidth)%imageWidth;
  const sy=Math.min(imageHeight-sh,Math.max(0,vertical*imageHeight-sh/2));
  return {sx,sy,sw,sh,fov:actualFov,first:Math.min(sw,imageWidth-sx)};
}
