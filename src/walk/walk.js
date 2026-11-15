import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/martian-mono/wght.css';
import './walk.css';
import { Heightfield, Route, bearing, turn, toLatLon } from './geo.js';
import { createTerrain } from './terrain-mesh.js';
import { createHud } from './hud.js';
import { sunAt, missionSol } from '../mars-time.js';
import { slopeClass } from '../hazards.js';
import { walkSpeed, metabolicRate, oxygenGrams, evaDose, EVA_DEFAULTS } from '../eva.js';
import { phoneUrl } from '../phone-link.js';

const $ = id => document.getElementById(id);
if (window !== window.top) document.documentElement.classList.add('embedded');
const EYE = 1.65;
const SKY = { horizon: new THREE.Color('#e6c39c'), zenith: new THREE.Color('#b58a66') };
const O2_CAPACITY_G = oxygenGrams(metabolicRate(EVA_DEFAULTS.flatSpeed, 0) * EVA_DEFAULTS.budgetHours * 3600);

const progress = p => { $('walk-progress').style.width = `${Math.round(p * 100)}%`; };
const walk = await (await fetch('walk/walk.json')).json();
progress(0.1);
const [bin, texture] = await Promise.all([
  fetch(`walk/${walk.grid.heights}`).then(r => r.arrayBuffer()).then(b => { progress(0.5); return b; }),
  new THREE.TextureLoader().loadAsync(`walk/${walk.grid.texture}`).then(t => { progress(0.8); return t; }),
]);
const hf = new Heightfield(walk.grid, new Uint16Array(bin));
const route = new Route(walk.route.points);
const centre = toLatLon(walk.geo, walk.base.x, walk.base.z);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
$('walk-stage').append(renderer.domElement);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 4000);
camera.position.set(0, EYE, 0); camera.rotation.order = 'YXZ';
scene.add(camera);
const fog = new THREE.FogExp2(SKY.horizon, 0.0018);
scene.fog = fog;

const world = new THREE.Group();
scene.add(world);
const terrain = createTerrain(hf, texture);
world.add(terrain.group);

const sunNow = sunAt(centre);
const sunEl = sunNow.elevation > 12 ? sunNow.elevation : 32, sunAz = sunNow.elevation > 12 ? sunNow.azimuth : 245;
const sunDir = new THREE.Vector3(Math.sin(sunAz * Math.PI / 180) * Math.cos(sunEl * Math.PI / 180), Math.sin(sunEl * Math.PI / 180), -Math.cos(sunAz * Math.PI / 180) * Math.cos(sunEl * Math.PI / 180));
const sun = new THREE.DirectionalLight('#fff0dc', 1.9); sun.position.copy(sunDir).multiplyScalar(100);
world.add(sun, sun.target);
world.add(new THREE.HemisphereLight('#f6dcc0', '#6a4630', 1.5));

