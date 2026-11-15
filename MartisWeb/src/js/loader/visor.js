import { CanvasTexture, Color, LinearMipmapLinearFilter, NoBlending, RepeatWrapping, ShaderMaterial, SRGBColorSpace } from 'three';
import { mulberry32 } from '../util/random.js';

// The visor: smoked glass that mirrors a Martian dusk, and the dusk it mirrors.

const TAU = Math.PI * 2;

/** Where a direction lands on an equirectangular canvas (matches equirectUv in three's shaders). */
function project([x, y, z], width, height) {
  const length = Math.hypot(x, y, z) || 1;
  const u = Math.atan2(z, x) / TAU + 0.5;
  const v = Math.asin(y / length) / Math.PI + 0.5;
  return [u * width, (1 - v) * height];
}

/**
 * Paints the world the helmet stands in: a dark sky that warms toward the
 * horizon, a low sun where the Mars rim light comes from, a cold bright point
 * where the starlight comes from, and a line of far ridges. It is drawn rather
 * than downloaded, so the loading screen has nothing extra to wait for.
 *
 * @param {object} opts
 * @param {number[]} opts.sun  direction toward the warm light
 * @param {number[]} opts.star direction toward the cool light
 * @returns {HTMLCanvasElement} equirectangular, 2:1
 */
