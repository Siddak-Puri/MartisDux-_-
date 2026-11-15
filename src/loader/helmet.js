import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mulberry32 } from './random.js';
import { LOOK, TIMING, VISOR_PATTERN } from './config.js';
import { createGlass, duskTexture, paintDusk } from './visor.js';

const TAU = Math.PI * 2;
const { clamp, lerp, smoothstep, degToRad } = MathUtils;
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

const voidVertex = `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;
const voidFragment = `
  uniform vec2 uRes; // the canvas, in CSS pixels
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // One layer of dot stars: at most one per cell, each a small crisp disc.
  float stars(vec2 p, float cell, float share, float size) {
    vec2 id = floor(p / cell);
    float pick = hash(id);
    if (pick > share) return 0.0;
    vec2 at = (id + 0.15 + 0.7 * vec2(hash(id + 17.3), hash(id + 41.9))) * cell;
    float r = size * (0.55 + 0.6 * hash(id + 7.7));
    return (0.35 + 0.65 * hash(id + 3.1)) * smoothstep(r + 0.6, r - 0.4, length(p - at));
  }
  uniform float uVeil;   // black behind the stars, clear during the desktop reveal
  uniform float uWarp;   // 0 at rest, 1 at full speed
  uniform float uTravel; // how far the streaks have run
  uniform vec2 uFocus;   // where the camera is heading, 0..1 on screen
  // Warp streaks: thin radial lines that race outward from the focus point.
  float streaks(vec2 p) {
    vec2 d = p - uFocus * uRes;
    float r = length(d);
    float lanes = 220.0;
    float a = (atan(d.y, d.x) / 6.2832 + 0.5) * lanes;
    float lane = floor(a);
    float across = abs(fract(a) - 0.5) * r * 6.2832 / lanes; // pixels from the lane's centre line
    float along = log(r + 1.0) * 2.4 - uTravel + hash(vec2(lane, 3.7)) * 9.0;
    float seg = fract(along);
    float on = step(hash(vec2(lane, floor(along))), 0.3);
    float len = 0.55;
    float body = smoothstep(0.0, len, seg) * step(seg, len); // bright head, fading tail
    float width = 0.5 + 1.1 * smoothstep(80.0, 900.0, r);
    return on * body * smoothstep(width + 0.8, width - 0.2, across) * smoothstep(30.0, 260.0, r);
  }
  void main() {
    vec2 p = vUv * uRes;
    float s = (stars(p, 38.0, 0.34, 0.7) + stars(p + 91.0, 96.0, 0.4, 1.25)) * (1.0 - 0.7 * uWarp);
    if (uWarp > 0.001) s += streaks(p) * uWarp * 1.3;
    float light = min(s, 1.0);
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * light, max(light, uVeil));
  }
`;

const dustVertex = `
  attribute vec3 seed; // size, phase, brightness
  uniform float uTime;
  uniform float uScale; // pixels per unit at a distance of one unit
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.13 + seed.y * 6.2832) * 0.05;
    p.y += sin(uTime * 0.09 + seed.y * 12.566) * 0.035;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(-mv.z, 0.01);
    gl_PointSize = min((0.004 + seed.x * 0.009) * uScale / depth, 120.0);
    vAlpha = (0.2 + 0.8 * seed.z) * smoothstep(0.04, 0.7, depth);
    gl_Position = projectionMatrix * mv;
  }
`;
const dustFragment = `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.55, d) * vAlpha * 0.6;
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a, a);
  }