const apron = new THREE.Mesh(new THREE.CircleGeometry(6000, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#b98a66' }));
apron.position.set(hf.width / 2, -0.7, hf.depth / 2); world.add(apron);

const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { horizon: { value: SKY.horizon }, zenith: { value: SKY.zenith }, sunDir: { value: sunDir } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 horizon, zenith, sunDir; varying vec3 vDir;
    void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(h, 0.55));
      float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
      c += vec3(0.62,0.72,0.86) * pow(s, 40.0) * 0.35 + vec3(1.0) * smoothstep(0.9996, 0.9999, s);
      gl_FragColor = vec4(c, 1.0); }`,
}));
sky.renderOrder = -1; scene.add(sky);

{
  const pts = route.sample(1), pos = [], idx = [];
  pts.forEach((p, i) => {
    const sx = -p.dz * 0.3, sz = p.dx * 0.3;
    for (const k of [1, -1]) { const x = p.x + sx * k, z = p.z + sz * k; pos.push(x, hf.height(x, z) + 0.04, z); }
    if (i) { const a = 2 * i; idx.push(a - 2, a - 1, a, a - 1, a + 1, a); }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const ribbon = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  ribbon.renderOrder = 1; world.add(ribbon);
}

function label(text, sub, color) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), pad = 18;
  ctx.font = '600 44px "Instrument Sans Variable", sans-serif'; const w1 = ctx.measureText(text).width;
  ctx.font = '400 30px "Instrument Sans Variable", sans-serif'; const w2 = sub ? ctx.measureText(sub).width : 0;
  c.width = Math.ceil(Math.max(w1, w2) + pad * 2); c.height = sub ? 120 : 76;
  ctx.fillStyle = 'rgba(18,11,7,0.78)'; ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 18); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#fef3e2'; ctx.font = '600 44px "Instrument Sans Variable", sans-serif'; ctx.fillText(text, pad, 52);
  if (sub) { ctx.fillStyle = color; ctx.font = '400 30px "Instrument Sans Variable", sans-serif'; ctx.fillText(sub, pad, 98); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true, fog: false }));
  const h = 0.05; s.scale.set(h * c.width / c.height, h, 1); s.renderOrder = 10;
  return s;
}
const places = [
  { id: 'base', name: 'A · Base', sub: walk.base.name.replace(' (base)', ''), x: walk.base.x, z: walk.base.z, color: '#ff9c4c' },
  ...walk.stops.map(s => ({ ...s, sub: s.detail, color: '#7ad3ff' })),
];
const goal = places.find(p => Math.hypot(p.x - walk.dest.x, p.z - walk.dest.z) < 2);
if (goal) { goal.name = `B · ${goal.name}`; goal.color = '#ffd166'; } else places.push({ id: 'dest', name: `B · ${walk.dest.name}`, x: walk.dest.x, z: walk.dest.z, color: '#ffd166' });
for (const p of places) {
  const y = hf.height(p.x, p.z), col = new THREE.Color(p.color);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  beam.position.set(p.x, y + 30, p.z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  ring.position.set(p.x, y + 0.06, p.z);
  const tag = label(p.name, p.sub, p.color); tag.position.set(p.x, y + 4, p.z);
  world.add(beam, ring, tag);
}

const yawOf = (x, z) => Math.atan2(-x, -z);
const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
let viewer = new THREE.Vector3(0, EYE, 0), viewerYaw = 0;
let groundY = 0;

function walkerLocal() { world.updateMatrixWorld(); return world.worldToLocal(tmp.set(viewer.x, 0, viewer.z)).clone(); }

function placeAt(x, z, fx, fz) {
  if (fx !== undefined) world.rotation.y = viewerYaw - yawOf(fx, fz);
  const r = new THREE.Vector3(x, 0, z).applyAxisAngle(up, world.rotation.y);
  groundY = hf.height(x, z);
  world.position.set(viewer.x - r.x, -groundY, viewer.z - r.z);
  terrain.update(x, z, true);
}
function moveLocal(dx, dz) {
  const r = new THREE.Vector3(dx, 0, dz).applyAxisAngle(up, world.rotation.y);
  world.position.x -= r.x; world.position.z -= r.z;
}
function startAtBase() {
  const a = route.at(0), b = route.at(25);
  placeAt(walk.base.x, walk.base.z, b.x - a.x, b.z - a.z);
}

const suit = { evaSeconds: 0, o2Used: 0, doseMicroSv: 0 };
let autoWalk = 0, lastLocal = null, speedSmoothed = 0;

function computeState(local, dt) {
  const fwd = camForwardLocal();
  const heading = bearing(fwd.x, fwd.z);
  const proj = route.project(local.x, local.z);
  const sun = sunAt(centre);
  const slope = hf.slope(local.x, local.z, 2);
  const slopeAhead = hf.gradeAlong(local.x, local.z, fwd.x, fwd.z, 5);
  const ahead = places.filter(p => p.id !== 'base').map(p => ({ p, along: p.along ?? route.length, d: Math.hypot(p.x - local.x, p.z - local.z) }))
    .filter(o => o.along >= proj.along - 5 && o.d > 4);
  const nxt = (ahead.length ? ahead.sort((a, b) => a.along - b.along || a.d - b.d)[0] : null);
  const toBase = { x: walk.base.x - local.x, z: walk.base.z - local.z };
  const ll = toLatLon(walk.geo, local.x, local.z);
  return {
    mode: renderer.xr.isPresenting ? 'ar' : 'preview',
    time: { utc: new Date().toISOString(), sol: missionSol('perseverance'), lmst: sun.lmst, ltst: sun.ltst, ls: sun.ls, sunElevation: sun.elevation, sunAzimuth: sun.azimuth },
    position: { x: local.x, z: local.z, lat: ll.lat, lon: ll.lon },
    elevation: hf.height(local.x, local.z) + walk.grid.hmin,
    heading, pitch: camPitch(),
    slope, slopeAhead, slopeClass: slopeClass(slope),
    speed: speedSmoothed,
    route: { walked: proj.along, length: route.length, remaining: route.length - proj.along, offRoute: proj.off,
      turnToRoute: turn(heading, bearing(route.at(proj.along + 8).x - local.x, route.at(proj.along + 8).z - local.z)), autoWalk },
    next: nxt && { id: nxt.p.id, name: nxt.p.name, detail: nxt.p.sub ?? '', distance: nxt.d,
      bearing: bearing(nxt.p.x - local.x, nxt.p.z - local.z), turn: turn(heading, bearing(nxt.p.x - local.x, nxt.p.z - local.z)) },
    base: { distance: Math.hypot(toBase.x, toBase.z), bearing: bearing(toBase.x, toBase.z) },
    suit: { evaSeconds: suit.evaSeconds, o2Grams: O2_CAPACITY_G - suit.o2Used, o2Percent: Math.max(0, 100 * (1 - suit.o2Used / O2_CAPACITY_G)), doseMicroSv: suit.doseMicroSv },
  };
}
function camForwardLocal() {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCamera().getWorldQuaternion(new THREE.Quaternion()));
  f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  return f.normalize().applyAxisAngle(up, -world.rotation.y);
}
function camPitch() {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCamera().getWorldQuaternion(new THREE.Quaternion()));
  return Math.asin(Math.max(-1, Math.min(1, f.y))) * 180 / Math.PI;
}
const activeCamera = () => camera;

const keys = new Set();
addEventListener('keydown', e => { if (!e.target.closest?.('input,select,textarea')) keys.add(e.code); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
{
  let drag = null; const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    camera.rotation.y += (e.clientX - drag.x) * 0.004; camera.rotation.x = Math.max(-1.3, Math.min(1.3, camera.rotation.x + (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointerup', () => { drag = null; });
}
const hold = { fwd: 0 };
document.querySelectorAll('[data-hold]').forEach(b => {
  const on = e => { e.preventDefault(); hold.fwd = Number(b.dataset.hold); }, off = () => { hold.fwd = 0; };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});

const hud = createHud($('hud'));
const goTo = $('walk-goto');
goTo.innerHTML = places.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
goTo.addEventListener('change', () => {
  const p = places.find(q => q.id === goTo.value); if (!p) return;
  if (p.id === 'base') { startAtBase(); return; }
  const dx = p.x - walk.base.x, dz = p.z - walk.base.z, L = Math.hypot(dx, dz) || 1;
  placeAt(p.x - dx / L * 6, p.z - dz / L * 6, dx, dz);
  autoWalk = 0; syncAuto();
});
const autoBtn = $('walk-auto');
function syncAuto() { autoBtn.setAttribute('aria-pressed', String(autoWalk > 0)); autoBtn.querySelector('span').textContent = autoWalk ? `${autoWalk}×` : 'Off'; }
autoBtn.addEventListener('click', () => { autoWalk = { 0: 1, 1: 5, 5: 20, 20: 0 }[autoWalk]; syncAuto(); });
$('walk-face').addEventListener('click', () => {
  const l = walkerLocal(), p = route.project(l.x, l.z), a = route.at(p.along + 10);
  placeAt(l.x, l.z, a.x - l.x, a.z - l.z);
});
const skyBtn = $('walk-sky');
let marsSky = true;
function syncSky() {
  sky.visible = marsSky; apron.visible = marsSky; scene.fog = marsSky ? fog : null;
  skyBtn.setAttribute('aria-pressed', String(marsSky)); skyBtn.querySelector('span').textContent = marsSky ? 'Mars sky' : 'Room';
}
skyBtn.addEventListener('click', () => { marsSky = !marsSky; syncSky(); });
document.querySelectorAll('#walk-overlay button, #walk-overlay select').forEach(el => el.addEventListener('beforexrselect', e => e.preventDefault()));

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

async function setupAr() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const supported = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (supported) {
    $('walk-ar').hidden = false;
    $('walk-ar').addEventListener('click', async () => {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'], optionalFeatures: ['dom-overlay'], domOverlay: { root: $('walk-overlay') },
      });
      document.body.classList.add('in-ar');
      session.addEventListener('end', () => {
        document.body.classList.remove('in-ar');
        camera.position.set(0, EYE, 0); camera.rotation.set(0, viewerYaw, 0); camera.fov = 70; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
        startAtBase();
      });
      await renderer.xr.setSession(session);
      pendingStart = true;
    });
    return;
  }
  if (isAndroid && !window.isSecureContext) {
    const fix = $('walk-insecure'); fix.hidden = false;
    $('walk-origin').textContent = location.origin;
  } else if (isAndroid) $('walk-noar').hidden = false;
  if (!matchMedia('(pointer: coarse)').matches) {
    const url = await phoneUrl();
    if (url) {
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      $('walk-qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      $('walk-qr-url').textContent = url; $('walk-qr').hidden = false;
    }
  }
}
let pendingStart = false;

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const cam = activeCamera();
  if (renderer.xr.isPresenting) {
    viewer = cam.position.clone();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); viewerYaw = yawOf(f.x, f.z);
    if (pendingStart && viewer.lengthSq() > 0) { pendingStart = false; startAtBase(); }
  } else {
    viewer = camera.position.clone(); viewerYaw = camera.rotation.y;
    const move = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + hold.fwd;
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (keys.has('ArrowLeft')) camera.rotation.y += 1.6 * dt;
    if (keys.has('ArrowRight')) camera.rotation.y -= 1.6 * dt;
    if (move || strafe) {
      const f = camForwardLocal(), speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 8 : 1.4) * dt;
      moveLocal((f.x * move - f.z * strafe) * speed, (f.z * move + f.x * strafe) * speed);
    }
  }
  let local = walkerLocal();
  if (autoWalk) {
    const p = route.project(local.x, local.z), a = route.at(p.along);
    const grade = Math.tan(hf.gradeAlong(a.x, a.z, a.dx, a.dz, 4) * Math.PI / 180);
    const target = route.at(p.along + walkSpeed(grade) * autoWalk * dt);
    moveLocal(target.x - local.x, target.z - local.z);
    if (p.along >= route.length - 0.5) { autoWalk = 0; syncAuto(); }
    local = walkerLocal();
  }
  const g = hf.height(local.x, local.z);
  groundY += (g - groundY) * (1 - Math.exp(-dt * 10));
  world.position.y = -groundY;
  terrain.update(local.x, local.z);
  sky.position.copy(cam.position); sky.rotation.y = world.rotation.y;

  if (lastLocal) {
    const d = Math.hypot(local.x - lastLocal.x, local.z - lastLocal.z);
    if (d < 50) speedSmoothed += (d / Math.max(dt, 1e-3) - speedSmoothed) * (1 - Math.exp(-dt * 3));
    const grade = d > 1e-3 ? (hf.height(local.x, local.z) - hf.height(lastLocal.x, lastLocal.z)) / d : 0;
    const simDt = dt * Math.max(1, autoWalk);
    suit.evaSeconds += simDt;
    suit.o2Used += oxygenGrams(metabolicRate(Math.min(speedSmoothed / Math.max(1, autoWalk), 2), grade) * simDt);
    suit.doseMicroSv += evaDose(simDt) * 1000;
  }
  lastLocal = local;
  const state = computeState(local, dt);
  hud.update(state);
  dispatchEvent(new CustomEvent('martisdux:state', { detail: state }));
  renderer.render(scene, camera);
});

startAtBase();
syncSky(); syncAuto();
progress(1);
setTimeout(() => $('walk-progress').parentElement.classList.add('done'), 300);
document.body.classList.add('ready');
setupAr();
