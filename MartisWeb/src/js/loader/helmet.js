import {
  ACESFilmicToneMapping,
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
  Raycaster,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { LOOK, TIMING, VISOR_PATTERN } from './config.js';
import { createStars, createVignette } from './stars.js';
import { createGlass, duskTexture, paintDusk } from './visor.js';

// The loading screen's scene: an astronaut's helmet adrift in the dark, lit
// from behind by a low Martian sun on one side and starlight on the other.
// When the page is ready the camera backs off a little, then dives through
// the visor. The glass clears as it comes, and the page is what is behind it.
//
// One unit is the helmet's largest dimension, whatever model is loaded.

const TAU = Math.PI * 2;
const { clamp, lerp, smoothstep, degToRad } = MathUtils;
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

function findVisors(model) {
  const visors = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const names = [object.name, ...[].concat(object.material).map((material) => material.name)];
    if (names.some((name) => VISOR_PATTERN.test(name))) visors.push(object);
  });
  return visors;
}

/** The compass direction the glass faces: its area-weighted normal, flattened. */
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
  // Glass that looks mostly up or down says nothing about which way is forward.
  return length > 0 && sum.length() > length * 0.2 ? sum.normalize() : null;
}

function disposeMaterial(material) {
  const held = [...Object.values(material), ...Object.values(material.uniforms ?? {}).map((uniform) => uniform.value)];
  for (const value of held) if (value?.isTexture) value.dispose();
  material.dispose();
}

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {HTMLElement} opts.stage    the box the helmet is drawn into; CSS decides where it is and how big
 * @param {HTMLElement} opts.overlay  the loading screen, faded out at the end of the dive
 * @param {ArrayBuffer} opts.data     the model file
 * @param {string} opts.path          the folder it came from, for a .gltf's side files
 * @param {'low'|'mid'|'high'} opts.tier
 * @param {boolean} opts.reduced      draw one still frame instead of animating
 */
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
  let exitAt = 0; // when the dive began, or 0 while the helmet floats
  let reveal = () => {};
  let finish = () => {};
  let lit = null;
  let resizer = null;
  let unlisten = () => {};

  function dispose() {
    if (disposed) return;
    disposed = true;
    alive = false;
    cancelAnimationFrame(raf);
    resizer?.disconnect();
    unlisten();
    scene.traverse((object) => {
      object.geometry?.dispose();
      [].concat(object.material ?? []).forEach(disposeMaterial);
    });
    lit?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  try {
    // --- The helmet -----------------------------------------------------
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, path);
    const model = gltf.scene;
    const fit = new Group(); // centres, scales and turns whatever model was loaded
    const pivot = new Group(); // floats, sways and turns to face the camera
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

    // --- Light ------------------------------------------------------------
    const painting = paintDusk({ sun: LOOK.mars.direction, star: LOOK.starlight.direction });
    // A small copy is plenty for the soft light the shell takes from the dusk.
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

    // --- The visor ----------------------------------------------------------
    // `target` is the point on the glass the camera dives at, in pivot space.
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

    renderer.setClearColor(0x000000, 1);
    const stars = createStars(tier === 'low' ? 700 : 1600);
    const vignette = createVignette();
    scene.add(stars, vignette);

    // The pointer: the camera leans after it, and the helmet glances toward it.
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (event) => {
      pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
    };
    if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });
    unlisten = () => window.removeEventListener('pointermove', onPointer);

    // --- Framing --------------------------------------------------------------
    const rest = new Vector3(0, 0, 4); // where the camera waits
    function layout() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      // The helmet is drawn as tall as the stage box, unless that makes it too
      // wide for the screen, and centred on the box.
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
      stars.material.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
      stars.material.uniforms.uPx.value = renderer.getPixelRatio();
      vignette.material.uniforms.uAspect.value = width / height;
    }

    // --- Motion -------------------------------------------------------------
    const shownAt = performance.now();
    const aim = new Vector3();
    const total = TIMING.anticipation + TIMING.dive;
    const fadeFrom = glass ? LOOK.fadeFrom : LOOK.revealAt;
    let last = 0;
    let travel = 0;

    function draw(now) {
      if (disposed) return;
      const t = reduced ? 0 : (now - shownAt) / 1000;
      const ms = exitAt ? now - exitAt : 0;
      const back = exitAt ? clamp(ms / TIMING.anticipation, 0, 1) : 0; // the pull-back
      const dive = exitAt ? clamp((ms - TIMING.anticipation) / TIMING.dive, 0, 1) : 0;
      const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
      last = now;
      const ease = 1 - Math.exp(-dt * 2.5);
      pointer.x += (pointer.tx - pointer.x) * ease;
      pointer.y += (pointer.ty - pointer.y) * ease;

      // Afloat: a slow rise and fall and a slight sway, on unrelated periods so
      // it never visibly loops. It drifts up into place when it first appears,
      // and stills, squares up to the camera and shrinks a touch as it pulls back.
      const calm = 1 - easeInOut(back);
      const arrived = reduced ? 1 : easeOut(clamp(t / 1.2, 0, 1));
      pivot.position.y = (Math.sin((t * TAU) / LOOK.float.period) * LOOK.float.amplitude - (1 - arrived) * 0.03) * calm;
      pivot.rotation.set(
        (LOOK.rest.pitch + Math.sin(t * 0.61 + 1.3) * 0.022 + pointer.y * LOOK.follow.turn * 0.6) * calm,
        (LOOK.rest.yaw + Math.sin(t * 0.43) * 0.06 + pointer.x * LOOK.follow.turn) * calm,
        Math.sin(t * 0.37 + 0.6) * 0.016 * calm,
      );
      pivot.scale.setScalar((0.97 + 0.03 * arrived) * (1 - LOOK.shrink * easeOut(back) * (1 - smoothstep(dive, 0, 0.35))));
      pivot.updateMatrixWorld(true);
      pivot.localToWorld(aim.copy(target));

      // The lens: it tightens a touch during the pull-back, then flings wide
      // as the camera charges in. The distance is corrected for the lens so the
      // helmet keeps the size the approach gives it, and the wide angle shows
      // up as the rim and the stars tearing out past the edges of the screen.
      const lens = dive > 0
        ? lerp(LOOK.fov * LOOK.squeeze, LOOK.diveFov, easeInOut(clamp(dive / 0.75, 0, 1)))
        : lerp(LOOK.fov, LOOK.fov * LOOK.squeeze, easeOut(back));
      const lensHalf = Math.tan(degToRad(lens) / 2);
      const keep = tanHalfFov / lensHalf;
      if (camera.fov !== lens) {
        camera.fov = lens;
        camera.updateProjectionMatrix();
      }

      // The camera backs away, then closes on the glass by a constant share of
      // the remaining distance, so the visor swells faster and faster, while
      // sliding sideways until the visor is dead centre.
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
      // Leaning after the pointer, which the stars answer with parallax.
      camera.position.x += pointer.x * LOOK.follow.lean * calm;
      camera.position.y -= pointer.y * LOOK.follow.lean * 0.6 * calm;
      // A heavy camera's sway: slow, small, and gone by the time it reaches the glass.
      const rattle = LOOK.shake * Math.sin(Math.PI * Math.min(dive * 1.3, 1));
      camera.rotation.set(
        (Math.sin(now * 0.019) + Math.sin(now * 0.031 + 2.1)) * rattle * 0.5,
        (Math.sin(now * 0.023 + 1.7) + Math.sin(now * 0.029)) * rattle * 0.5,
        Math.sin(now * 0.013 + 0.4) * rattle,
      );
      camera.updateMatrixWorld(true);

      // The stars: a slow drift toward the viewer, a breath back during the
      // pull-back, then a rush that smears them into trails.
      const rush = Math.pow(clamp(dive / 0.7, 0, 1), 1.6) * (1 - smoothstep(dive, 0.82, 1));
      const speed = LOOK.drift - Math.sin(Math.PI * back) * (1 - dive) * 1.2 + rush * LOOK.rush;
      travel += speed * dt;
      const su = stars.material.uniforms;
      su.uTravel.value = travel;
      su.uTrail.value = Math.max(speed, 0) * LOOK.shutter;
      su.uCamZ.value = camera.position.z;
      su.uHush.value = 1 - smoothstep(dive, 0, 0.2);
      vignette.material.uniforms.uDepth.value = LOOK.vignette * (1 + 0.6 * rush) * (1 - smoothstep(dive, 0.75, 1));

      if (glass) glass.uniforms.uClear.value = smoothstep(dive, LOOK.revealAt, LOOK.clearBy);
      const fade = smoothstep(dive, fadeFrom, 1);
      if (fade > 0) overlay.style.opacity = (1 - fade).toFixed(3);


      renderer.render(scene, camera);

      if (exitAt && dive >= LOOK.revealAt) reveal();
      if (exitAt && ms >= total) finish();
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      draw(performance.now());
    }

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      alive = false;
    });

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
      /** False once the WebGL context is gone. */
      get alive() {
        return alive;
      },
      /**
       * The pull-back and the dive. `onReveal` fires as the glass starts to
       * clear; the promise settles when the screen is fully see-through.
       */
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
          // The frame loop stops in a background tab; these do not.
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
