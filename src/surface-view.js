import { Cartesian3 } from 'cesium';
import { GROUND_SITES, groundSitesForRoute, panoramaFrame } from './ground-sites.js';
import { formatRouteDistance } from './route-geometry.js';

const $=id=>document.getElementById(id);
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

export function createGroundViews({viewer,mars,routes,stopRotation,setPlacesCollapsed,onOpen,onClose}) {
  const root=$('ground-view'), canvas=$('ground-canvas'), look=$('ground-look');
  const images=new Map();
  let active=false, site=null, photo=null, saved=null, request=0, busy=false;
  let yaw=0, vertical=.25, fov=76, dragging=null, frame=0, lastFrame=0, focusBefore=null;
  const keys=new Set();

  function routeChanged() {
    const route=routes.getState(), available=groundSitesForRoute(route), list=$('route-ground-list');
    list.replaceChildren();
    $('route-ground-message').textContent=available.length?'Rover 360° photos near your pins':'';
    for(const station of available) {
      const button=document.createElement('button');button.type='button';button.textContent=`${station.rover} · Open ground view ↗`;
      button.addEventListener('click',()=>open(station.id));list.append(button);
    }
    $('ground-route-card').hidden=!route.distance;
    $('ground-route-distance').textContent=route.distance?formatRouteDistance(route.distance):'';
  }
  function loadImage(station) {
    if(!images.has(station.id))images.set(station.id,new Promise((resolve,reject)=>{
      const image=new Image();image.decoding='async';
      image.onload=async()=>{try{await image.decode();resolve(image);}catch(e){images.delete(station.id);reject(e);}};
      image.onerror=()=>{images.delete(station.id);reject(new Error('Image unavailable'));};
      image.src=station.image;
    }));
    return images.get(station.id);
  }
  function draw() {
    if(!active || !photo || busy)return;
    const ratio=Math.min(devicePixelRatio||1,2), width=Math.max(1,Math.round(look.clientWidth*ratio)), height=Math.max(1,Math.round(look.clientHeight*ratio));
    if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}
    const crop=panoramaFrame(photo.width,photo.height,width,height,fov,yaw,vertical);fov=crop.fov;
    const context=canvas.getContext('2d'), dw=crop.first/crop.sw*width;
    context.clearRect(0,0,width,height);
    context.drawImage(photo,crop.sx,crop.sy,crop.first,crop.sh,0,0,dw,height);
    if(crop.first<crop.sw)context.drawImage(photo,0,crop.sy,crop.sw-crop.first,crop.sh,dw,0,width-dw,height);
    $('ground-zoom-in').disabled=fov<=15;
    $('ground-zoom-out').disabled=fov>=Math.min(110,360*photo.height/photo.width*width/height)-.01;
  }
  async function selectSite(id) {
    const next=GROUND_SITES.find(item=>item.id===id);if(!next)return;
    const token=++request;site=next;photo=null;busy=true;keys.clear();dragging=null;
    yaw=site.yaw;vertical=site.vertical;fov=76;
    root.dataset.site=site.id;root.dataset.loading='true';canvas.hidden=true;look.inert=true;
    $('ground-site-select').value=site.id;
    $('ground-title').textContent=site.station;
    $('ground-caption').textContent=`${site.date} · ${site.note}`;
    $('ground-credit').textContent=`${site.credit} · ${site.product} ↗`;$('ground-credit').href=site.source;
    $('ground-map-title').textContent=site.name;
    $('ground-map-station').textContent=site.station;
    $('ground-loading').hidden=false;$('ground-loading-text').textContent=`Opening ${site.rover}’s panorama`;$('ground-retry').hidden=true;
    $('ground-photo-controls').inert=true;
    viewer.camera.cancelFlight();viewer.resize();
    viewer.camera.setView({destination:Cartesian3.fromDegrees(site.lon,site.lat,site.cameraHeight,mars),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
    viewer.scene.requestRender();
    let timeout;
    try {
      const image=await Promise.race([loadImage(site),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Image timed out')),12000);})]);
      if(token!==request || !active)return;
      photo=image;busy=false;canvas.hidden=false;look.inert=false;$('ground-photo-controls').inert=false;
      $('ground-loading').hidden=true;root.dataset.loading='false';draw();
      $('ground-status').textContent=`${site.station} panorama ready. Drag to look around.`;
    } catch {
      if(token!==request || !active)return;
      images.delete(site.id);busy=false;root.dataset.loading='error';
      $('ground-loading-text').textContent='This photo couldn’t load. Your map and route are still available.';
      $('ground-retry').hidden=false;$('ground-status').textContent='Photo unavailable. Retry or close ground view.';
    } finally {clearTimeout(timeout);}
  }
  function open(id) {
    if(!GROUND_SITES.some(item=>item.id===id))return;
    if(!active) {
      onOpen?.();
      stopRotation();viewer.camera.cancelFlight();
      const camera=viewer.camera;
      saved={position:Cartesian3.clone(camera.positionWC),heading:camera.heading,pitch:camera.pitch,roll:camera.roll,
        placesCollapsed:$('discovery-panel').classList.contains('is-collapsed'),routeOpened:!$('route-panel').hidden};
      focusBefore=document.activeElement;
      routes.close();setPlacesCollapsed(true);active=true;root.hidden=false;
      document.body.dataset.ground='open';$('ground-map-context').hidden=false;
      viewer.resize();routeChanged();
    }
    selectSite(id);
    $('ground-close').focus({preventScroll:true});
  }
  function close({restorePanels=true}={}) {
    if(!active)return;
    ++request;active=false;photo=null;busy=false;keys.clear();dragging=null;cancelAnimationFrame(frame);frame=0;lastFrame=0;
    root.hidden=true;delete document.body.dataset.ground;$('ground-map-context').hidden=true;
    viewer.resize();viewer.camera.cancelFlight();
    viewer.camera.setView({destination:saved.position,orientation:{heading:saved.heading,pitch:saved.pitch,roll:saved.roll}});
    viewer.scene.requestRender();
    if(restorePanels){onClose?.();if(saved.routeOpened)routes.open();else setPlacesCollapsed(saved.placesCollapsed);}
    if(restorePanels && focusBefore?.isConnected && focusBefore.getClientRects().length)focusBefore.focus({preventScroll:true});
  }
  function zoom(amount) {if(!photo)return;fov=clamp(fov+amount,15,110);draw();}
  function reset() {yaw=site.yaw;vertical=site.vertical;fov=76;draw();}
  look.addEventListener('pointerdown',event=>{
    if(busy || !photo || (event.pointerType==='mouse' && event.button!==0))return;
    look.focus({preventScroll:true});look.setPointerCapture(event.pointerId);dragging={x:event.clientX,y:event.clientY,id:event.pointerId};
  });
  look.addEventListener('pointermove',event=>{
    if(!dragging || dragging.id!==event.pointerId)return;
    yaw-=(event.clientX-dragging.x)*fov/Math.max(1,look.clientWidth);
    vertical=clamp(vertical-(event.clientY-dragging.y)/Math.max(1,look.clientHeight)*.4,0,1);
    dragging={x:event.clientX,y:event.clientY,id:event.pointerId};draw();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])look.addEventListener(event,()=>dragging=null);
  look.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY*.035);},{passive:false});
  function tick(time) {
    if(!active || busy || !keys.size){frame=0;lastFrame=0;return;}
    const dt=Math.min((time-(lastFrame||time))/1000,.05);lastFrame=time;
    yaw+=(Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')))*dt*40;
    vertical=clamp(vertical+(Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp')))*dt*.2,0,1);
    draw();frame=requestAnimationFrame(tick);
  }
  look.addEventListener('keydown',event=>{
    if(event.key.startsWith('Arrow')){event.preventDefault();keys.add(event.key);if(!frame)frame=requestAnimationFrame(tick);}
    if(event.key==='+' || event.key==='='){event.preventDefault();zoom(-10);}
    if(event.key==='-'){event.preventDefault();zoom(10);}
  });
  document.addEventListener('keyup',event=>keys.delete(event.key));
  window.addEventListener('blur',()=>{keys.clear();dragging=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)keys.clear();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && active){event.preventDefault();close();}});
  $('ground-close').addEventListener('click',()=>close());
  $('ground-site-select').addEventListener('change',event=>selectSite(event.target.value));
  $('ground-retry').addEventListener('click',()=>selectSite(site.id));
  $('ground-zoom-in').addEventListener('click',()=>zoom(-10));
  $('ground-zoom-out').addEventListener('click',()=>zoom(10));
  $('ground-reset').addEventListener('click',reset);
  $('ground-show-route').addEventListener('click',()=>{close({restorePanels:false});routes.open();routes.fit();});
  document.querySelectorAll('[data-ground-site]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.groundSite)));
  $('route-browse-ground').addEventListener('click',()=>{routes.close();setPlacesCollapsed(false);$('ground-sites').scrollIntoView({block:'nearest'});$('ground-sites').querySelector('button').focus({preventScroll:true});});
  for(const id of ['explore-panel-toggle','route-toggle','search-focus','brand-home','home-button','route-open']) {
    $(id).addEventListener('click',()=>close({restorePanels:false}),true);
  }
  new ResizeObserver(()=>{viewer.resize();draw();}).observe(look);
  routeChanged();
  return {get active(){return active;},open,close,routeChanged};
}
