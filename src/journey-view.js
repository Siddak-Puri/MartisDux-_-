import { Cartesian3, Color, Math as CMath, ArcType, LabelStyle, Cartesian2, Cartographic, PolylineOutlineMaterialProperty } from 'cesium';
import { DATASETS, containsPoint } from './data.js';
import { surfaceRoute, formatRouteDistance } from './route-geometry.js';
import { bearingTo, distanceBetween, stepOnMars, wrapHeading, headingDelta, routeSketch } from './surface-navigation.js';
import { trackOf, trackProgress, advanceOnTrack, pointOnTrack } from './journey-geometry.js';
import { createGroundImagery } from './ground-imagery.js';
import { createProfileChart } from './profile-chart.js';

const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const rad=Math.PI/180;

export function createJourney({viewer,mars,routes,photos,stopRotation,setPlacesCollapsed,terrain,hazards,getMode,setMode,getImageryState,hud}) {
  const root=$('journey-view'), look=$('journey-look'), controller=viewer.scene.screenSpaceCameraController;
  const keys=new Set(), held=new Set();
  const detail=createGroundImagery(viewer,mars);
  const profileChart=createProfileChart($('journey-profile'),{label:'Elevation profile with your position'});let loadingHeight=false,lastCameraGround=null;
  let active=false,busy=false,following=false,wasArrived=false,position=null,start=null,destination=null,route=null,track=null,saved=null;
  let heading=0,pitch=-10,viewHeight=15,speed=1.4,frame=0,lastTime=0,drag=null,session=0,cancelWait=null,lastUI=0,lastTrail=null,focusBefore=null,lastTrailTime=0;
  const corridor=viewer.entities.add({id:'journey-corridor',show:false,corridor:{positions:[],width:3,granularity:.00001,
    material:Color.fromCssColorString('#ff9c4c').withAlpha(.32)}});
  const waypoint=viewer.entities.add({id:'journey-waypoint',show:false,position:Cartesian3.fromDegrees(0,0,1,mars),
    point:{pixelSize:10,color:Color.fromCssColorString('#ff9c4c'),outlineColor:Color.fromCssColorString('#120b07'),outlineWidth:2},
    label:{text:'',font:'12px "Instrument Sans Variable"',fillColor:Color.fromCssColorString('#fef3e2'),style:LabelStyle.FILL_AND_OUTLINE,
      outlineColor:Color.fromCssColorString('#120b07'),outlineWidth:3,pixelOffset:new Cartesian2(0,-23),showBackground:true,backgroundColor:Color.fromCssColorString('#20150fcc')}});
  const centreline=viewer.entities.add({id:'journey-centreline',show:false,polyline:{positions:[],width:7,clampToGround:false,arcType:ArcType.NONE,material:new PolylineOutlineMaterialProperty({color:Color.fromCssColorString('#ff9c4c'),outlineColor:Color.fromCssColorString('#28170c'),outlineWidth:2})}});


  function routeChanged(){
    const state=routes.getState(),ready=Boolean(state.start&&state.destination&&state.distance&&!state.planning);
    $('journey-start').disabled=!ready;
    $('journey-entry-note').textContent=ready?'':'Set a start and destination first.';
  }
  function setFollowing(value){following=value;$('journey-follow').setAttribute('aria-pressed',String(value));$('journey-follow').innerHTML=value?'Pause journey <span>Ⅱ</span>':'Follow trail <span>→</span>';if(value)run();}
  function selectedHeight(){
    if($('journey-height').value!=='auto')return Number($('journey-height').value);
    return containsPoint(DATASETS.hirise.bounds,position.lon,position.lat)?40:containsPoint(DATASETS.ctx.bounds,position.lon,position.lat)?600:20000;
  }
  function baseHeight(point) {
    const measured=terrain.heightAt(point),rendered=viewer.scene.globe.getHeight(Cartographic.fromDegrees(point.lon,point.lat));
    if(measured===null)return null;
    return Math.max(measured,Number.isFinite(rendered)?rendered:measured);
  }
  function camera(){
    const ground=baseHeight(position);
    if(ground===null){
      if(loadingHeight)return;loadingHeight=true;pause();busyState(true);
      $('journey-loading-text').textContent='Loading elevation ahead';const token=session;
      terrain.prepare(position).then(()=>{if(!active||token!==session)return;loadingHeight=false;busyState(false);camera();run();}).catch(()=>{if(token===session)$('journey-loading-text').textContent='Terrain is unavailable here. Return to the map to retry.';});return;
    }
    lastCameraGround=ground;
    viewer.camera.setView({destination:Cartesian3.fromDegrees(position.lon,position.lat,ground+viewHeight,mars),orientation:{heading:heading*rad,pitch:pitch*rad,roll:0}});
    viewer.scene.requestRender();
  }
  function drawTrail(progress,force=false){
    if(!force&&lastTrail&&distanceBetween(lastTrail,position)<8&&performance.now()-lastTrailTime<1800)return;
    lastTrailTime=performance.now();
    lastTrail={...position};
    const begin=Math.max(0,progress.along-70),end=Math.min(route.distance,progress.along+Math.max(700,viewHeight*8));
    const positions=[],count=Math.max(1,Math.min(600,Math.ceil((end-begin)/4)));
    for(let i=0;i<=count;i++){const p=pointOnTrack(track,begin+(end-begin)*i/count);positions.push(Cartesian3.fromDegrees(p.lon,p.lat,(baseHeight(p)??0)+.75,mars));}
    centreline.polyline.positions=positions;corridor.show=false;centreline.show=true;
  }
  function refresh(force=false){
    if(!active||!position)return;
    const p=trackProgress(track,position,Math.max(50,viewHeight*2.5));drawTrail(p,force);
    const delta=headingDelta(p.bearing,heading),turn=Math.abs(delta)<15?'Trail ahead':delta<0?'Turn left toward trail':'Turn right toward trail';
    $('journey-instruction').textContent=p.arrived?'Destination reached':p.offTrail>12?'Return to the trail':turn;
    $('journey-remaining').textContent=p.arrived?'You’re at B':`${formatRouteDistance(p.remaining)} remaining`;
    $('journey-waypoint').textContent=p.arrived?'':`· next waypoint ${formatRouteDistance(distanceBetween(position,p.target))}`;
    $('journey-progress-label').textContent=`${p.arrived?100:Math.round(p.fraction*100)}% complete`;
    $('journey-offtrail').textContent=p.offTrail>3?`${formatRouteDistance(p.offTrail)} off trail`:'On trail';
    $('journey-progress-bar').value=p.arrived?1:p.fraction;
    profileChart.mark(p.along);
    $('journey-pointer').style.transform=`rotate(${delta}deg)`;
    $('journey-heading').textContent=`${String(Math.round(heading)%360).padStart(3,'0')}° ${['N','NE','E','SE','S','SW','W','NW'][Math.round(heading/45)%8]}`;
    $('journey-coordinate').textContent=`${Math.abs(position.lat).toFixed(5)}°${position.lat<0?'S':'N'} / ${Math.abs(position.lon).toFixed(5)}°${position.lon<0?'W':'E'}`;
    const pts=routeSketch(start,[...route.points,position]);
    $('journey-map-path').setAttribute('d',pts.slice(0,-1).map((v,i)=>`${i?'L':'M'}${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' '));
    for(const [id,v] of [['a',pts[0]],['b',pts.at(-2)],['you',pts.at(-1)]])$(`journey-map-${id}`).setAttribute('transform',`translate(${v.x},${v.y})`);
    $('journey-map-arrow').setAttribute('transform',`rotate(${heading})`);
    const source=getImageryState(),patch=detail.info,data=DATASETS[patch?.id||source.id];
    $('journey-source').textContent=`${data.title} ↗`;$('journey-source').href=data.nasaSource||data.source;
    const elevation=terrain.infoAt(position);
    const here=hazards?.at(position);
    $('journey-slope').textContent=here?`Slope here ${here.slope.toFixed(0)}° · ${here.cls.label}`:'Measured terrain · slope not mapped here';
    $('journey-slope').dataset.level=here?.cls.id||'';
    $('journey-detail').textContent=`${elevation.title} · ${viewHeight} m above ground${patch?.partial?' · partial image detail':detail.loading?' · loading detail ahead':''}`;
    waypoint.position=Cartesian3.fromDegrees(p.target.lon,p.target.lat,(terrain.heightAt(p.target)??baseHeight(position))+1.1,mars);
    waypoint.label.pixelOffset=new Cartesian2(0,viewHeight<=2?22:-23);
    waypoint.label.text=p.arrived?'Destination B':`${p.offTrail>12?'Rejoin trail':'Waypoint'} · ${formatRouteDistance(distanceBetween(position,p.target))}`;
    waypoint.show=!busy&&!p.arrived;
    $('journey-step').disabled=p.arrived;$('journey-follow').disabled=p.arrived;
    if(p.arrived){setFollowing(false);if(!wasArrived)$('journey-status').textContent='Destination B reached.';}
    wasArrived=p.arrived;
    hud?.update({position,heading,along:p.along,remaining:p.arrived?0:p.remaining});
    return p;
  }
  function waitForTiles(token,limit){return new Promise(resolve=>{
    let timer;const started=performance.now();
    const finish=()=>{clearTimeout(timer);remove();cancelWait=null;resolve();};
    const check=()=>{if(token!==session||!active||(performance.now()-started>450&&viewer.scene.globe.tilesLoaded))finish();else viewer.scene.requestRender();};
    const remove=viewer.scene.postRender.addEventListener(check);cancelWait=finish;timer=setTimeout(finish,limit);viewer.scene.requestRender();
  });}
  function busyState(value){busy=value;$('journey-loading').hidden=!value;look.inert=value;root.classList.toggle('is-loading',value);}
  async function enter(){
    const state=routes.getState();if(active||!state.distance||state.planning)return;
    photos.close({restorePanels:false});stopRotation();viewer.camera.cancelFlight();focusBefore=document.activeElement;
    const c=viewer.camera;
    saved={position:Cartesian3.clone(c.positionWC),heading:c.heading,pitch:c.pitch,roll:c.roll,near:c.frustum.near,fov:c.frustum.fov,background:viewer.scene.backgroundColor.clone(),
      inputs:controller.enableInputs,collision:controller.enableCollisionDetection,minZoom:controller.minimumZoomDistance,mode:getMode(),
      routeOpened:!$('route-panel').hidden,placesCollapsed:$('discovery-panel').classList.contains('is-collapsed'),
      entities:viewer.entities.values.filter(e=>![corridor,centreline,waypoint].includes(e)).map(e=>({e,show:e.show})),
      inert:[...document.querySelector('.explorer').children].filter(el=>el!==root).map(el=>({el,value:el.inert}))};
    start={...state.start};destination={...state.destination};position={...start};
    const points=state.points||surfaceRoute(start,destination).points;track=trackOf(points);route={distance:track.total,points};profileChart.render(state.profile);
    heading=trackProgress(track,start).bearing;pitch=-18;viewHeight=selectedHeight();speed=Number($('journey-speed').value);
    active=true;wasArrived=false;const token=++session;lastTrail=null;routes.close();setPlacesCollapsed(true);
    saved.inert.forEach(({el})=>el.inert=true);saved.entities.forEach(({e})=>e.show=false);
    root.hidden=false;document.body.dataset.journey='open';controller.enableInputs=false;controller.enableCollisionDetection=false;controller.minimumZoomDistance=.2;
    viewer.scene.backgroundColor=Color.fromCssColorString('#8e7964');
    c.frustum.near=.1;c.frustum.fov=CMath.toRadians(65);viewer.resize();setMode('viking');busyState(true);refresh(true);
    $('journey-status').textContent='Preparing your journey from pin A.';
    $('journey-destination').textContent=destination.name||'Destination B';$('journey-loading-text').textContent='Loading the ground beneath your route';
    $('journey-cancel').focus({preventScroll:true});
    let ground;
    try {
      const prepared=await Promise.all([terrain.prepare(start),detail.load(start,(done,total)=>{if(active&&token===session)$('journey-loading-text').textContent=`Loading native NASA detail · ${done} / ${total} tiles`;}).catch(()=>null)]);
      if(token!==session)return;ground=prepared[0];
    }catch(error){if(token===session)$('journey-loading-text').textContent='Elevation data could not load. Return to the map to retry.';return;}
    c.setView({destination:Cartesian3.fromDegrees(start.lon,start.lat,ground+1800,mars),orientation:{heading:heading*rad,pitch:-Math.PI/2,roll:0}});
    $('journey-loading-text').textContent='Building the terrain beneath your route';
    await waitForTiles(token,1800);if(token!==session)return;
    camera();$('journey-loading-text').textContent='Fitting the trail to measured terrain';
    await waitForTiles(token,1600);if(token!==session)return;
    busyState(false);refresh(true);look.focus({preventScroll:true});run();
    $('journey-status').textContent='Journey ready. W A S D to move, drag to look, or choose Follow trail. Space pauses.';
  }
  function close({restorePanels=true}={}){
    if(!active)return;
    ++session;cancelWait?.();cancelAnimationFrame(frame);frame=0;lastTime=0;keys.clear();held.clear();drag=null;setFollowing(false);
    busyState(false);active=false;loadingHeight=false;detail.close();root.hidden=true;delete document.body.dataset.journey;viewer.scene.backgroundColor=saved.background;
    corridor.show=false;centreline.show=false;waypoint.show=false;
    saved.inert.forEach(({el,value})=>el.inert=value);saved.entities.forEach(({e,show})=>e.show=show);
    controller.enableInputs=saved.inputs;controller.enableCollisionDetection=saved.collision;controller.minimumZoomDistance=saved.minZoom;
    viewer.camera.frustum.near=saved.near;viewer.camera.frustum.fov=saved.fov;viewer.resize();
    viewer.camera.setView({destination:saved.position,orientation:{heading:saved.heading,pitch:saved.pitch,roll:saved.roll}});setMode(saved.mode);
    if(restorePanels){if(saved.routeOpened)routes.open();else setPlacesCollapsed(saved.placesCollapsed);}
    if(restorePanels&&focusBefore?.isConnected&&focusBefore.getClientRects().length)focusBefore.focus({preventScroll:true});
    viewer.scene.requestRender();
  }
  function move(forward,sideways,metres){
    if(!forward&&!sideways)return;
    position=stepOnMars(position,heading+Math.atan2(sideways,forward)/rad,metres);
  }
  function tick(time){
    if(!active||busy){frame=0;lastTime=0;return;}
    const dt=Math.min((time-(lastTime||time))/1000,.05);lastTime=time;let changed=false;
    const forward=Number(keys.has('w')||held.has('forward'))-Number(keys.has('s')||held.has('backward'));
    const sideways=Number(keys.has('d')||held.has('right'))-Number(keys.has('a')||held.has('left'));
    if(forward||sideways){setFollowing(false);move(forward,sideways,speed*dt);changed=true;}
    else if(following){position=advanceOnTrack(track,position,speed*dt);const next=trackProgress(track,position);if(!next.arrived)heading=next.bearing;changed=true;}
    const turn=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),tilt=Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'));
    if(turn||tilt){heading=wrapHeading(heading+turn*50*dt);pitch=clamp(pitch+tilt*35*dt,-65,20);changed=true;}
    if(changed)camera();
    if(time-lastUI>100){
      const ground=baseHeight(position);if(ground!==null&&lastCameraGround!==null&&Math.abs(ground-lastCameraGround)>.3)camera();
      detail.update(position);refresh();lastUI=time;
    }
    frame=requestAnimationFrame(tick);
  }
  function run(){if(!frame&&active&&!busy)frame=requestAnimationFrame(tick);}
  function pause(){keys.clear();held.clear();setFollowing(false);}
  $('journey-start').addEventListener('click',enter);
  $('journey-hazards').addEventListener('click',()=>{hazards?.setVisible(!hazards.visible).catch(()=>{});look.focus({preventScroll:true});});
  for(const id of ['journey-close','journey-cancel'])$(id).addEventListener('click',()=>close());
  $('journey-follow').addEventListener('click',()=>{if(!busy){keys.clear();held.clear();setFollowing(!following);look.focus({preventScroll:true});}});
  $('journey-step').addEventListener('click',()=>{if(busy)return;setFollowing(false);move(1,0,25);camera();refresh(true);});
  $('journey-face').addEventListener('click',()=>{heading=trackProgress(track,position).bearing;pitch=-10;camera();refresh();});
  $('journey-reset').addEventListener('click',()=>{pause();position={...start};heading=trackProgress(track,start).bearing;pitch=-10;camera();refresh(true);});
  $('journey-speed').addEventListener('change',e=>{speed=Number(e.target.value);});
  $('journey-height').addEventListener('change',()=>{viewHeight=selectedHeight();camera();refresh();});
  look.addEventListener('pointerdown',e=>{if(busy||(e.pointerType==='mouse'&&e.button!==0))return;look.focus({preventScroll:true});look.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,id:e.pointerId};setFollowing(false);});
  look.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;heading=wrapHeading(heading-(e.clientX-drag.x)*.15);pitch=clamp(pitch+(e.clientY-drag.y)*.12,-65,20);drag={x:e.clientX,y:e.clientY,id:e.pointerId};camera();refresh();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])look.addEventListener(event,()=>drag=null);
  document.querySelectorAll('[data-move]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{if(busy)return;e.preventDefault();button.setPointerCapture(e.pointerId);setFollowing(false);held.add(button.dataset.move);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>held.delete(button.dataset.move));
    button.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();held.add(button.dataset.move);setFollowing(false);}});
    button.addEventListener('keyup',()=>held.delete(button.dataset.move));button.addEventListener('blur',()=>held.delete(button.dataset.move));
  });
  document.addEventListener('keydown',e=>{
    if(!active)return;
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.target.matches('input,select')||busy)return;
    if(e.target.matches('button')&&e.key===' ')return;
    const key=e.key.length===1?e.key.toLowerCase():e.key;
    if(key===' '){e.preventDefault();pause();return;}
    if(['w','a','s','d','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)){e.preventDefault();keys.add(key);}
  });
  document.addEventListener('keyup',e=>keys.delete(e.key.length===1?e.key.toLowerCase():e.key));
  window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  for(const id of ['explore-panel-toggle','route-toggle','brand-home','home-button','search-focus'])$(id).addEventListener('click',()=>close({restorePanels:false}),true);
  routeChanged();return {get active(){return active;},get position(){return position;},enter,close,routeChanged};
}
