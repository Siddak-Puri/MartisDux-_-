// The space around the helmet: a field of real 3D stars that drift slowly
// toward the viewer, shift with the pointer, and smear into light trails as
// the camera charges in. Each star is a small screen-aligned quad drawn from
// where it is now back to where it was a moment ago, so a still star is a
// round dot and a fast one is a streak with a soft tail. Over everything, a
// lens vignette that deepens with speed.

import { BufferAttribute, BufferGeometry, Mesh, MultiplyBlending, AdditiveBlending, ShaderMaterial, Vector2 } from 'three';
import { mulberry32 } from '../util/random.js';

const FAR = -42; // the deepest star, in helmet sizes
const NEAR = 3.6; // stars wrap back to FAR once they pass this

const starVertex = /* glsl */ `
  attribute vec2 corner; // x: 0 at the tail, 1 at the head; y: -1..1 across
  attribute vec3 seed;   // size, brightness, warmth
  uniform float uTravel; // how far the field has moved toward the viewer
  uniform float uTrail;  // trail length, in world units
  uniform float uCamZ;
  uniform float uHush;   // 1 while the helmet floats: keeps stars out from in front of it
  uniform vec2 uRes;     // drawing buffer, in pixels
  uniform float uPx;     // device pixel ratio
  varying vec2 vAt;      // pixels: along the trail from the tail, across from the centre line
  varying float vLen;
  varying float vW;
  varying vec3 vColour;
  void main() {
    vec3 head = position;
    head.z = ${FAR.toFixed(1)} + mod(position.z - ${FAR.toFixed(1)} + uTravel, ${(NEAR - FAR).toFixed(1)});
    vec3 tail = head - vec3(0.0, 0.0, uTrail);
    vec4 h = projectionMatrix * modelViewMatrix * vec4(head, 1.0);
    vec4 t = projectionMatrix * modelViewMatrix * vec4(tail, 1.0);

    float alive = step(head.z, uCamZ - 0.06);
    float fade = smoothstep(${FAR.toFixed(1)}, ${(FAR + 8).toFixed(1)}, head.z)
      * smoothstep(uCamZ - 0.06, uCamZ - 0.9, head.z)
      * mix(1.0, smoothstep(0.4, -1.2, head.z), uHush);
    vColour = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.86, 0.72), seed.z) * (0.25 + 0.75 * seed.y) * fade * alive;

    vec2 hs = h.xy / h.w * 0.5 * uRes;
    vec2 ts = t.w > 0.02 ? t.xy / t.w * 0.5 * uRes : hs;
    vec2 d = hs - ts;
    float len = length(d);
    vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
    float w = (0.85 + 1.1 * seed.x) * uPx;
    // A long trail spreads the same light thinner.
    vColour *= clamp(10.0 * w / (len + 10.0 * w), 0.6, 1.0);
    vec2 s = mix(ts, hs, corner.x) + dir * (corner.x * 2.0 - 1.0) * w + vec2(-dir.y, dir.x) * corner.y * w;
    vAt = vec2(mix(-w, len + w, corner.x), corner.y * w);
    vLen = len;
    vW = w;
    gl_Position = alive > 0.5 ? vec4(s / (0.5 * uRes) * h.w, h.z, h.w) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const starFragment = /* glsl */ `
  varying vec2 vAt;
  varying float vLen;
  varying float vW;
  varying vec3 vColour;
  void main() {
    float beyond = max(max(-vAt.x, vAt.x - vLen), 0.0);
    float dist = length(vec2(beyond, vAt.y));
    float a = smoothstep(vW, vW * 0.25, dist);
    // Brightest at the head, thinning toward the tail.
    a *= mix(1.0, 0.15 + 0.85 * clamp(vAt.x / max(vLen, 1.0), 0.0, 1.0), smoothstep(2.0, 12.0, vLen));
    gl_FragColor = vec4(vColour * a, a);
  }
`;

/** A field of `count` stars. Set `update()` each frame. */
export function createStars(count) {
  const rand = mulberry32(7);
  const positions = new Float32Array(count * 4 * 3);
  const corners = new Float32Array(count * 4 * 2);
  const seeds = new Float32Array(count * 4 * 3);
  const index = new Uint32Array(count * 6);
  const quad = [0, -1, 1, -1, 1, 1, 0, 1];
  for (let i = 0; i < count; i++) {
    const z = FAR + rand() * (NEAR - FAR);
    // Spread wider with depth, so the field fills the frame at every distance.
    const half = (NEAR - z) * 0.45 + 0.6;
    const x = (rand() * 2 - 1) * half * 2.1;
    const y = (rand() * 2 - 1) * half;
    const seed = [rand() ** 2.2, rand(), rand() < 0.22 ? rand() : 0];
    for (let k = 0; k < 4; k++) {
      positions.set([x, y, z], (i * 4 + k) * 3);
      corners.set([quad[k * 2], quad[k * 2 + 1]], (i * 4 + k) * 2);
      seeds.set(seed, (i * 4 + k) * 3);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('corner', new BufferAttribute(corners, 2));
  geometry.setAttribute('seed', new BufferAttribute(seeds, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const material = new ShaderMaterial({
    uniforms: {
      uTravel: { value: 0 },
      uTrail: { value: 0 },
      uCamZ: { value: 4 },
      uHush: { value: 1 },
      uRes: { value: new Vector2(1, 1) },
      uPx: { value: 1 },
    },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

const vignetteVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const vignetteFragment = /* glsl */ `
  uniform float uAspect;
  uniform float uDepth;
  varying vec2 vUv;
  void main() {
    vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
    float k = 1.0 - smoothstep(0.3, 1.1, length(v)) * uDepth;
    gl_FragColor = vec4(vec3(k), 1.0); // multiplied into what is already drawn
  }
`;

/** Darkens the frame's edges; leaves the canvas's alpha (the see-through glass) alone. */
export function createVignette() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const material = new ShaderMaterial({
    uniforms: { uAspect: { value: 1 }, uDepth: { value: 0.5 } },
    vertexShader: vignetteVertex,
    fragmentShader: vignetteFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: MultiplyBlending,
    premultipliedAlpha: true,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}