export function paintDusk({ sun, star, width = 1024 }) {
  const height = width / 2;
  const horizon = height / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#04030a');
  sky.addColorStop(0.5, '#0e0809');
  sky.addColorStop(0.82, '#2c140c');
  sky.addColorStop(1, '#5c2a12');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, '#26110a');
  ground.addColorStop(0.3, '#120805');
  ground.addColorStop(1, '#050302');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, width, horizon);

  // Soft elliptical light, repeated across the left/right seam.
  const glow = (x, y, rx, ry, stops) => {
    for (const shift of [-width, 0, width]) {
      ctx.save();
      ctx.translate(x + shift, y);
      ctx.scale(rx, ry);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [at, color] of stops) gradient.addColorStop(at, color);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  };
  const within = (top, bottom, draw) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width, bottom - top);
    ctx.clip();
    draw();
    ctx.restore();
  };

  const [sunX, sunY] = project(sun, width, height);
  const [starX, starY] = project(star, width, height);
  ctx.globalCompositeOperation = 'lighter';

  within(0, horizon, () => {
    // The sun through dust: a wide haze hugging the horizon, a hot centre.
    glow(sunX, horizon, width * 0.3, height * 0.2, [[0, 'rgba(255, 112, 44, 0.6)'], [0.5, 'rgba(214, 78, 26, 0.22)'], [1, 'rgba(160, 50, 10, 0)']]);
    glow(sunX, sunY, width * 0.06, width * 0.06, [[0, 'rgba(255, 196, 140, 0.95)'], [0.4, 'rgba(255, 140, 70, 0.4)'], [1, 'rgba(255, 110, 40, 0)']]);
    glow(sunX, sunY, width * 0.013, width * 0.013, [[0, '#fff2e0'], [0.6, 'rgba(255, 226, 190, 0.9)'], [1, 'rgba(255, 200, 150, 0)']]);
    // The horizon the helmet faces, lit from behind it.
    glow(width * 0.75, horizon, width * 0.34, height * 0.1, [[0, 'rgba(206, 98, 44, 0.34)'], [1, 'rgba(150, 60, 20, 0)']]);
    // Starlight: a cold wash and one bright point.
    glow(starX, starY, width * 0.2, height * 0.3, [[0, 'rgba(116, 150, 255, 0.34)'], [1, 'rgba(60, 90, 200, 0)']]);
    glow(starX, starY, width * 0.009, width * 0.009, [[0, '#f2f6ff'], [0.55, 'rgba(200, 220, 255, 0.85)'], [1, 'rgba(160, 190, 255, 0)']]);
  });
  // The ground catches a little of each.
  within(horizon, height, () => {
    glow(sunX, horizon, width * 0.24, height * 0.16, [[0, 'rgba(190, 76, 28, 0.42)'], [1, 'rgba(120, 40, 10, 0)']]);
    glow(width * 0.75, horizon, width * 0.3, height * 0.12, [[0, 'rgba(120, 52, 22, 0.3)'], [1, 'rgba(80, 30, 10, 0)']]);
  });

  ctx.globalCompositeOperation = 'source-over';
  const rand = mulberry32(29);
  for (let i = 0; i < 320; i++) {
    const x = rand() * width;
    const y = Math.pow(rand(), 1.3) * horizon * 0.86;
    const radius = 0.35 + Math.pow(rand(), 3) * 1.1;
    ctx.fillStyle = `rgba(${rand() < 0.2 ? '255, 206, 170' : '236, 240, 255'}, ${(0.25 + rand() * 0.6).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }

  // Far ridges, so the horizon is not a ruled line. Whole-number frequencies
  // keep the two ends of the canvas level with each other.
  ctx.fillStyle = '#0f0705';
  ctx.beginPath();
  ctx.moveTo(0, horizon + 2);
  for (let x = 0; x <= width; x += 2) {
    const a = (x / width) * TAU;
    const rise = 5 + 4.5 * Math.sin(a * 3 + 0.6) + 3.2 * Math.sin(a * 7 + 2.1) + 2 * Math.sin(a * 13 + 4.4) + 1.2 * Math.sin(a * 29 + 1);
    ctx.lineTo(x, horizon - Math.max(0, rise) * (height / 512));
  }
  ctx.lineTo(width, horizon + 2);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

/** The dusk as a texture the glass can sample directly. */
export function duskTexture(canvas) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

const vertexShader = /* glsl */ `
  #include <common>
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = inverseTransformDirection(normalMatrix * normal, viewMatrix);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  uniform sampler2D uDusk;
  uniform vec3 uTint;
  uniform float uMirror;
  uniform float uClear;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // Tone map and encode exactly as the renderer does for the shell.
  vec3 display(vec3 light) {
    #ifdef TONE_MAPPING
      light = toneMapping(light);
    #endif
    return linearToOutputTexel(vec4(light, 1.0)).rgb;
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 view = normalize(cameraPosition - vWorldPosition);
    float facing = saturate(dot(normal, view));

    // A fixed mip level: slightly soft, and no seam where the panorama wraps.
    vec3 dusk = textureLod(uDusk, equirectUv(reflect(-view, normal)), 1.0).rgb;
    // The painting tops out at white; let its brightest points burn like light.
    float hot = max(dusk.r, max(dusk.g, dusk.b));
    dusk *= 1.0 + 7.0 * smoothstep(0.5, 1.0, hot);

    float fresnel = pow(1.0 - facing, 5.0);
    vec3 dark = display(uTint);
    vec3 lit = display(uTint + dusk * mix(uMirror, 1.0, fresnel));

    // uClear turns the glass into a window: the smoke thins first, and the
    // reflections ride on a little longer, so the page is seen through glass.
    float smoke = 1.0 - smoothstep(0.0, 0.8, uClear);
    float shine = 1.0 - smoothstep(0.5, 1.0, uClear);
    vec3 colour = dark * smoke + max(lit - dark, 0.0) * shine;

    // Written straight into the canvas, premultiplied: wherever alpha drops,
    // the canvas itself becomes see-through and the page shows from behind.
    gl_FragColor = vec4(colour, max(smoke, max(colour.r, max(colour.g, colour.b))));
  }
`;

/**
 * Dark tinted glass. It is drawn after the shell but not blended with it:
 * its alpha goes into the canvas as is, which is what lets `clear` open the
 * visor onto the page underneath.
 */
export function createGlass({ dusk, tint, mirror }) {
  const material = new ShaderMaterial({
    uniforms: {
      uDusk: { value: dusk },
      uTint: { value: new Color(tint) },
      uMirror: { value: mirror },
      uClear: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: NoBlending,
  });
  material.name = 'Visor glass';
  return material;
}
