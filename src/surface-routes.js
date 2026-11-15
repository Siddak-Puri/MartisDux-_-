import {
  Cartesian2, Cartesian3, Cartographic, Color, ArcType, HorizontalOrigin, VerticalOrigin,
  PolylineOutlineMaterialProperty, PolylineDashMaterialProperty, ScreenSpaceEventHandler, ScreenSpaceEventType, HeightReference, CallbackProperty,
} from 'cesium';
import { MARS_RADIUS, PLACES, parseCoordinates } from './data.js';
import { surfaceRoute, formatRouteDistance } from './route-geometry.js';
import { findSafePath, routeProfile, SLOPE_CLASSES, DEFAULT_MAX_WALK_SLOPE } from './hazards.js';
import { trackOf, pointOnTrack } from './journey-geometry.js';
import { createProfileChart } from './profile-chart.js';
import { distanceBetween, bearingTo } from './surface-navigation.js';

const $ = id => document.getElementById(id);

function showDistance(metres) {
  const el = $('route-distance');
  if (metres == null) { el.textContent = '—'; return; }
  el.replaceChildren(...formatRouteDistance(metres).split(/([.,])/).map(part => {
    if (part !== '.' && part !== ',') return document.createTextNode(part);
    const dot = document.createElement('span'); dot.className = 'route-dot'; dot.textContent = part; return dot;
  }));
  el.setAttribute('aria-label', formatRouteDistance(metres));
}
const coordinates = p => `${Math.abs(p.lat).toFixed(3)}° ${p.lat<0 ? 'S' : 'N'}, ${Math.abs(p.lon).toFixed(3)}° ${p.lon<0 ? 'W' : 'E'}`;
const placeLine = p => p.name ? p.name : coordinates(p);
const inputName = p => p.name || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
const smallScreen = () => innerWidth < 761;

