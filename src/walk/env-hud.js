import { createHud, createHelmetProjection } from './visor/hud.js';
import './visor/theme.css';
import { createTelemetry } from './visor/telemetry.js';
import { routeState, scanTerrain } from './visor/analysis.js';
import { createLandingMap, measuredLandingField, routeForLanding } from './env-hud-data.js';

export function connectWalkHud({THREE,root,scene,landing,walkBox,start,referenceRoute,actions}) {
  const map=createLandingMap(landing.def.imagery.overview.bounds,start);
  const field=measuredLandingField(landing.raster,map,landing.bounds);
  const fallback=routeForLanding(referenceRoute,map,walkBox);
  let active=fallback,lastState={mode:'waiting'},lastUpdate=-Infinity;
  let projection,previewProjection=false,display='hidden',routeNote='';
  const rig=new THREE.Group();scene.add(rig);
  const toolkit={CanvasTexture:THREE.CanvasTexture,SRGBColorSpace:THREE.SRGBColorSpace,LinearFilter:THREE.LinearFilter,
    BufferGeometry:THREE.BufferGeometry,BufferAttribute:THREE.BufferAttribute,MeshBasicMaterial:THREE.MeshBasicMaterial,Mesh:THREE.Mesh};

  const hud=createHud(root,{layout:'helmet',helmetOnly:true,rememberFit:true,projectionPreview:true,
    renderPanel(name,body,{setTitle}){
      const button=(label,action)=>`<button data-action="${action}" type="button">${label}</button>`;
      const panel=(label,id)=>`<button data-panel="${id}" type="button">${label}</button>`;
      if(name==='helmet-tools'){
        body.innerHTML='<div class="helmet-menu-grid">'+panel('Route','route')+panel('Terrain','hazards')+panel('Display','data')+'</div>';
        if(lastState.mode==='preview')body.innerHTML+=button('Walk settings','walk-menu');
        else if(display==='dom')body.innerHTML+=button('Exit AR','walk-exit');
        return true;
      }
      if(name==='route'){
        const target=document.createElement('p');target.textContent=active?`${active.label} · ${active.dest.name}`:'No route loaded';body.append(target);
        if(routeNote){const note=document.createElement('p');note.textContent=routeNote;body.append(note);}
        if(active)body.insertAdjacentHTML('beforeend','<p>Planned by MartisDux on a 4 m slope grid from the HiRISE elevation model. A planning aid, not safety-certified.</p><p>The ground trail runs straight from you to the route, then along it. That first straight leg is not slope-checked.</p>');
        body.insertAdjacentHTML('beforeend',button(actions.trailOn()?'Hide trail':'Show trail','walk-trail'));
        if(lastState.mode==='preview')body.insertAdjacentHTML('beforeend',button('Face route','walk-face')+button(active&&active!==fallback?'Return to route start':'Return to landing site','walk-reset'));
        if(active!==fallback||routeNote)body.insertAdjacentHTML('beforeend',button('Use Jezero reference route','walk-reference'));
        return true;
      }
      if(name==='hazards'){
        setTitle('Terrain and coverage');
        body.innerHTML='<p>Slopes use the HiRISE elevation model (about 1 m grid) at true scale. The scan samples three lines up to 80 m ahead.</p><div class="legend"><span><i class="caution"></i>10–15° / caution</span><span><i class="steep"></i>15°+ / steep</span></div><p>10° and 15° are demo thresholds chosen for this simulation, not a mission standard.</p><p>Radiation, dust, rocks, and soil strength are unknown.</p><small class="panel-note">Simulation guidance only.</small>';
        return true;
      }
      if(name==='data'){
        setTitle('Display');
        body.innerHTML=button(actions.reliefOn()?'Relief ×2 · switch to true scale':'True scale · switch to relief ×2','walk-relief')+button(actions.detailOn()?'Hide illustrative detail':'Show illustrative detail','walk-detail');
        if(display==='dom'&&lastState.mode!=='preview')body.insertAdjacentHTML('beforeend',button(actions.skyOn()?'Show room above horizon':'Show Mars sky','walk-sky'));
        if(lastState.mode==='preview'){
          const now=actions.speed();
          body.insertAdjacentHTML('beforeend','<p class="speed-title">Preview speed <span>simulation control, not an astronaut speed</span></p><div class="speed-row">'+[1,5,10,20].map(v=>`<button data-action="walk-speed" data-speed="${v}" aria-pressed="${v===now}" type="button">${v}×</button>`).join('')+`<label>Custom <input data-speed-input type="number" min="0.25" max="40" step="0.25" value="${now}" aria-label="Custom preview speed multiplier">×</label></div>`);
        }
        return true;
      }
      return false;
    },
    onAction(name,data){
      if(name==='helmet-projection'){previewProjection=data.enabled;setDisplay(previewProjection?'preview-mesh':'preview');return;}
      if(name==='helmet-profile'){projection?.setProfile(data.profile);projection?.update(lastState);return;}
      if(name==='walk-reference'){routeNote='';useRoute(fallback);actions.routeOrigin(start);hud.closePanel();return;}
      if(name==='walk-face'&&active){
        const pos=lastState.position||map.toMap(start),s=routeState(active.route,pos,lastState.heading||0);
        actions.face((lastState.heading||0)+s.turnToRoute);
      }else if(name==='walk-speed'){}
      else if(name.startsWith('walk-'))actions.perform(name);
      if(name.startsWith('walk-'))hud.closePanel();
    }
  });
  function useRoute(value){
    active=value;
    const base=map.toMap(start);
    hud.setData({grid:{width:map.width,depth:map.depth},base,dest:active?.dest||base},landing.overview.image,active?.route.points||[]);
    actions.drawTrail(active?.points||[]);
    lastUpdate=-Infinity;
  }
  function ensureProjection(fov){
    projection?.dispose();
    const surface=fov||{horizontalFov:56,verticalFov:36,distance:1.5,curvature:1};
    projection=createHelmetProjection(toolkit,{profile:hud.getHelmetProfile(),surface,viewportWidth:fov?innerWidth:1280,viewportHeight:fov?innerHeight:800,resolution:1536});
    rig.add(projection.mesh);projection.update(lastState);
  }
  function setDisplay(value){
    display=value;
    root.hidden=!['preview','preview-mesh','dom'].includes(display);
    rig.visible=display==='preview-mesh'||display==='xr-mesh';
    hud.setOverlay(display==='dom');hud.closePanel();
    if(display==='preview-mesh')ensureProjection(actions.cameraFov());
    if(display==='xr-mesh')ensureProjection();
    if(!rig.visible){projection?.dispose();projection=null;}
    lastUpdate=-Infinity;
  }
  let lo=Infinity,hi=-Infinity;for(const h of landing.raster.h){if(h<lo)lo=h;if(h>hi)hi=h;}
  const telemetry=createTelemetry(root,{field,start:map.toMap(start),range:{min:lo,max:hi}});
  root.addEventListener('click',e=>{const b=e.target.closest('[data-action="walk-speed"]');if(b)actions.setSpeed(Number(b.dataset.speed));});
  root.addEventListener('change',e=>{if(e.target.matches('[data-speed-input]'))actions.setSpeed(Number(e.target.value));});
  let compact=false,trailAt=null;
  function setCompact(value){compact=Boolean(value);root.classList.toggle('compact',compact);const b=root.querySelector('[data-hud="compact"]');if(b){b.setAttribute('aria-pressed',String(compact));b.textContent=compact?'Full':'Compact';}if(compact)hud.closePanel();}
  root.addEventListener('click',e=>{const b=e.target.closest('[data-hud]');if(!b)return;if(b.dataset.hud==='compact')setCompact(!compact);else actions.perform('walk-hide');});
  function update({location,heading,mode,pose,now,scene,speed}){
    if(display==='hidden')return;
    if(scene&&root.dataset.scene!==scene)root.dataset.scene=scene;
    if(projection){
      rig.visible=Boolean(pose);
      if(pose){rig.position.copy(pose.position);rig.quaternion.copy(pose.orientation);}
    }
    const tracked=location&&Number.isFinite(heading);
    if(now-lastUpdate<100&&(lastState.mode==='stale')===!tracked)return;
    lastUpdate=now;
    if(!tracked)lastState={mode:'stale',hazard:{level:'unknown'}};
    else{
      const position={...location,...map.toMap(location)};
      lastState={mode,heading,position,hazard:scanTerrain(field,position,heading),
        route:routeState(active?.route,position,heading),destination:active?.dest.name};
    }
    if(tracked&&active&&actions.trailOn()){
      const pos=lastState.position;
      if(!trailAt||Math.hypot(pos.x-trailAt.x,pos.z-trailAt.z)>3&&now-trailAt.now>400){
        trailAt={x:pos.x,z:pos.z,now};
        const near=active.route.project(pos.x,pos.z);let i=1;
        while(i<active.route.cum.length-1&&active.route.cum[i]<=near.along)i++;
        actions.drawTrail([{lat:pos.lat,lon:pos.lon},map.toGeo(near.x,near.z),...active.points.slice(i)],false);
      }
    }else trailAt=null;
    if(!root.hidden){hud.update(lastState);telemetry.update(lastState,{now,speed,route:active?.route,relief:actions.reliefOn()});}
    projection?.update(lastState);
  }
  function setRoute(value){
    const route=routeForLanding(value,map,walkBox);
    routeNote=route?'':'Selected route is outside the walk area. Showing the Jezero reference route.';
    useRoute(route||fallback);actions.routeOrigin(route?.origin||start);return Boolean(route);
  }
  function guide(location,ahead){
    if(!active)return null;
    const p=map.toMap(location),near=active.route.project(p.x,p.z),t=active.route.at(near.along+ahead);
    return {along:near.along,length:active.route.length,off:near.off,target:map.toGeo(t.x,t.z)};
  }
  useRoute(fallback);setDisplay('hidden');
  return {setDisplay,setRoute,update,guide,setCompact,isCompact:()=>compact,closePanel:hud.closePanel,
    previewMode:()=>previewProjection?'preview-mesh':'preview',resize(){if(display==='preview-mesh')ensureProjection(actions.cameraFov());}};
}
