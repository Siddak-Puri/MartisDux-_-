import * as THREE from 'three';
import { MARS_R, RAD, unit, toLatLon, eastOf, northOf } from './env-math.js';
import { TerrainLayer } from './env-terrain.js';
import { createDressing, regolithTexture } from './env-dressing.js';
import { connectWalkHud } from './env-hud.js';
import { validateRoute } from '../route-storage.js';
import { walkSpeed } from '../eva.js';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/martian-mono/wght.css';
import './env.css';

const $ = id => document.getElementById(id);
const BASE = new URL('./', location.href).href;
const EYE = 1.65, WALK = 1.4, FAST = 8;
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
$('view').append(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400000);
camera.rotation.order = 'YXZ';
const world = new THREE.Group(), stage = new THREE.Group(), planet = new THREE.Group();
world.add(stage); stage.add(planet); scene.add(world);

const SUN_AZ = 235 * RAD, SUN_EL = 15 * RAD;
const sunDir = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
const SKY = { horizon: new THREE.Color('#d7b48e'), zenith: new THREE.Color('#9c7558'), sun: new THREE.Color('#fff1dc') };
const shared = {
  sunDir: { value: sunDir }, sunColor: { value: new THREE.Color(1.0, 0.9, 0.78).multiplyScalar(1.7) },
  skyColor: { value: new THREE.Color(0.4, 0.31, 0.25) }, groundColor: { value: new THREE.Color(0.17, 0.115, 0.085) },
  fogColor: { value: SKY.horizon.clone() }, fogScale: { value: 22000 }, tintMono: { value: new THREE.Vector3(1, 1, 1) },
  detailMap: { value: regolithTexture(maxAniso) }, detailOn: { value: 1 },
  exag: { value: 2 }, h0: { value: 0 },
};
const sunLight = new THREE.DirectionalLight(shared.sunColor.value, Math.PI); sunLight.position.copy(sunDir);
scene.add(sunLight, new THREE.HemisphereLight(shared.skyColor.value, shared.groundColor.value, Math.PI));