`;

function createVoid() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const material = new ShaderMaterial({
    uniforms: {
      uRes: { value: new Vector2(1, 1) },
      uVeil: { value: 1 },
      uWarp: { value: 0 },
      uTravel: { value: 0 },
      uFocus: { value: new Vector2(0.5, 0.5) },
    },
    vertexShader: voidVertex,
    fragmentShader: voidFragment,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

function createDust(count) {
  const rand = mulberry32(41);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions.set([(rand() - 0.5) * 8, (rand() - 0.5) * 5, -2.5 + rand() * 8.5], i * 3);
    seeds.set([rand(), rand(), rand()], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new BufferAttribute(seeds, 3));
  const material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return points;
}

function findVisors(model) {
  const visors = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const names = [object.name, ...[].concat(object.material).map((material) => material.name)];
    if (names.some((name) => VISOR_PATTERN.test(name))) visors.push(object);
  });
  return visors;
}

function facingOf(meshes) {
  const sum = new Vector3();
  const [a, b, c, ab, ac] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  for (const mesh of meshes) {
    const { position } = mesh.geometry.attributes;
    const { index } = mesh.geometry;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
      sum.add(ab.subVectors(b, a).cross(ac.subVectors(c, a)));
    }
  }
  const length = sum.length();
  sum.y = 0;
  return length > 0 && sum.length() > length * 0.2 ? sum.normalize() : null;
}

function disposeMaterial(material) {
  const held = [...Object.values(material), ...Object.values(material.uniforms ?? {}).map((uniform) => uniform.value)];
  for (const value of held) if (value?.isTexture) value.dispose();
  material.dispose();
}

export async function createHelmet({ canvas, stage, overlay, data, path, tier, reduced }) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: tier !== 'low', powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  const maxDpr = tier === 'high' ? 2 : 1.5;

  const scene = new Scene();
  const camera = new PerspectiveCamera(LOOK.fov, 1, 0.004, 60);
  const tanHalfFov = Math.tan(degToRad(LOOK.fov) / 2);

  let disposed = false;
  let alive = true;
  let raf = 0;
  let exitAt = 0;
  let reveal = () => {};
  let finish = () => {};
  let lit = null;
  let resizer = null;
  const focus = { x: .5, y: .45 };
  const loseContext = event => {
    event.preventDefault();
    alive = false;
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    alive = false;
    cancelAnimationFrame(raf);
    resizer?.disconnect();
    canvas.removeEventListener('webglcontextlost', loseContext);
    scene.traverse((object) => {
      object.geometry?.dispose();
      [].concat(object.material ?? []).forEach(disposeMaterial);
    });
    lit?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, path);
    const model = gltf.scene;
    const fit = new Group();
    const pivot = new Group();
    fit.add(model);
    pivot.add(fit);
    scene.add(pivot);
    scene.updateMatrixWorld(true);

    const visors = findVisors(model);
    const facing = facingOf(visors);
    if (facing) fit.rotation.y = -Math.atan2(facing.x, facing.z);
    fit.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(fit, true);
    const size = bounds.getSize(new Vector3());
    const scale = 1 / Math.max(size.x, size.y, size.z, 1e-6);
    fit.scale.setScalar(scale);
    fit.position.copy(bounds.getCenter(new Vector3())).multiplyScalar(-scale);
    size.multiplyScalar(scale);
    scene.updateMatrixWorld(true);

    const painting = paintDusk({ sun: LOOK.mars.direction, star: LOOK.starlight.direction });
    const small = document.createElement('canvas');
    small.width = 256;
    small.height = 128;
    small.getContext('2d').drawImage(painting, 0, 0, small.width, small.height);
    const smallTexture = new CanvasTexture(small);
    smallTexture.colorSpace = SRGBColorSpace;
    const pmrem = new PMREMGenerator(renderer);
    lit = pmrem.fromEquirectangular(smallTexture);
    smallTexture.dispose();
    pmrem.dispose();
    scene.environment = lit.texture;
    scene.environmentIntensity = LOOK.ambient;

    for (const { color, intensity, direction } of [LOOK.mars, LOOK.starlight]) {
      const light = new DirectionalLight(color, intensity);
      light.position.fromArray(direction).normalize().multiplyScalar(10);
      scene.add(light);
    }

    const target = new Vector3(0, 0, size.z / 2);
    let glass = null;
    if (visors.length) {
      glass = createGlass({ dusk: duskTexture(painting), tint: LOOK.glass.tint, mirror: LOOK.glass.mirror });
      const reach = new Box3();
      for (const visor of visors) {
        [].concat(visor.material).forEach(disposeMaterial);
        visor.material = glass;
        visor.renderOrder = 1;
        reach.expandByObject(visor, true);
      }
      const centre = reach.getCenter(new Vector3());
      const ray = new Raycaster(new Vector3(centre.x, centre.y, reach.max.z + 1), new Vector3(0, 0, -1));
      const hit = ray.intersectObjects(visors, false)[0];
      target.copy(hit ? hit.point : centre.setZ(reach.max.z));
    }

    const backdrop = createVoid();
    const dust = createDust(tier === 'low' ? 70 : 170);
    scene.add(backdrop, dust);

    const rest = new Vector3(0, 0, 4);
    function layout() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      const view = canvas.getBoundingClientRect();
      const box = stage?.getBoundingClientRect() ?? view;
      const tallest = (stage && box.height) || height * 0.6;
      const drawn = Math.min(tallest, (width * 0.9 * size.y) / Math.max(size.x, size.z));
      const unitsPerPixel = size.y / drawn;
      rest.set(
        (view.left + view.width / 2 - (box.left + box.width / 2)) * unitsPerPixel,
        (box.top + box.height / 2 - (view.top + view.height / 2)) * unitsPerPixel,
        (height * unitsPerPixel) / (2 * tanHalfFov),
      );
      backdrop.material.uniforms.uRes.value.set(width, height);
      dust.material.uniforms.uScale.value = renderer.domElement.height / (2 * tanHalfFov);
    }

    const shownAt = performance.now();
    const aim = new Vector3();
    const total = TIMING.anticipation + TIMING.dive;
    const fadeFrom = glass ? LOOK.fadeFrom : LOOK.revealAt;

    function draw(now) {
      if (disposed) return;
      const t = reduced ? 0 : (now - shownAt) / 1000;
      const ms = exitAt ? now - exitAt : 0;
      const back = exitAt ? clamp(ms / TIMING.anticipation, 0, 1) : 0;
      const dive = exitAt ? clamp((ms - TIMING.anticipation) / TIMING.dive, 0, 1) : 0;

      const calm = 1 - easeInOut(back);
      const arrived = reduced ? 1 : easeOut(clamp(t * 1000 / TIMING.arrival, 0, 1));
      pivot.position.y = (Math.sin((t * TAU) / LOOK.float.period) * LOOK.float.amplitude - (1 - arrived) * 0.03) * calm;
      const turn = smoothstep(t, 1.2, 2.8) * Math.sin(Math.max(0, t - 1.2) * .30) * .22;
      pivot.rotation.set(
        (LOOK.rest.pitch + Math.sin(t * 0.61 + 1.3) * 0.022) * calm,
        (LOOK.rest.yaw + Math.sin(t * 0.43) * 0.06 + turn) * calm,
        Math.sin(t * 0.37 + 0.6) * 0.016 * calm,
      );
      pivot.scale.setScalar((0.97 + 0.03 * arrived) * (1 - LOOK.shrink * easeOut(back) * (1 - smoothstep(dive, 0, 0.35))));
      pivot.updateMatrixWorld(true);
      pivot.localToWorld(aim.copy(target));

      const lens = dive > 0
        ? lerp(LOOK.fov * LOOK.squeeze, LOOK.diveFov, easeInOut(clamp(dive / 0.75, 0, 1)))
        : lerp(LOOK.fov, LOOK.fov * LOOK.squeeze, easeOut(back));
      const lensHalf = Math.tan(degToRad(lens) / 2);
      const keep = tanHalfFov / lensHalf;
      if (camera.fov !== lens) {
        camera.fov = lens;
        camera.updateProjectionMatrix();
        dust.material.uniforms.uScale.value = renderer.domElement.height / (2 * lensHalf);
      }

      const from = rest.z * (1 + LOOK.pullBack * easeOut(back));
      if (dive > 0) {
        const gap = from - aim.z;
        const slide = easeInOut(clamp(dive / 0.6, 0, 1));
        camera.position.set(
          lerp(rest.x, aim.x, slide),
          lerp(rest.y, aim.y, slide),
          aim.z + gap * Math.pow(LOOK.stopShort / gap, dive * dive) * keep,
        );
      } else {
        camera.position.set(rest.x, rest.y, from * keep);
      }
      const rattle = LOOK.shake * Math.sin(Math.PI * Math.min(dive * 1.15, 1));
      camera.rotation.set(
        (Math.sin(now * 0.071) + Math.sin(now * 0.113)) * rattle * 0.5,
        (Math.sin(now * 0.083 + 1.7) + Math.sin(now * 0.131)) * rattle * 0.5,
        Math.sin(now * 0.047 + 0.4) * rattle * 1.4,
      );
      camera.updateMatrixWorld(true);

      const warp = easeInOut(clamp(dive / 0.55, 0, 1)) * (1 - smoothstep(dive, 0.85, 1));
      backdrop.material.uniforms.uWarp.value = warp * LOOK.streaks;
      backdrop.material.uniforms.uVeil.value = 1 - smoothstep(dive, LOOK.revealAt, 0.85);
      backdrop.material.uniforms.uTravel.value = dive * dive * 9;
      aim.copy(target);
      pivot.localToWorld(aim).project(camera);
      focus.x = aim.x * .5 + .5;
      focus.y = .5 - aim.y * .5;
      backdrop.material.uniforms.uFocus.value.set(focus.x, 1 - focus.y);

      if (glass) glass.uniforms.uClear.value = smoothstep(dive, LOOK.revealAt, LOOK.clearBy);
      const fade = smoothstep(dive, fadeFrom, 1);
      if (fade > 0) overlay.style.opacity = (1 - fade).toFixed(3);

      dust.material.uniforms.uTime.value = t;

      renderer.render(scene, camera);

      if (exitAt && dive >= LOOK.revealAt) reveal();
      if (exitAt && ms >= total) finish();
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      draw(performance.now());
    }

    canvas.addEventListener('webglcontextlost', loseContext);

    layout();
    await renderer.compileAsync(scene, camera);
    draw(shownAt);
    resizer = new ResizeObserver(() => {
      layout();
      if (!raf) draw(performance.now());
    });
    resizer.observe(canvas);
    if (!reduced) frame();

    return {
      focus,
      get alive() {
        return alive;
      },
      exit({ onReveal } = {}) {
        return new Promise((resolve) => {
          let revealed = false;
          let finished = false;
          reveal = () => {
            if (revealed) return;
            revealed = true;
            onReveal?.();
          };
          finish = () => {
            if (finished) return;
            finished = true;
            reveal();
            overlay.style.opacity = '0';
            dispose();
            resolve();
          };
          exitAt = performance.now();
          window.setTimeout(reveal, TIMING.anticipation + TIMING.dive * LOOK.revealAt + 60);
          window.setTimeout(finish, total + 150);
          if (!raf) frame();
        });
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
