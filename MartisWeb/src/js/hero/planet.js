import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  FrontSide,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';

// Hero planet: a lit sphere wrapped in the Viking MDIM 2.1 colour mosaic,
// with a thin fresnel atmosphere. Deliberately small: one mesh, two shells.

const SPIN_PERIOD = 150; // seconds per revolution (Mars itself takes ~24.6 h)
const START_ROTATION = MathUtils.degToRad(-20); // central meridian ≈ 290°E (Valles Marineris)
const CANVAS_TO_PLANET = 1.6; // .planet-gl is 160% of the planet box (hero.css)
const FOV = 20;

// Sun from the upper left, slightly in front: a crescent of night on the right.
const SUN_DIR = new Vector3(-3.1, 1.7, 2.3).normalize();

const glowVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// Outer halo, drawn on the back faces of a slightly larger shell.
const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = clamp(-dot(vNormal, vView), 0.0, 1.0);
    float halo = pow(clamp(facing * 2.3, 0.0, 1.0), 2.4) * (1.0 - smoothstep(0.55, 1.0, facing));
    // vNormal is the outward normal even on back faces, so this is the sunward limb.
    float lit = clamp(dot(vNormal, uSun) * 0.75 + 0.45, 0.0, 1.0);
    float a = halo * lit * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// Thin bright rim on the sunlit limb, drawn over the planet itself.
const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float fres = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), 3.2);
    float lit = smoothstep(-0.25, 0.6, dot(vNormal, uSun));
    float a = fres * lit * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function glowMaterial(fragmentShader, side, color, intensity) {
  return new ShaderMaterial({
    vertexShader: glowVertex,
    fragmentShader,
    side,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
    uniforms: {
      uColor: { value: new Color(color) },
      uSun: { value: SUN_DIR.clone() },
      uIntensity: { value: intensity },
    },
  });
}

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {HTMLElement} opts.host            planet box; used for visibility
 * @param {{base: string, hd?: string}} opts.textures
 * @param {'low'|'mid'|'high'} opts.tier
 * @param {() => boolean} opts.isReduced
 * @param {() => void} opts.onReady
 * @param {(lonEast: number) => void} opts.onMeridian
 * @param {(x: number, y: number) => void} [opts.onParallax]
 */
export function createPlanet({ canvas, host, textures, tier, isReduced, onReady, onMeridian, onParallax }) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: tier !== 'low',
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  // Distance at which a unit sphere spans exactly 1/1.6 of the canvas height.
  const k = (1 / CANVAS_TO_PLANET) * Math.tan(MathUtils.degToRad(FOV / 2));
  camera.position.set(0, 0, 1 / Math.sin(Math.atan(k)));

  // Axis: north pole tipped toward the viewer, then leaned in the screen plane
  // to match the orbital text band (see --band-tilt in hero.css).
  const tilt = new Group();
  tilt.rotation.order = 'ZXY';
  tilt.rotation.set(0.33, 0, MathUtils.degToRad(12.5));
  scene.add(tilt);

  const segments = tier === 'low' ? [64, 48] : [128, 96];
  const surface = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
    bumpScale: 1.1,
  });
  const planet = new Mesh(new SphereGeometry(1, ...segments), surface);
  planet.rotation.y = START_ROTATION;
  tilt.add(planet);

  const rim = new Mesh(new SphereGeometry(1.004, 96, 72), glowMaterial(rimFragment, FrontSide, '#ffb27a', 0.9));
  const halo = new Mesh(new SphereGeometry(1.13, 96, 72), glowMaterial(haloFragment, BackSide, '#ff8a45', 0.62));
  scene.add(rim, halo);

  const sun = new DirectionalLight(0xfff1e2, 3.3);
  sun.position.copy(SUN_DIR).multiplyScalar(10);
  scene.add(sun, new AmbientLight(0x2a1a0e, 0.18));

  // --- Sizing -----------------------------------------------------------
  const maxDpr = tier === 'high' ? 2 : 1.5;
  function resize() {
    const size = canvas.clientWidth;
    if (!size) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(size, size, false);
    render();
  }

  // --- Textures --------------------------------------------------------
  const loader = new TextureLoader();
  function applyTexture(texture) {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const previous = surface.map;
    surface.map = texture;
    surface.bumpMap = texture;
    surface.needsUpdate = true;
    if (previous && previous !== texture) previous.dispose();
  }

  // --- Loop ------------------------------------------------------------
  let visible = true;
  let running = false;
  let ready = false;
  let last = 0;
  let lastMeridianUpdate = 0;
  let lastMeridian = null;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function reportMeridian(now) {
    if (now - lastMeridianUpdate < 250) return;
    lastMeridianUpdate = now;
    // With three's sphere UVs, the meridian facing +Z is lon = -90° - rotation.
    const lon = -90 - MathUtils.radToDeg(planet.rotation.y);
    const east = Math.round(((lon % 360) + 360) % 360);
    if (east !== lastMeridian) {
      lastMeridian = east;
      onMeridian(east);
    }
  }

  function render() {
    if (!ready) return;
    renderer.render(scene, camera);
  }

  function frame(now) {
    if (!running) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    planet.rotation.y += (dt * Math.PI * 2) / SPIN_PERIOD;

    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;
    tilt.rotation.y = pointer.x * 0.07;
    tilt.rotation.x = 0.33 + pointer.y * 0.045;
    if (onParallax) onParallax(pointer.x, pointer.y);

    render();
    reportMeridian(now);
    requestAnimationFrame(frame);
  }

  function updateRunning() {
    const shouldRun = ready && visible && !document.hidden && !isReduced();
    if (shouldRun && !running) {
      running = true;
      last = 0;
      requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
    }
    if (!shouldRun) render();
  }

  // --- Wiring -----------------------------------------------------------
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      updateRunning();
    },
    { rootMargin: '10% 0px' },
  );
  io.observe(host);
  document.addEventListener('visibilitychange', updateRunning);

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    running = false;
    ready = false;
    host.closest('.hero')?.setAttribute('data-gl', 'lost');
  });

  function setPointer(nx, ny) {
    pointer.tx = nx;
    pointer.ty = ny;
  }

  loader.load(
    textures.base,
    (texture) => {
      applyTexture(texture);
      ready = true;
      resize();
      onMeridian(Math.round(((-90 - MathUtils.radToDeg(START_ROTATION)) % 360 + 360) % 360));
      // Wait one frame so the first image is on screen before cross-fading.
      requestAnimationFrame(() => {
        onReady();
        updateRunning();
      });
      if (textures.hd) {
        window.setTimeout(() => loader.load(textures.hd, (hd) => {
          applyTexture(hd);
          render();
        }), 1800);
      }
    },
    undefined,
    () => host.closest('.hero')?.setAttribute('data-gl', 'lost'),
  );

  return { setPointer, refresh: updateRunning };
}