const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthTest: false, depthWrite: false,
  uniforms: { horizon: { value: SKY.horizon }, zenith: { value: SKY.zenith }, sun: { value: SKY.sun }, sunDir: { value: sunDir } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sun; uniform vec3 sunDir; varying vec3 vDir;
    void main(){ float h = max(vDir.y, 0.0); vec3 c = mix(horizon, zenith, pow(h, 0.55));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += sun * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.12);
      if (vDir.y < 0.0) c = horizon; gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

let manifest, layers = [], landing, Q = new THREE.Quaternion(), Qinv = new THREE.Quaternion(), pivot = new THREE.Vector3();
let walkBox, dressing = null;
const me = { x: 0, z: 0, yaw: 70 * RAD, pitch: -4 * RAD, y: EYE };
const START_YAW = me.yaw;
let terrainReady=false;
let mode = 'menu', xrMode = null, skyOn = true, useDomOverlay = false, walkHud, pendingRoute;
let routePoints = [], trail = null, trailOn = false, walkOrigin;
let auto = 0, lastLook = -Infinity;
const visorOn = () => $('visor-enabled').checked;
const SPEED_KEY='martisdux.walk.speed.v1';
let speedMul=1;
try{const v=Number(localStorage.getItem(SPEED_KEY));if(v>=0.25&&v<=40)speedMul=v;}catch{}
function setSpeed(v){if(!(v>=0.25&&v<=40))return;speedMul=v;try{localStorage.setItem(SPEED_KEY,String(v));}catch{}}
$('visor-enabled').checked = !params.has('no-hud');

function orientation(p) {
  const u = new THREE.Vector3(...unit(p.lat, p.lon)), e = new THREE.Vector3(...eastOf(p.lon)), n = new THREE.Vector3(...northOf(p.lat, p.lon));
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(e, u, n.negate())).invert();
}
const tmpV = new THREE.Vector3();
function geoAt(x, z) { tmpV.set(x, 0, z).applyQuaternion(Qinv).add(pivot); return toLatLon(tmpV.toArray()); }
function localAt({lat,lon}) {
  return new THREE.Vector3(...unit(lat,lon)).multiplyScalar(MARS_R+shared.h0.value).sub(pivot).applyQuaternion(Q);
}
function drawTrail(points = routePoints) {
  routePoints=points;
  if(trail){world.remove(trail);trail.geometry.dispose();trail.material.dispose();trail=null;}
  if(points.length<2)return;
  const positions=[],indices=[];
  for(let i=1;i<points.length;i++){
    const a=localAt(points[i-1]),b=localAt(points[i]),dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    if(d<.01)continue;
    const sx=-dz/d*.16,sz=dx/d*.16;
    for(let m=0;m<d;m+=4){
      const end=Math.min(d,m+2.6),steps=Math.ceil(end-m);
      for(let j=0;j<=steps;j++){
        const t=(m+(end-m)*j/steps)/d,x=a.x+dx*t,z=a.z+dz*t,k=positions.length/3;
        for(const sign of [-1,1]){const px=x+sign*sx,pz=z+sign*sz;positions.push(px,groundY(px,pz)+.12,pz);}
        if(j)indices.push(k-2,k-1,k,k-1,k+1,k);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  const material=new THREE.MeshBasicMaterial({color:'#e7c497',side:THREE.DoubleSide,transparent:true,opacity:.74,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  trail=new THREE.Mesh(geometry,material);trail.renderOrder=1;world.add(trail);refreshTrail();
}
function refreshTrail(){if(trail)trail.visible=visorOn()&&trailOn&&mode!=='menu';}
function refreshVisor(){
  walkHud?.setDisplay(!visorOn()||mode==='menu'?'hidden':mode==='walk'?walkHud.previewMode():useDomOverlay?'dom':'xr-mesh');
  refreshTrail();
}
const dispH = h => shared.h0.value + (h - shared.h0.value) * shared.exag.value;
function groundY(x, z) {
  const { lat, lon } = geoAt(x, z), h = dispH(landing.heightAt(lat, lon));
  return tmpV.set(...unit(lat, lon)).multiplyScalar(MARS_R + h).sub(pivot).applyQuaternion(Q).y;
}
function slopeAt(x, z) {
  const g = (a, b) => landing.heightAt(...Object.values(geoAt(a, b)));
  return Math.atan(Math.hypot(g(x + 1, z) - g(x - 1, z), g(x, z + 1) - g(x, z - 1)) / 2) / RAD;
}
function imageBrightness(L) {
  const img = L.overview.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data, [w, s, e, n] = L.def.imagery.overview.bounds;
  return (x, z) => {
    const { lat, lon } = geoAt(x, z), i = Math.floor((lon - w) / (e - w) * c.width), j = Math.floor((n - lat) / (n - s) * c.height);
    return i < 0 || j < 0 || i >= c.width || j >= c.height ? 0.5 : px[(j * c.width + i) * 4] / 255;
  };
}
function inWalkArea(x, z) { const { lat, lon } = geoAt(x, z), [w, s, e, n] = walkBox; return lat > s && lat < n && lon > w && lon < e; }
function tryMove(dx, dz) {
  if (inWalkArea(me.x + dx, me.z + dz)) { me.x += dx; me.z += dz; }
  else if (inWalkArea(me.x + dx, me.z)) me.x += dx;
  else if (inWalkArea(me.x, me.z + dz)) me.z += dz;
}

const view = { tmp: new THREE.Vector3(), camera: new THREE.Vector3(), maxDist: 160000 };
function updateTerrain(cam) {
  scene.updateMatrixWorld(true);
  const eye = cam.cameras?.[0];
  view.focalPx = (eye ?? cam).projectionMatrix.elements[5] * (eye?.viewport?.w || renderer.getSize(new THREE.Vector2()).y) / 2;
  view.tolPx = xrMode || touch ? 6 : 4; view.pageSlots = 4;
  cam.getWorldPosition(view.camera);
  let budget = xrMode || touch ? 40000 : 90000;
  view.eyeH = dispH(landing.heightAt(...Object.values(geoAt(me.x, me.z)))) + EYE;
  for (const L of [...layers].reverse()) budget -= L.update(view, budget);
}

const keys = new Set();
addEventListener('keydown', e => {
  if (mode !== 'walk'||e.target.closest?.('button,input,select,textarea,a')) return;
  if(e.code==='Escape'){showMenu();return;}
  keys.add(e.code);
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyH') cycleHud();
  if (e.code === 'KeyT') { keys.delete(e.code); cycleAuto(); }
  if (e.code === 'KeyG') setDetail(!shared.detailOn.value);
  if (e.code === 'KeyV') setRelief(shared.exag.value === 1 ? 2 : 1);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const canvas = renderer.domElement;
function lock() { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { } }
document.addEventListener('pointerlockchange', () => { if(!document.pointerLockElement)keys.clear(); });
let dragging = null;
canvas.addEventListener('pointerdown', e => { if (mode === 'walk' && document.pointerLockElement !== canvas) { dragging = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event, () => { dragging = null; });
addEventListener('pointermove', e => {
  if (mode !== 'walk') return;
  let dx = 0, dy = 0;
  if (document.pointerLockElement === canvas) { dx = e.movementX; dy = e.movementY; }
  else if (dragging) { dx = e.clientX - dragging.x; dy = e.clientY - dragging.y; dragging = { x: e.clientX, y: e.clientY }; }
  const k = document.pointerLockElement === canvas ? 0.0022 : 0.005;
  if (dx || dy) lastLook = performance.now();
  me.yaw -= dx * k; me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - dy * k));
});
const hold = { fwd: 0, back: 0 };
for (const [id, dir] of [['go-fwd', 'fwd'], ['go-back', 'back'], ['xr-walk', 'fwd']]) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); hold[dir] = 1; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { hold[dir] = 0; });
}

function setDetail(on) { shared.detailOn.value = on ? 1 : 0; if (dressing) dressing.group.visible = on; $('detail').checked = on; }
$('detail').addEventListener('change', e => setDetail(e.target.checked));

function setRelief(x) {
  shared.exag.value = x; $('relief').checked = x !== 1;
  if (landing?.loaded) { layers.forEach(L => L.rebuild()); dressing?.update(me.x, me.z, true); drawTrail(); }
}
$('relief').addEventListener('change', e => setRelief(e.target.checked ? 2 : 1));

function setAuto(v, label) {
  auto = v; const b = $('auto-btn'); b.setAttribute('aria-pressed', String(v > 0)); b.querySelector('span').textContent = label || (v ? `${v}×` : 'Off');
}
function cycleAuto() { if (walkHud && mode === 'walk') setAuto({ 0: 1, 1: 5, 5: 20, 20: 0 }[auto] ?? 0); }
$('auto-btn').addEventListener('click', e => { e.stopPropagation(); cycleAuto(); });
function autoStep(dt, now) {
  const here = geoAt(me.x, me.z), g = walkHud.guide(here, 3);
  if (!g) { setAuto(0); return; }
  const t = localAt(g.target), dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { setAuto(0, g.length - g.along < 1 ? 'Arrived' : ''); return; }
  const rise = landing.heightAt(g.target.lat, g.target.lon) - landing.heightAt(here.lat, here.lon);
  const step = Math.min(d, walkSpeed(rise / d) * auto * dt);
  tryMove(dx / d * step, dz / d * step);
  if (!dragging && now - lastLook > 2500) {
    const diff = ((Math.atan2(-dx, -dz) - me.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    me.yaw += diff * Math.min(1, dt * 2.5);
  }
}
function runDemo(demo) {
  if (!walkHud.setRoute({ ...demo, demo: true })) { $('walk-route-status').textContent = 'That demo route is outside the walk area.'; return; }
  for (const b of document.querySelectorAll('[data-walk-demo]')) b.setAttribute('aria-pressed', String(b.dataset.walkDemo === demo.id));
  $('walk-route-status').textContent = `Demo walk loaded: ${demo.dest.name}.`;
  reset();
  const g = walkHud.guide(geoAt(me.x, me.z), 12), t = g && localAt(g.target);
  if (t) me.yaw = Math.atan2(-(t.x - me.x), -(t.z - me.z));
  trailOn = true; lastLook = -Infinity; startWalk(); setAuto(5);
}
function renderDemos(list) {
  if (!Array.isArray(list) || !list.length) return;
  for (const demo of list) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.walkDemo = demo.id; b.setAttribute('aria-pressed', 'false');
    const tag = document.createElement('i'), copy = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
    tag.textContent = demo.tag; title.textContent = demo.title;
    detail.textContent = `${m(demo.distance)} · about ${Math.max(1, Math.round(demo.distance / 0.9 / 60))} min at suit pace · steepest ${demo.maxSlope}° · ${demo.rock} outcrop, sampled sol ${demo.sol}`;
    copy.append(title, detail); b.append(tag, copy); b.addEventListener('click', () => runDemo(demo)); $('demo-list').append(b);
  }
  $('demo-walks').hidden = false;
}

function reset() { me.x=walkOrigin?.x??0;me.z=walkOrigin?.z??0; me.yaw = START_YAW; me.pitch = -4 * RAD; xrOffset.set(0, 0, 0); }

function showMenu() {
  setAuto(0);mode='menu';document.body.classList.remove('walking');$('menu').hidden=false;keys.clear();dragging=null;hold.fwd=hold.back=0;
  document.exitPointerLock?.();refreshVisor();
}
function startWalk() {mode='walk';document.body.classList.add('walking');$('menu').hidden=true;refreshVisor();}
$('visor-enabled').addEventListener('change',refreshVisor);
function cycleHud(){
  if(!walkHud)return;
  if(!visorOn()){$('visor-enabled').checked=true;walkHud.setCompact(false);}
  else if(!walkHud.isCompact())walkHud.setCompact(true);
  else $('visor-enabled').checked=false;
  refreshVisor();
}
for(const id of ['hud-btn','xr-hud'])$(id).addEventListener('click',e=>{e.stopPropagation();cycleHud();});
function sceneTone(){
  if(xrMode==='ar'&&!skyOn)return 'unknown';
  if(xrMode)return 'mixed';
  return me.pitch>12*RAD?'bright':me.pitch<-28*RAD?'dark':'mixed';
}
$('mouse-look').addEventListener('click',lock);
$('start').addEventListener('click', startWalk);
$('menu-btn').addEventListener('click', e => { e.stopPropagation(); document.exitPointerLock?.(); showMenu(); });
$('reset-btn').addEventListener('click', e => { e.stopPropagation(); reset(); });

const xrOffset = new THREE.Vector3();
let xrGround = null;
async function enterXR(kind) {
  if(!walkHud||mode==='xr')return;
  const session = await navigator.xr.requestSession(kind === 'ar' ? 'immersive-ar' : 'immersive-vr', {
    requiredFeatures: ['local-floor'], optionalFeatures: kind === 'ar' ? ['dom-overlay'] : [], ...(kind === 'ar' ? { domOverlay: { root: $('xr-overlay') } } : {}),
  });
  renderer.xr.setReferenceSpaceType('local-floor');
  try{await renderer.xr.setSession(session);}catch(err){await session.end().catch(()=>{});throw err;}
  session.updateRenderState({ depthNear: 0.05, depthFar: 400000 });
  keys.clear();dragging=null;hold.fwd=hold.back=0;setAuto(0);
  xrMode=kind;mode='xr';xrGround=null;xrOffset.set(me.x,0,me.z);useDomOverlay=kind==='ar'&&Boolean(session.domOverlayState?.type);
  document.body.classList.remove('walking');document.body.classList.add('in-xr');$('menu').hidden=true;
  setSky(kind==='vr');refreshVisor();
  session.addEventListener('selectstart', () => { if (!useDomOverlay) hold.fwd = 1; });
  session.addEventListener('selectend', () => { if (!useDomOverlay) hold.fwd = 0; });
  session.addEventListener('end', () => {
    xrMode = null; useDomOverlay = false; document.body.classList.remove('in-xr'); world.position.set(0, 0, 0); hold.fwd = 0;
    setSky(true); showMenu();
  });
}
function setSky(on) { skyOn = on; sky.visible = on; $('xr-sky').textContent = on ? 'Mars sky' : 'Room'; $('xr-sky').setAttribute('aria-pressed', String(on)); }
$('xr-sky').addEventListener('click', () => setSky(!skyOn));
$('xr-exit').addEventListener('click', () => renderer.xr.getSession()?.end());
$('xr-overlay').addEventListener('beforexrselect', e => {if(e.target.closest?.('button,input,select,a'))e.preventDefault();});

async function setupXR() {
  const [ar, vr] = await Promise.all(['immersive-ar', 'immersive-vr'].map(m => navigator.xr?.isSessionSupported?.(m).catch(() => false) ?? false));
  if (ar) { $('enter-ar').hidden = false; $('enter-ar').addEventListener('click', () => enterXR('ar').catch(err => note(`AR could not start: ${err.message}`))); }
  if (vr) { $('enter-vr').hidden = false; $('enter-vr').addEventListener('click', () => enterXR('vr').catch(err => note(`VR could not start: ${err.message}`))); }
  if (!ar && !vr) note(!window.isSecureContext ? 'AR needs this page on HTTPS. The first-person preview works here.'
    : 'No WebXR AR in this browser (it needs Chrome on an ARCore Android phone). The first-person preview works here.');
}
function note(t) { $('xr-note').hidden = false; $('xr-note').textContent = t; }

const fwd=new THREE.Vector3(), head=new THREE.Vector3();
let previousTime;
function frame(time,xrFrame) {
  const dt=previousTime===undefined?0:Math.max(0,Math.min(.1,(time-previousTime)/1000));previousTime=time;
  let trackedPose=null,heading=null;
  if(!terrainReady){renderer.render(scene,camera);return;}
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (!xrMode) {
    if (mode === 'walk') {
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + hold.fwd - hold.back;
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (!f && !s && auto) autoStep(dt, time);
      if (f || s) {
        if (auto) setAuto(0);
        const v = (speedMul !== 1 ? WALK * speedMul : fast ? FAST : WALK) * dt / Math.hypot(f, s);
        tryMove((-Math.sin(me.yaw) * f + Math.cos(me.yaw) * s) * v, (-Math.cos(me.yaw) * f - Math.sin(me.yaw) * s) * v);
      }
    }
    const gy = groundY(me.x, me.z) + EYE;
    me.y += (gy - me.y) * Math.min(1, dt * 12);
    if (Math.abs(gy - me.y) > 3) me.y = gy;
    if (params.has('debug') && window.__fly) me.y = gy + window.__fly;
    camera.position.set(me.x, me.y, me.z); camera.rotation.set(me.pitch, me.yaw, 0);
  } else {
    const space=renderer.xr.getReferenceSpace(),pose=space&&xrFrame?.getViewerPose(space);
    if(pose){
      trackedPose=pose.transform;
      const {position,orientation}=trackedPose;
      head.copy(position);fwd.set(0,0,-1).applyQuaternion(orientation);
      heading=(Math.atan2(fwd.x,-fwd.z)/RAD+360)%360;
      if(hold.fwd){
        fwd.y=0;fwd.normalize().multiplyScalar(WALK*1.5*dt);
        if(inWalkArea(head.x+xrOffset.x+fwd.x,head.z+xrOffset.z+fwd.z))xrOffset.add(fwd);
      }
      const px=head.x+xrOffset.x,pz=head.z+xrOffset.z,g=groundY(px,pz);
      xrGround=xrGround===null?g:xrGround+(g-xrGround)*Math.min(1,dt*6);
      world.position.set(-xrOffset.x,-xrGround,-xrOffset.z);
      me.x=px;me.z=pz;
    }
  }
  if(!xrMode){trackedPose={position:camera.position,orientation:camera.quaternion};heading=((-me.yaw/RAD)%360+360)%360;}
  if(visorOn()&&mode!=='menu')walkHud?.update({location:trackedPose?geoAt(me.x,me.z):null,heading,mode:xrMode||'preview',pose:trackedPose,now:time,scene:sceneTone(),speed:xrMode?1:auto||speedMul});

  dressing?.update(me.x, me.z);
  const cam = xrMode ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(sky.position);
  updateTerrain(cam);
  renderer.render(scene, camera);
  if (params.has('debug')) window.__L = layers, window.__view = view, window.__me = me, window.__frame = frame, window.__walk = { me: { ...me }, ground: groundY(me.x, me.z), geo: geoAt(me.x, me.z), layers: layers.map(l => l.stats()) };
}
renderer.setAnimationLoop(frame);
if (params.has('debug')) Object.assign(window, { __frame: frame, __me: me, __view: view, __L: layers });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); walkHud?.resize(); });

function m(v) { return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} km` : v >= 1 ? `${+v.toFixed(1)} m` : `${Math.round(v * 100)} cm`; }
function renderSources() {
  $('sources').innerHTML = manifest.layers.slice().reverse().map(l => `<li><b>${l.name}</b> — elevation: ${l.dem.label}, ${m(l.dem.spacingM)} grid;
    imagery: ${l.imagery.label}, ${m(l.imagery.mpp)}/px. <span>${l.credit}</span></li>`).join('');
}

async function init() {
  const terrainResponse=await fetch(BASE+'walk-env/terrain.json');
  if(!terrainResponse.ok)throw new Error('Terrain manifest unavailable');
  manifest=await terrainResponse.json();
  const reference=fetch(BASE+'jezero-marswalk.route.json').then(r=>r.ok?r.json():null).catch(()=>null);
  const demoWalks=fetch(BASE+'walk-demos.json').then(r=>r.ok?r.json():null).catch(()=>null);
  const t = manifest.tint.rgbLinear; shared.tintMono.value.set(t[0], t[1], t[2]);
  renderSources();
  Q = orientation(manifest.start); Qinv = Q.clone().invert(); stage.quaternion.copy(Q);
  const order = ['global', 'region', 'crater', 'landing'];
  let parent = null;
  for (const id of order) {
    const L = new TerrainLayer(manifest.layers.find(l => l.id === id), parent, shared, BASE, maxAniso);
    planet.add(L.group); layers.push(L); parent = L;
  }
  landing = layers[3];
  const [w, s, e, n] = landing.bounds, pad = 25 / (RAD * MARS_R);
  walkBox = [w + pad / Math.cos(manifest.start.lat * RAD), s + pad, e - pad / Math.cos(manifest.start.lat * RAD), n - pad];
  let done = 0;
  await Promise.all(layers.map(L => L.load().then(() => { $('load-bar').style.width = `${(++done / 4) * 100}%`; })));
  layers.forEach(L => L.attachToParent());
  const h0 = landing.heightAt(manifest.start.lat, manifest.start.lon);
  shared.h0.value = h0;
  pivot.set(...unit(manifest.start.lat, manifest.start.lon)).multiplyScalar(MARS_R + h0);
  planet.position.copy(pivot).negate();
  me.y = groundY(0, 0) + EYE;
  dressing = createDressing({ groundY, slopeAt, brightAt: imageBrightness(landing), sunDir }); world.add(dressing.group); dressing.update(0, 0, true);
  const referenceRoute=await reference;
  walkHud=connectWalkHud({THREE,root:$('walk-visor'),scene,landing,walkBox,start:manifest.start,referenceRoute,actions:{
    drawTrail,trailOn:()=>trailOn,reliefOn:()=>shared.exag.value===2,detailOn:()=>Boolean(shared.detailOn.value),skyOn:()=>skyOn,
    cameraFov:()=>({horizontalFov:2*Math.atan(Math.tan(camera.fov*RAD/2)*camera.aspect)/RAD,verticalFov:camera.fov,distance:1.5,curvature:1}),
    face(heading){if(mode==='walk')me.yaw=-heading*RAD;},
    routeOrigin(location){walkOrigin=localAt(location);if(mode==='menu')reset();},
    speed:()=>speedMul,setSpeed,
    perform(action){
      if(action==='walk-trail'){trailOn=!trailOn;refreshTrail();}
      if(action==='walk-reset')reset();
      if(action==='walk-menu')showMenu();
      if(action==='walk-hide'){$('visor-enabled').checked=false;refreshVisor();}
      if(action==='walk-exit')renderer.xr.getSession()?.end();
      if(action==='walk-relief')setRelief(shared.exag.value===2?1:2);
      if(action==='walk-detail')setDetail(!shared.detailOn.value);
      if(action==='walk-sky')setSky(!skyOn);
    }
  }});
  if(pendingRoute)walkHud.setRoute(pendingRoute);
  renderDemos((await demoWalks)?.demos);
  if(window.parent===window){const routeFile=$('walk-route-file');$('walk-route-import').hidden=false;routeFile.addEventListener('change',async()=>{
    const file=routeFile.files?.[0];if(!file)return;
    try{if(file.size>2_000_000)throw new Error('Route file is too large');const accepted=walkHud.setRoute(validateRoute(JSON.parse(await file.text())));$('walk-route-status').textContent=accepted?'Route loaded. Walk starts at pin A.':'Route outside the walk area. Using the Jezero reference route.';}
    catch(err){$('walk-route-status').textContent=err.message;}finally{routeFile.value='';}
  });}
  terrainReady=true;
  $('loading').hidden=true;$('start').disabled=false;$('start').textContent='Start walking';
  setupXR();
  if(window.parent!==window)window.parent.postMessage({type:'martisdux:walk-ready'},location.origin);
  if (params.has('walk')) startWalk();
}
addEventListener('message',event=>{
  if(window.parent===window||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='martisdux:walk-route')return;
  try{pendingRoute=validateRoute(event.data.route);if(walkHud){const accepted=walkHud.setRoute(pendingRoute);$('walk-route-status').textContent=accepted?'Explorer route loaded. Walk starts at pin A.':'Route outside the walk area. Using the Jezero reference route.';}}catch{ }
});
init().catch(err => { $('loading').textContent = `Could not load the terrain: ${err.message}`; console.error(err); });
