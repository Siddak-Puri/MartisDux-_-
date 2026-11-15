import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/martian-mono/wght.css';
import '@fontsource/julius-sans-one/400.css';
import './hud.css';
import './helmet.css';
import {helmetProfile} from './helmet-profile.js';
import {helmetInstrument} from './helmet-instrument.js';
export {helmetProfile,helmetReadout,helmetSurface} from './helmet-profile.js';
export {createHelmetProjection} from './helmet-projection.js';
export {Heightfield,Route,bearing,turn,toLatLon} from './geo.js';
export {scanTerrain,routeState,validatePose} from './analysis.js';
const shapes={map:'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zm6-3v15m6-12v15',route:'M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12-12a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 12V8a3 3 0 0 1 3-3h3m6 7v5a3 3 0 0 1-3 3h-3',hazards:'M12 3 2 21h20L12 3zm0 6v5m0 3v1',sites:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0zm-8-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',software:'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7',data:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 7v7m0-11v1',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',layers:'m12 3 10 6-10 6L2 9l10-6zm-10 12 10 6 10-6',arrow:'m12 3 8 17-8-4-8 4 8-17',play:'m8 4 13 8-13 8V4',pause:'M8 4v16M16 4v16',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6'};
export const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${shapes[name]||shapes.data}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const dist=n=>Number.isFinite(n)?n>=1000?`${(n/1000).toFixed(2)} km`:`${Math.round(n)} m`:'—';
const num=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
export function createHud(root,{onAction=()=>{},dataBase=null,layout='desktop',profile,rememberFit=false,projectionPreview=false,helmetOnly=false,renderPanel=null}={}){
 root.classList.add('md-visor');root.removeAttribute('aria-hidden');
 root.innerHTML=`<div class="vignette"></div>
 <div class="helmet-fit-window" aria-label="Helmet display" hidden>
  <div class="helmet-guide" aria-hidden="true"></div>
  <div class="helmet-ident"><strong>MartisDux</strong><span>Jezero</span></div>
  <div class="helmet-mode"><i aria-hidden="true"></i><span data-f="helmet-mode">Simulation</span></div>
  <div class="helmet-bearing"><span class="helmet-label">Heading</span><strong data-f="helmet-heading">—</strong><svg class="helmet-tape" viewBox="0 0 240 26" aria-hidden="true"><g class="helmet-ticks"></g><path class="helmet-index" d="m116 25 4-5 4 5"/></svg></div>
  <div class="helmet-alert" data-level="unknown"><span class="helmet-alert-icon">${icon('hazards')}</span><div><strong data-f="helmet-warning" aria-live="polite">Terrain unknown</strong><span data-f="helmet-detail"></span></div></div>
  <div class="helmet-aim" aria-hidden="true"><svg viewBox="0 0 240 120"><path class="aim-frame" d="M62 22h22l10-10h52l10 10h22M62 98h22l10 10h52l10-10h22"/><path class="aim-arc" d="M74 34a52 52 0 0 0 0 52M166 34a52 52 0 0 1 0 52"/><path class="aim-side" d="M8 8a120 120 0 0 0 0 104M232 8a120 120 0 0 1 0 104"/><circle class="aim-dot" cx="120" cy="60" r="2"/></svg></div>
  <div class="helmet-route"><span class="helmet-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20V4m-7 7 7-7 7 7"/></svg></span><div><span class="helmet-label" data-f="helmet-guidance">No route</span><div class="helmet-route-value"><strong data-f="helmet-distance">—</strong><span class="helmet-destination" data-f="helmet-destination">—</span></div></div></div>
  <div class="helmet-radiation">Radiation <span>Unknown</span></div>
  <nav class="helmet-controls" aria-label="Helmet controls"><button data-action="expand-map" aria-expanded="false">Map</button><button data-panel="helmet-tools" aria-expanded="false">Tools</button><button data-panel="fit" aria-expanded="false">Fit</button><button data-hud="compact" aria-pressed="false" title="Compact HUD (H)">Compact</button><button data-hud="hide" title="Hide HUD (H)">Hide</button></nav>
 </div>
 <header class="visor-header"><div class="visor-brand"><span>MartisDux</span><small>VISOR <i>/</i> 01</small></div><div class="session-status"><i></i><span data-f="mode">SURFACE PREVIEW</span><span class="status-sep">/</span><span>JEZERO</span></div><div class="header-actions"><button data-action="quality" title="Toggle rendering quality" aria-label="Rendering quality">HD</button><button data-action="overlay" title="Transparent AR overlay" aria-pressed="false">${icon('layers')}<span>Overlay</span></button><button data-action="helmet-layout" title="Use helmet layout" aria-label="Use helmet layout">${icon('eye')}<span>Helmet</span></button><button data-action="fullscreen" title="Fullscreen" aria-label="Fullscreen">${icon('expand')}</button></div></header>
 <div class="visor-compass"><div class="compass-window" aria-hidden="true"><div class="compass-tape"></div></div><div class="compass-index"></div><strong data-f="heading">000° <span>N</span></strong></div>
 <nav class="visor-rail glass" aria-label="HUD features">${[['map','Mapper'],['route','Route'],['hazards','Hazards'],['sites','Sites'],['software','Software']].map(([id,name])=>`<button data-panel="${id}" aria-label="${name}" aria-expanded="false">${icon(id)}<span>${name}</span></button>`).join('')}<span class="rail-divider"></span><button data-panel="data" aria-label="Data sources" aria-expanded="false">${icon('data')}<span>Data</span></button></nav>
 <aside class="visor-drawer glass" hidden><div class="drawer-heading"><span data-f="paneltitle"></span><button data-action="close-panel" aria-label="Close panel">×</button></div><div class="drawer-body"></div></aside>
 <aside class="hazard-glance glass" data-level="unknown"><div class="eyebrow"><span class="scan-dot"></span>TERRAIN AHEAD <span data-f="scanrange">80 M</span></div><div class="hazard-main" aria-live="polite">${icon('hazards')}<div><strong data-f="hazard">Scanning terrain</strong><span data-f="hazarddetail">1 m elevation model</span></div></div><div class="hazard-track"><i data-f="hazardbar"></i></div><div class="hazard-foot"><span>RADIATION <b>—</b></span><span>NO SENSOR</span></div></aside>
 <div class="visor-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
 <div class="target-tag" hidden><span class="target-diamond"></span><strong data-f="targetname">Rochette</strong><small data-f="targetdist"></small></div>
 <section class="visor-map glass" aria-label="Terrain mapper"><div class="map-heading"><span><i></i> LOCAL MAPPER</span><button data-action="expand-map" aria-label="Expand mapper">${icon('expand')}</button></div><div class="map-canvas-wrap"><canvas width="600" height="440" aria-label="NASA Jezero imagery with route, heading and terrain hazards"></canvas><span class="map-north">N ↑</span><div class="map-scale">100 m<i></i></div></div><footer><span data-f="coordinates">18.44460° N / 77.45090° E</span><span class="map-source">HiRISE</span></footer></section>
 <section class="surface-readout glass"><div class="eyebrow">SURFACE TELEMETRY <i>DEM</i></div><div class="readout-row"><div><span>GRADE</span><strong data-f="slope">—</strong></div><div><span>ELEVATION</span><strong data-f="elevation">—</strong></div></div><div class="readout-footer"><span data-f="speed">0.0 m/s</span><span data-f="viewheight">EYE · 1.7 M</span></div></section>
 <section class="navigation-dock glass"><div class="navigation-summary"><div class="direction-arrow">${icon('arrow')}</div><div><span class="eyebrow" data-f="routestate">TERRAIN ROUTE</span><strong data-f="destination">Rochette</strong></div><div class="distance"><strong data-f="remaining">—</strong><span>TO WAYPOINT</span></div></div><div class="route-track"><i data-f="progress"></i></div><div class="navigation-actions"><button class="primary" data-action="walk">${icon('play')}<span>Follow route</span></button><button data-action="step">+10 m</button><select aria-label="Preview speed" data-select="speed"><option value="1">1×</option><option value="5">5×</option><option value="20">20×</option></select><button data-action="view" title="Toggle eye-level / raised terrain view">${icon('eye')}<span data-f="view">Eye</span></button></div></section>
 <footer class="visor-footer"><span class="data-status"><i></i><span data-f="datastatus">LOCAL DATA</span></span><span class="input-hint">WASD move <i>·</i> Drag to look <i>·</i> Space pause</span><span>NASA / JPL / USGS <i>·</i> DEM PREVIEW</span></footer>`;
 const $=selector=>root.querySelector(selector),f={};root.querySelectorAll('[data-f]').forEach(el=>f[el.dataset.f]=el);
 const set=(key,text)=>{if(f[key]&&f[key].textContent!==String(text))f[key].textContent=text;};
 const tape=$('.compass-tape'),card=['N','NE','E','SE','S','SW','W','NW'];
 tape.innerHTML=Array.from({length:109},(_,i)=>{const degree=(i*10)%360;return `<span class="${degree%90===0?'major':''}">${degree%90===0?card[degree/45]:degree%30===0?degree:''}</span>`;}).join('');
 let state=null,meta=null,mapImage=null,hazardImage=null,points=[],activePanel=null,hazardsVisible=true,mapExpanded=false,lastDraw=0;
 let helmet=false,guides=false,meshPreview=false,fit=helmetProfile(profile),fitStorage='martisdux.helmet.fit.v1';
 if(rememberFit&&!profile){try{const value=localStorage.getItem(fitStorage);if(value)fit=helmetProfile(JSON.parse(value));}catch{}}
 function applyFit(value,save=false){
  fit=helmetProfile(value);
  root.style.setProperty('--helmet-width',`${fit.width}%`);root.style.setProperty('--helmet-height',`${fit.height}%`);root.style.setProperty('--helmet-center',`${50+fit.offset}%`);
  root.classList.toggle('helmet-contrast',fit.contrast);
  if(save&&rememberFit){try{localStorage.setItem(fitStorage,JSON.stringify(fit));}catch{}}
  for(const input of root.querySelectorAll('[data-fit]')){
   const key=input.dataset.fit;
   if(input.type==='checkbox')input.checked=fit[key];else{input.value=fit[key];input.nextElementSibling.value=`${fit[key]}%`;}
  }
  if(save)action('helmet-profile',{profile:{...fit}});
 }
 function setHelmet(value){
  helmet=Boolean(value);root.classList.toggle('helmet',helmet);$('.helmet-fit-window').hidden=!helmet;
  if(!helmet&&meshPreview)setProjectionPreview(false);
  if(activePanel)panel(activePanel);
  if(mapExpanded)expandMap(false);
  if(state)updateHelmet(state);
 }
 function setProjectionPreview(value){
  meshPreview=Boolean(value);root.classList.toggle('helmet-mesh-preview',meshPreview);action('helmet-projection',{enabled:meshPreview});
  const b=$('[data-action="helmet-projection"]');if(b){b.setAttribute('aria-pressed',String(meshPreview));b.querySelector('span').textContent=meshPreview?'On':'Off';}
 }
 let lastTapeHeading;
 function updateHelmet(s){
  const info=helmetInstrument(s);
  set('helmet-mode',info.status);set('helmet-heading',info.headingLabel);set('helmet-warning',info.terrain);set('helmet-detail',info.terrainDetail);
  set('helmet-distance',info.remaining);set('helmet-guidance',info.guidance);set('helmet-destination',info.destination);
  const alert=$('.helmet-alert');alert.dataset.level=info.level;
  $('.helmet-mode').dataset.mode=s.mode||'preview';
  const arrow=$('.helmet-arrow');arrow.hidden=info.turn===null;arrow.style.transform=`rotate(${info.turn??0}deg)`;
  $('.helmet-route').classList.toggle('no-route',info.remaining==='—');
  const heading=Math.round(info.heading??-1);
  if(heading!==lastTapeHeading){
   lastTapeHeading=heading;
   $('.helmet-ticks').innerHTML=info.ticks.map(t=>{
    const x=Math.round(t.position*240);
    return `<path d="M${x} 15v${t.major?6:3}"/>${t.label?`<text x="${x}" y="10">${t.label}</text>`:''}`;
   }).join('');
   $('.helmet-tape').hidden=info.heading===null;
  }
 }
 function expandMap(value){
  mapExpanded=value;$('.visor-map').classList.toggle('expanded',value);
  const buttons=root.querySelectorAll('[data-action="expand-map"]');for(const b of buttons)b.setAttribute('aria-expanded',String(value));
  $('.map-heading button').setAttribute('aria-label',value?'Collapse mapper':'Expand mapper');
  if(value&&activePanel)panel(activePanel);drawMap();
 }
 const canvas=$('.map-canvas-wrap canvas'),ctx=canvas.getContext('2d');
 function action(name,payload={}){onAction(name,payload);root.dispatchEvent(new CustomEvent('martisdux:action',{detail:{action:name,...payload},bubbles:true}));}
 function panel(name){
  activePanel=activePanel===name?null:name;if(activePanel&&mapExpanded)expandMap(false);$('.visor-drawer').hidden=!activePanel;
  root.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.panel===activePanel)));
  if(!activePanel)return;
  const titles={map:'Terrain mapper',route:'Route planning',hazards:'Terrain layers',sites:'Science sites',software:'Explorer',data:'Data & display','helmet-tools':'Helmet tools',fit:'Visor fit'};set('paneltitle',titles[name]);
  const body=$('.drawer-body');body.replaceChildren();
  if(renderPanel?.(name,body,{state,icon,setTitle:title=>set('paneltitle',title)}))return;
  if(name==='helmet-tools'){
   body.innerHTML='<div class="helmet-menu-grid">'+[['route','Route'],['hazards','Hazards'],['sites','Sites'],['software','Software'],['data','Data'],...(state?.mode==='preview'?[['map','Mapper']]:[])].map(([id,label])=>`<button data-panel="${id}" aria-expanded="false">${icon(id)}<span>${label}</span></button>`).join('')+'</div>';
   if(state?.mode==='preview')body.innerHTML+='<div class="helmet-menu-grid"><button data-action="walk"><span>Follow route</span></button><button data-action="step">+10 m</button><button data-action="view">View height</button></div>';
  }
  if(name==='fit'){
   const ranges=[['width','Usable width',70,96],['height','Usable height',64,94],['offset','Vertical shift',-10,10]];
   body.innerHTML='<div class="helmet-calibration">'+ranges.map(([id,label,min,max])=>`<label><span>${label}</span><div><input type="range" min="${min}" max="${max}" step="1" data-fit="${id}" aria-label="${label}"><output></output></div></label>`).join('')+'<label class="helmet-check"><input type="checkbox" data-fit="contrast"> High contrast</label></div>'+`<button data-action="fit-guides" aria-pressed="${guides}">Fit guides <span>${guides?'On':'Off'}</span></button><button data-action="fit-reset">Reset fit</button><button data-action="fit-export">Download fit profile ↓</button><button data-action="helmet-layout">Desktop layout</button>`;
   if(helmetOnly)body.querySelector('[data-action="helmet-layout"]').remove();
   if(projectionPreview&&state?.mode==='preview'){const b=document.createElement('button');b.dataset.action='helmet-projection';b.setAttribute('aria-pressed',String(meshPreview));b.innerHTML=`Curved mesh preview <span>${meshPreview?'On':'Off'}</span>`;body.insertBefore(b,body.querySelector('[data-action="helmet-layout"]'));}
   applyFit(fit);
  }
  if(name==='map')body.innerHTML='<div class="panel-stat"><span>REGION</span><strong>Jezero crater</strong></div><div class="panel-stat"><span>FOOTPRINT</span><strong>868 × 1,272 m</strong></div><button data-action="expand-map">Expand map ↗</button><button data-action="home">Return to landing site ↤</button><button data-action="rim">Visit crater rim ↗</button>';
  if(name==='route'){
   body.innerHTML='<label>Destination<select aria-label="Route destination" data-select="destination"></select></label><button class="primary" data-action="plan">Plan from here ↗</button><button data-action="face-route">Face route ↑</button><button data-action="reset">Reset route ↤</button><button data-action="export">Export route ↓</button><div class="panel-stat"><span>SLOPE LIMIT</span><strong>15°</strong></div><small class="panel-note">Terrain screening · other hazards unknown</small>';
   const select=body.querySelector('select');for(const p of [{id:'destination',name:'Rochette'},...(meta?.stops||[])]){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.append(option);}
  }
  if(name==='hazards')body.innerHTML=`<button data-action="hazards" aria-pressed="${hazardsVisible}">Slope overlay <span>${hazardsVisible?'On':'Off'}</span></button><div class="legend"><span><i class="caution"></i>10–15° / caution</span><span><i class="steep"></i>15°+ / steep</span><span><i class="unknown"></i>Outside DEM / unknown</span></div><div class="panel-stat"><span>ROCKS / SOIL</span><strong>Unknown</strong></div><div class="panel-stat"><span>RADIATION / DUST</span><strong>No live sensor</strong></div><small class="panel-note">Demo thresholds · not operational navigation</small>`;
  if(name==='sites'){
   for(const p of [{id:'base',name:'Octavia E. Butler',detail:'Landing site'},...(meta?.stops||[])]){const b=document.createElement('button');b.dataset.action='visit';b.dataset.id=p.id;const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=p.name;small.textContent=p.detail||'Sample site';b.append(strong,small);body.append(b);}
  }
  if(name==='software')body.innerHTML=[['globe','Mars globe'],['routes','Route planner'],['photos','Rover photos'],['terrain','3D terrain'],['data','Data sources'],['saved','Saved routes']].map(([id,label])=>`<button data-action="software" data-feature="${id}">${label}<span>↗</span></button>`).join('');
  if(name==='data')body.innerHTML='<div class="panel-stat"><span>IMAGERY</span><strong>HiRISE · ~0.32 m/px</strong></div><div class="panel-stat"><span>ELEVATION</span><strong>HiRISE DTM · 1 m</strong></div><div class="panel-stat"><span>ORBITAL TEXTURE</span><strong>4K · stored locally</strong></div><button data-action="overlay">Transparent overlay ↗</button><button data-action="quality">Toggle render quality</button><button data-action="fullscreen">Fullscreen ↗</button><a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek ↗</a><a href="https://github.com/NASA-AMMOS/Landform/wiki/Links-to-Publicly-Available-Input-Data" target="_blank" rel="noopener">Terrain provenance ↗</a>';
 }
 function click(e){const b=e.target.closest('button');if(!b)return;if(b.dataset.panel){panel(b.dataset.panel);return;}const name=b.dataset.action;if(!name)return;
  if(name==='close-panel'){panel(activePanel);return;}
  if(name==='expand-map'){expandMap(!mapExpanded);return;}
  if(name==='helmet-layout'){setHelmet(!helmet);return;}
  if(name==='helmet-projection'){setProjectionPreview(!meshPreview);return;}
  if(name==='fit-reset'){applyFit({},true);return;}
  if(name==='fit-guides'){guides=!guides;root.classList.toggle('helmet-guides',guides);b.setAttribute('aria-pressed',String(guides));b.querySelector('span').textContent=guides?'On':'Off';return;}
  if(name==='fit-export'){
   const url=URL.createObjectURL(new Blob([JSON.stringify(fit,null,2)+'\n'],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='MartisDux-Helmet-Fit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  if(name==='hazards'){hazardsVisible=!hazardsVisible;action(name,{enabled:hazardsVisible});activePanel=null;panel('hazards');return;}
  const payload={...b.dataset};if(name==='plan')payload.destination=$('[data-select="destination"]')?.value||'destination';action(name,payload);
 }
 const xrSelect=e=>{if(e.target.closest('button,select,a,input'))e.preventDefault();};root.addEventListener('beforexrselect',xrSelect);
 root.addEventListener('click',click);const change=e=>{if(e.target.dataset.select)action(e.target.dataset.select,{value:e.target.value});};root.addEventListener('change',change);
 const input=e=>{const key=e.target.dataset.fit;if(key)applyFit({...fit,[key]:e.target.type==='checkbox'?e.target.checked:e.target.valueAsNumber},true);};root.addEventListener('input',input);
 const escape=e=>{if(e.key!=='Escape')return;if(activePanel)panel(activePanel);else if(mapExpanded)expandMap(false);};root.addEventListener('keydown',escape);
 function drawMap(){
  if(!meta||!mapImage)return;
  const w=canvas.width,h=canvas.height,p=state?.position||meta.base;
  const scale=mapExpanded?Math.min(w/(meta.grid.width*1.06),h/(meta.grid.depth*1.06)):w/440;
  const center=mapExpanded?{x:meta.grid.width/2,z:meta.grid.depth/2}:p;
  const X=x=>(x-center.x)*scale+w/2,Z=z=>(z-center.z)*scale+h/2;
  ctx.fillStyle='#172126';ctx.fillRect(0,0,w,h);ctx.save();ctx.globalAlpha=.82;ctx.drawImage(mapImage,X(0),Z(0),meta.grid.width*scale,meta.grid.depth*scale);ctx.restore();
  if(hazardImage&&hazardsVisible){ctx.globalAlpha=.67;ctx.drawImage(hazardImage,X(0),Z(0),meta.grid.width*scale,meta.grid.depth*scale);ctx.globalAlpha=1;}
  ctx.strokeStyle='#ffffff14';ctx.lineWidth=1;for(let i=0;i<w;i+=60){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,h);ctx.stroke();}for(let i=0;i<h;i+=60){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(w,i);ctx.stroke();}
  if(points.length){ctx.beginPath();points.forEach(([x,z],i)=>i?ctx.lineTo(X(x),Z(z)):ctx.moveTo(X(x),Z(z)));ctx.strokeStyle='#182027';ctx.lineWidth=8;ctx.stroke();ctx.strokeStyle='#e9a25a';ctx.lineWidth=4;ctx.stroke();}
  for(const site of [meta.base,meta.dest,...(meta.stops||[])]){ctx.beginPath();ctx.arc(X(site.x),Z(site.z),4,0,Math.PI*2);ctx.fillStyle='#f0b674';ctx.fill();}
  if(state?.mode!=='stale'&&state?.mode!=='waiting'){
  const px=X(p.x),pz=Z(p.z);ctx.save();ctx.globalAlpha=(state?.mode==='stale'||state?.mode==='waiting') ? 0.25 : 1;ctx.translate(px,pz);ctx.rotate((state?.heading||0)*Math.PI/180);ctx.fillStyle='#7fdcf521';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,85,-Math.PI*.67,-Math.PI*.33);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(9,10);ctx.lineTo(0,6);ctx.lineTo(-9,10);ctx.closePath();ctx.fillStyle='#8fe9ff';ctx.fill();ctx.strokeStyle='#15332d';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  }
  $('.map-scale i').style.width=`${100*scale*(canvas.clientWidth/w)}px`;
 }
 function update(s){
  if(!s)return;state=s;
  const tracked=s.mode!=='stale'&&s.mode!=='waiting';root.classList.toggle('pose-unavailable',!tracked);
  const coords=s.position;
  if(helmet){
   updateHelmet(s);
   if(mapExpanded){
    set('coordinates',tracked&&coords&&Number.isFinite(coords.lat)&&Number.isFinite(coords.lon)?`${coords.lat.toFixed(5)}° N / ${coords.lon.toFixed(5)}° E`:'POSITION —');
    if(performance.now()-lastDraw>100){drawMap();lastDraw=performance.now();}
   }
   if(activePanel==='helmet-tools'){
    const follow=$('.drawer-body [data-action="walk"]'),step=$('.drawer-body [data-action="step"]');
    const disabled=!s.route||s.mode!=='preview';
    if(follow){follow.disabled=disabled;const label=follow.querySelector('span'),next=s.route?.autoWalk?'Pause':'Follow route';if(label.textContent!==next)label.textContent=next;}if(step)step.disabled=disabled;
   }
   return;
  }
  const heading=Number.isFinite(s.heading)?((s.heading%360)+360)%360:0;
  tape.style.transform=`translateX(-${(heading+360)*2.8}px)`;
  set('heading',tracked?`${String(Math.round(heading)%360).padStart(3,'0')}° ${card[Math.round(heading/45)%8]}`:'—');
  set('mode',s.mode==='ar'?'AR LINKED':s.mode==='waiting'?'AWAITING AR POSE':s.mode==='stale'?'AR LINK LOST':'SURFACE PREVIEW');
  const haz=s.hazard||{level:Math.abs(s.slopeAhead)>=15?'steep':Math.abs(s.slopeAhead)>=10?'caution':'unknown',title:Math.abs(s.slopeAhead)>=15?'Steep terrain':Math.abs(s.slopeAhead)>=10?'Uneven approach':'Terrain not scanned',distance:5,slope:Math.abs(s.slopeAhead)};
  $('.hazard-glance').dataset.level=haz.level;set('hazard',haz.title);set('hazarddetail',haz.level==='unknown'?'Coverage / sensor unavailable':`${num(haz.slope,1)}° grade · ${dist(haz.distance)} ahead`);set('scanrange',`${Math.round(haz.distance)} M`);f.hazardbar.style.width=`${Math.min(100,Math.max(5,(haz.slope||0)/30*100))}%`;
  set('slope',tracked?`${num(s.slope,1)}°`:'—');set('elevation',tracked?`${num(s.elevation)} m`:'—');set('speed',tracked?`${num(s.speed,1)} m/s`:'—');
  set('coordinates',tracked&&coords&&Number.isFinite(coords.lat)&&Number.isFinite(coords.lon)?`${coords.lat.toFixed(5)}° N / ${coords.lon.toFixed(5)}° E`:'POSITION —');
  set('destination',s.destination||s.next?.name||'Select destination');set('remaining',tracked?dist(s.route?.remaining):'—');set('targetname',s.destination||s.next?.name||'Waypoint');set('targetdist',dist(s.next?.distance));
  f.progress.style.width=`${tracked&&s.route?.length?Math.min(100,s.route.walked/s.route.length*100):0}%`;
  $('.direction-arrow').style.transform=`rotate(${s.route?.turnToRoute||0}deg)`;
  set('routestate',!tracked?'POSITION UNAVAILABLE':!s.route?'NO ROUTE':s.route.remaining<2?'WAYPOINT REACHED':s.route.offRoute>12?'RETURN TO ROUTE':'TERRAIN ROUTE · PREVIEW');
  const walk=$('[data-action="walk"]');const running=Boolean(s.route?.autoWalk);walk.setAttribute('aria-pressed',String(running));const label=walk.querySelector('span');if(label.textContent!==(running?'Pause':'Follow route')){walk.innerHTML=icon(running?'pause':'play')+`<span>${running?'Pause':'Follow route'}</span>`;}
  walk.disabled=!s.route||s.mode==='ar'||!tracked;$('[data-action="step"]').disabled=walk.disabled;$('[data-select="speed"]').disabled=walk.disabled;
  if(s.targetScreen){const t=$('.target-tag');t.hidden=!s.targetScreen.visible;t.style.left=`${s.targetScreen.x}px`;t.style.top=`${s.targetScreen.y}px`;}else $('.target-tag').hidden=true;
  if(performance.now()-lastDraw>100){drawMap();lastDraw=performance.now();}
 }
 function setData(data,image,routePoints=data.route?.points||[],hazard=null){meta=data;mapImage=image;points=routePoints;hazardImage=hazard;drawMap();if(activePanel==='sites'||activePanel==='route'){const old=activePanel;activePanel=null;panel(old);}}
 const controller=new AbortController();
 if(dataBase)Promise.all([fetch(dataBase+'walk.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}),new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=dataBase+'terrain.jpg';})]).then(([m,image])=>setData(m,image)).catch(()=>set('datastatus','MAP UNAVAILABLE'));
 applyFit(fit);setHelmet(layout==='helmet');
 return {update,setData,setHelmet,setProjectionPreview,setHelmetProfile:applyFit,getHelmetProfile:()=>({...fit}),setStatus:text=>set('datastatus',text),setView:(label,height)=>{set('view',label);set('viewheight',`${label.toUpperCase()} · ${height} M`);},setOverlay:value=>{root.classList.toggle('overlay',value);$('[data-action="overlay"]').setAttribute('aria-pressed',String(value));},setQuality:label=>$('[data-action="quality"]').textContent=label,closePanel:()=>{if(activePanel)panel(activePanel);},destroy(){controller.abort();root.removeEventListener('beforexrselect',xrSelect);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);root.removeEventListener('keydown',escape);root.replaceChildren();root.classList.remove('md-visor','helmet','helmet-contrast','helmet-guides','helmet-mesh-preview','overlay','pose-unavailable');for(const key of ['--helmet-width','--helmet-height','--helmet-center'])root.style.removeProperty(key);}};
}