export function createSurfaceRoutes({ viewer, mars, stopRotation, setPlacesCollapsed, reducedMotion, minimumHeightAt, onOpen, onChange, hazards,
  planFine, cancelFine=()=>{}, groundHeightAt=()=>0, onMapView=()=>{} }) {
  let start=null, destination=null, route=null, picking=null, opened=false, routeMode='safe', analysis=null, hazardNote='';
  let drag=null, ignoreClickUntil=0, travel=0;
  const panel=$('route-panel'), input=$('route-destination'), results=$('route-results');
  const controller=viewer.scene.screenSpaceCameraController;
  const pinImage=(letter,color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48"><path d="M18 46S2 27 2 18a16 16 0 1 1 32 0c0 9-16 28-16 28Z" fill="${color}" stroke="#120b07" stroke-width="2"/><circle cx="18" cy="18" r="11" fill="#120b07"/><text x="18" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="${color}">${letter}</text></svg>`)}`;
  const nearCamera=new CallbackProperty(()=>viewer.camera.positionCartographic.height<100000?Infinity:0,false);
  const makePin=(id,letter,color) => viewer.entities.add({
    id:`route-${id}`, show:false,
    position:Cartesian3.fromDegrees(0,0,10,mars),
    billboard:{ heightReference:HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance:nearCamera, image:pinImage(letter,color), width:30, height:40, verticalOrigin:VerticalOrigin.BOTTOM },
    label:{ heightReference:HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance:nearCamera, text:'', font:'12px "Instrument Sans Variable"', fillColor:Color.fromCssColorString('#fef3e2'),
      showBackground:true, backgroundColor:Color.fromCssColorString('#120b07e6'), backgroundPadding:new Cartesian2(8,5),
      horizontalOrigin:HorizontalOrigin.LEFT, verticalOrigin:VerticalOrigin.CENTER, pixelOffset:new Cartesian2(20,-28) },
  });
  const pins={ start:makePin('start','A','#ff9c4c'), destination:makePin('destination','B','#fef3e2') };
  const trail=viewer.entities.add({ id:'route-trail', show:false, polyline:{
    positions:[], width:8, arcType:ArcType.GEODESIC, clampToGround:true, zIndex:10,
    material:new PolylineOutlineMaterialProperty({ color:Color.fromCssColorString('#ff9c4c'), outlineColor:Color.fromCssColorString('#28170c'), outlineWidth:2 }),
  }});

  const ghost=viewer.entities.add({ id:'route-direct-ghost', show:false, polyline:{
    positions:[], width:3, arcType:ArcType.GEODESIC, clampToGround:true, zIndex:9,
    material:new PolylineDashMaterialProperty({ color:Color.fromCssColorString('#ff5a3c').withAlpha(.85), gapColor:Color.TRANSPARENT, dashLength:14 }),
  }});

  let planToken=0, planning=false, lastDirect=null;
  const profileChart=createProfileChart($('route-profile'));
  async function plan(direct) {
    const token=++planToken;
    analysis=null;hazardNote='';planning=Boolean(hazards);
    if (!hazards) return;
    let a;
    try {a=await hazards.analysisFor(start,destination);}
    catch (e) {if(token===planToken){planning=false;hazardNote=e.message;draw();}return;}
    if (token!==planToken) return;
    planning=false;
    const s=a.grid;
    analysis={direct:routeProfile(s,direct.points),grid:s,label:a.label,local:a.local};
    if (routeMode==='safe') {
      let points=null, fine=false, fineNote='';
      if (planFine && a.local) {
        planning=true;draw();
        try {points=(await planFine({...start},{...destination})).points;fine=true;}
        catch (e) {fineNote=e.message;}
        if (token!==planToken) return;
        planning=false;
      }
      try {
        points??=findSafePath(s,start,destination);
        const track=trackOf(points),midpoint=pointOnTrack(track,track.total/2);
        analysis.safe=routeProfile(s,points);
        if (!fine && fineNote) hazardNote=`1 m check: ${fineNote.replace(/ Move the pins.*$/,'')} Showing the ${DEFAULT_MAX_WALK_SLOPE}° slope-grid route instead.`;
        const span=2*Math.max(...points.map(p=>distanceBetween(midpoint,p)));
        route={distance:track.total,points,midpoint,span,safe:true,fine};
      } catch (e) {hazardNote=e.message;}
    }
    draw();
  }
  const pct=(part,total)=>total?Math.round(100*part/total):0;
  function renderHazards() {
    const shown=route?.safe?analysis?.safe:analysis?.direct;
    $('route-distance-label').textContent=route?.fine?'SAFEST ROUTE · CHECKED EVERY METRE':route?.safe?'SAFEST ROUTE':'STRAIGHT LINE';
    $('route-hazard').hidden=!shown;
    profileChart.render(shown);
    const note=planning?'Checking the ground along your route…':hazardNote;
    $('route-hazard-note').textContent=note;$('route-hazard-note').hidden=!note;
    $('route-footer-note').textContent=route?.fine?'Checked on 1 m HiRISE elevation: every metre under 15°, no pits deeper than 5 m. Rocks under 1 m are not visible from orbit.':route?.safe?`Avoids slopes over ${DEFAULT_MAX_WALK_SLOPE}° using the ${analysis.label}. Small rocks and craters are not visible at this scale.`:analysis?`Straight line. Slopes from the ${analysis.label}.`:'Straight line. Slopes are not avoided.';
    if (!shown) return;
    const mapped=Math.max(1,shown.distance-shown.unmapped);
    $('route-hazard-bar').replaceChildren(...SLOPE_CLASSES.map(c=>{
      const span=document.createElement('span');span.style.flexGrow=String(shown.classes[c.id]);
      span.className=`hazard-${c.id}`;span.title=`${c.label}: ${formatRouteDistance(shown.classes[c.id])}`;return span;
    }));
    $('route-max-slope').textContent=`${shown.maxSlope.toFixed(0)}°`;
    $('route-max-slope').dataset.level=SLOPE_CLASSES.find(c=>shown.maxSlope<c.max)?.id||'nogo';
    const height=m=>m>=1000?`${(m/1000).toFixed(1)} km`:`${Math.round(m)} m`;
    $('route-ascent').textContent=`+${height(shown.ascent)}`;
    $('route-descent').textContent=`−${height(shown.descent)}`;
    $('route-easy').textContent=`${pct(shown.classes.easy,mapped)}%`;
    const d=analysis.direct, extra=formatRouteDistance(Math.max(0,(route?.distance??0)-d.distance));
    $('route-compare').textContent=route?.safe
      ? (d.maxSlope>DEFAULT_MAX_WALK_SLOPE
        ? `A straight line would hit ${d.maxSlope.toFixed(0)}° slopes. This route is ${extra} longer and avoids them.`
        : `${extra} longer than a straight line, on gentler ground.`)
      : (d.maxSlope>DEFAULT_MAX_WALK_SLOPE ? `Warning: ${d.maxSlope.toFixed(0)}° slopes on this line. Use Safest walk.` : '');
    $('route-compare').hidden=!$('route-compare').textContent;
  }
  function setMode(next) {
    routeMode=next;
    document.querySelectorAll('[data-route-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.routeMode===next)));
    update();
  }

  function error(message='') {
    $('route-error').textContent=message;$('route-error').hidden=!message;
    input.setAttribute('aria-invalid',String(Boolean(message)));
  }
  function hideResults() { results.hidden=true;input.setAttribute('aria-expanded','false'); }
  function cancelPick() {
    picking=null;delete viewer.container.dataset.picking;
    $('route-pick-banner').hidden=true;
    for (const id of ['start','destination']) $(`route-pick-${id}`).setAttribute('aria-pressed','false');
  }
  function close() {
    opened=false;panel.hidden=true;cancelPick();hideResults();
    $('route-toggle').classList.remove('is-active');$('route-toggle').setAttribute('aria-expanded','false');
  }
  function open() {
    onOpen?.();
    cancelPick();
    setPlacesCollapsed(true);opened=true;panel.hidden=false;
    $('route-toggle').classList.add('is-active');$('route-toggle').setAttribute('aria-expanded','true');
  }
  function updatePin(kind,p) {
    const pin=pins[kind];pin.show=Boolean(p);
    if (!p) return;
    pin.position=Cartesian3.fromDegrees(p.lon,p.lat,10,mars);
    pin.label.text=kind==='start' ? `A · ${p.name || 'Start'}` : `B · ${p.name || 'Destination'}`;
  }
  function update({ draw: drawNow=true }={}) {
    route=null;lastDirect=null;travel=0;cancelFine();error();
    if (start && destination) {
      try {lastDirect=surfaceRoute(start,destination);route=lastDirect;} catch (e) {error(e.message);}
    }
    updatePin('start',start);updatePin('destination',destination);
    $('route-start-coordinate').textContent=start ? placeLine(start) : 'Not set';
    if (document.activeElement!==$('route-origin')) $('route-origin').value=start ? inputName(start) : '';
    $('route-destination-coordinate').textContent=destination ? placeLine(destination) : 'Not set';
    $('route-pick-start').textContent=start ? 'Change' : 'Pick on map';
    $('route-pick-destination').textContent=destination ? 'Change' : 'Pick on map';
    $('route-submit').disabled=!start;$('route-clear').disabled=!start && !destination;
    $('route-instruction').textContent=route ? 'Drag a pin on the map to change the route.' : start ? 'Now pick where you want to go.' : 'Pick where you start.';
    if (drawNow) {
      if (route) plan(lastDirect).catch(e=>console.warn('[MartisDux] Route planning failed.',e));else {++planToken;planning=false;analysis=null;hazardNote='';}
      draw();
    } else {
      ++planToken;planning=false;ghost.show=false;
      showDistance(route ? route.distance : null);
      onChange?.();viewer.scene.requestRender();
    }
  }
  function draw() {
    showDistance(route ? route.distance : null);
    $('route-summary').hidden=!route;$('route-fit').disabled=!route;
    drawTrail();
    ghost.show=Boolean(route?.safe);
    if (route?.safe) ghost.polyline.positions=lastDirect.points.map(p=>Cartesian3.fromDegrees(p.lon,p.lat,0,mars));
    renderHazards();
    onChange?.();
    document.body.dataset.route=route ? (planning ? 'planning' : 'ready') : start ? 'start-set' : 'empty';
    viewer.scene.requestRender();
  }
  function drawTrail() {
    trail.show=Boolean(route);if(!route)return;
    const local=route.distance<6000;
    trail.polyline.clampToGround=!local;trail.polyline.arcType=local?ArcType.NONE:ArcType.GEODESIC;trail.polyline.zIndex=local?undefined:10;
    if(!local){trail.polyline.positions=route.points.map(p=>Cartesian3.fromDegrees(p.lon,p.lat,0,mars));return;}
    const points=[];
    for(let i=0;i<route.points.length-1;i++){
      const a=route.points[i],b=route.points[i+1],count=Math.max(1,Math.ceil(distanceBetween(a,b)/3));
      for(let k=0;k<count;k++)points.push({lat:a.lat+(b.lat-a.lat)*k/count,lon:a.lon+(b.lon-a.lon)*k/count});
    }
    points.push(route.points.at(-1));
    trail.polyline.positions=points.map(p=>{
      const rendered=viewer.scene.globe.getHeight(Cartographic.fromDegrees(p.lon,p.lat));
      return Cartesian3.fromDegrees(p.lon,p.lat,Math.max(groundHeightAt(p),Number.isFinite(rendered)?rendered:-Infinity)+1.5,mars);
    });
  }
  let redrawTimer;
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(count=>{if(count===0&&route?.distance<6000){clearTimeout(redrawTimer);redrawTimer=setTimeout(()=>{drawTrail();viewer.scene.requestRender();},150);}});
  function travelTo(delta){
    if(!route)return null;travel=Math.max(0,Math.min(route.distance,travel+delta));
    const track=trackOf(route.points),point=pointOnTrack(track,travel),ahead=pointOnTrack(track,Math.min(track.total,travel+5));
    $('route-progress').textContent=`${formatRouteDistance(Math.max(0,route.distance-travel))} left`;
    return {point,heading:distanceBetween(point,ahead)>.1?bearingTo(point,ahead):bearingTo(route.points[0],route.points.at(-1))};
  }
  function fit() {
    if (!route) return;
    cancelPick();stopRotation();onMapView();viewer.camera.cancelFlight();
    const fovy=viewer.camera.frustum.fovy;
    const aspect=viewer.canvas.clientWidth/viewer.canvas.clientHeight;
    const halfFov=Math.min(fovy/2,Math.atan(Math.tan(fovy/2)*aspect));
    const height=Math.min(MARS_RADIUS*19,Math.max(minimumHeightAt(route.midpoint)*1.2,(route.span??route.distance)/(2*Math.tan(halfFov*.70))));
    const settings={ destination:Cartesian3.fromDegrees(route.midpoint.lon,route.midpoint.lat,height+groundHeightAt(route.midpoint),mars), orientation:{heading:0,pitch:-Math.PI/2,roll:0} };
    if (reducedMotion) viewer.camera.setView(settings);else viewer.camera.flyTo({...settings,duration:1.6});
    if (smallScreen()) {panel.hidden=true;opened=false;$('route-toggle').setAttribute('aria-expanded','false');}
    viewer.scene.requestRender();
  }
  function setPoint(kind,p,{ frame=true }={}) {
    if (kind==='start') start=p;else {destination=p;input.value=inputName(p);}
    cancelPick();hideResults();update();open();
    if (route && frame) fit();
  }
  function surfacePoint(position) {
    const ray=viewer.camera.getPickRay(position);
    const point=(ray&&viewer.scene.globe.pick(ray,viewer.scene))||viewer.camera.pickEllipsoid(position,mars);
    if (!point) return null;
    const p=mars.cartesianToCartographic(point);
    return {lat:p.latitude*180/Math.PI,lon:p.longitude*180/Math.PI};
  }
  function arm(kind) {
    stopRotation();viewer.camera.cancelFlight();cancelPick();picking=kind;error();hideResults();
    viewer.container.dataset.picking=kind;
    $(`route-pick-${kind}`).setAttribute('aria-pressed','true');
    $('route-pick-message').textContent=kind==='start' ? 'Click the map where you start' : 'Click the map where you want to go';
    $('route-pick-banner').hidden=false;
    if (smallScreen()) {panel.hidden=true;opened=false;$('route-toggle').setAttribute('aria-expanded','false');}
    viewer.canvas.focus({preventScroll:true});
  }
  function candidates() {
    const query=input.value.trim(), point=parseCoordinates(query);
    if (point) return [{...point,name:query,type:'Use these Mars coordinates'}];
    return PLACES.filter(p=>!query || `${p.name} ${p.type}`.toLowerCase().includes(query.toLowerCase()));
  }
  function search() {
    results.replaceChildren();
    for (const p of candidates()) {
      const button=document.createElement('button');button.type='button';
      const title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent=p.name;detail.textContent=p.type;button.append(title,detail);
      button.addEventListener('click',()=>setPoint('destination',p));results.append(button);
    }
    if (!results.children.length) {
      const text=document.createElement('p');text.textContent='No match. Try Jezero or Gale, or pick on the map.';results.append(text);
    }
    results.hidden=false;input.setAttribute('aria-expanded','true');
  }

  $('route-start-form').addEventListener('submit',event=>{
    event.preventDefault();const query=$('route-origin').value.trim();
    const p=parseCoordinates(query)||PLACES.find(p=>p.name.toLowerCase()===query.toLowerCase());
    if(p)setPoint('start',{lat:p.lat,lon:p.lon,name:p.name||query});else error('Place not found. Try Jezero, or pick on the map.');
  });
  $('route-toggle').addEventListener('click',()=>{if(opened)close();else {open();$('route-pick-start').focus({preventScroll:true});}});
  $('route-open').addEventListener('click',()=>{open();$('route-pick-start').focus({preventScroll:true});});
  $('route-close').addEventListener('click',()=>{close();$('route-toggle').focus();});
  $('route-pick-start').addEventListener('click',()=>arm('start'));
  $('route-pick-destination').addEventListener('click',()=>arm('destination'));
  $('route-cancel-pick').addEventListener('click',()=>{cancelPick();open();});
  $('route-use-center').addEventListener('click',()=>{
    const p=surfacePoint(new Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2));
    if (p) setPoint('start',p);else error('Move the map over Mars and try again.');
  });
  $('route-form').addEventListener('submit',event=>{
    event.preventDefault();
    const matches=candidates();
    const exact=matches.find(p=>p.name.toLowerCase()===input.value.trim().toLowerCase());
    const point=exact || (matches.length===1 && input.value.trim() ? matches[0] : null);
    if (!point) {search();error('Pick one of the places listed, or pick on the map.');return;}
    setPoint('destination',point);
  });
  input.addEventListener('focus',search);
  input.addEventListener('input',()=>{
    if (destination && input.value!==inputName(destination)) {destination=null;update();}
    error();search();
  });
  input.addEventListener('keydown',event=>{
    if (event.key==='ArrowDown') {event.preventDefault();results.querySelector('button')?.focus();}
  });
  document.addEventListener('click',event=>{if(!event.target.closest('.route-destination-search'))hideResults();});
  $('route-fit').addEventListener('click',fit);
  document.querySelectorAll('[data-route-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.routeMode)));
  $('route-clear').addEventListener('click',()=>{cancelPick();start=null;destination=null;input.value='';$('route-origin').value='';hideResults();update();});
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape') {const wasPicking=Boolean(picking);cancelPick();hideResults();if(wasPicking)open();if(drag)finishDrag();}
  });

  const handler=new ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(event=>{
    if (picking || document.body.dataset.journey) return;
    const picked=viewer.scene.pick(event.position)?.id;
    const kind=Object.keys(pins).find(key=>pins[key]===picked);
    if (!kind) return;
    stopRotation();viewer.camera.cancelFlight();
    drag={kind,previousInputs:controller.enableInputs};controller.enableInputs=false;
    viewer.container.dataset.dragging='true';
  },ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(event=>{
    if (!drag) return;
    const p=surfacePoint(event.endPosition);if(!p)return;
    if (drag.kind==='start') start=p;else {destination=p;input.value=inputName(p);}
    trail.show=false;update({draw:false});
    $('route-instruction').textContent='Let go to update the route.';
  },ScreenSpaceEventType.MOUSE_MOVE);
  function finishDrag() {
    if (!drag) return;
    controller.enableInputs=drag.previousInputs;ignoreClickUntil=performance.now()+300;
    drag=null;delete viewer.container.dataset.dragging;update();
  }
  handler.setInputAction(finishDrag,ScreenSpaceEventType.LEFT_UP);
  viewer.canvas.addEventListener('pointercancel',finishDrag);
  window.addEventListener('blur',finishDrag);
  update();
  return {
    close, open, fit, arm, travelTo, refresh:()=>update(),
    restore(value,{frame=false}={}){
      routeMode=value.mode==='direct'?'direct':'safe';
      document.querySelectorAll('[data-route-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.routeMode===routeMode)));
      cancelPick();hideResults();start={...value.start};destination={...value.destination};input.value=inputName(destination);update();
      if(frame&&route)fit();
    },
    handleClick(position) {
      if (drag || performance.now()<ignoreClickUntil) return true;
      if (!picking) return Object.values(pins).includes(viewer.scene.pick(position)?.id);
      const point=surfacePoint(position);
      if (!point) {$('route-pick-message').textContent='That is off the planet. Click on Mars.';return true;}
      const kind=picking;setPoint(kind,point);
      if (kind==='start' && !destination) arm('destination');
      return true;
    },
    setRoute(a,b){routeMode='safe';document.querySelectorAll('[data-route-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.routeMode==='safe')));start=a;destination=b;input.value=inputName(b);cancelPick();hideResults();update();open();fit();},
    setDestination:p=>setPoint('destination',p),
    getState:()=>({grid:analysis?.grid ?? null,gridLabel:analysis?.label ?? '',start,destination,distance:route?.distance ?? null,points:route?.points ?? null,safe:Boolean(route?.safe),fine:Boolean(route?.fine),mode:route?.safe?'safe':'direct',planning,profile:(route?.safe?analysis?.safe:analysis?.direct) ?? null,picking}),
  };
}
