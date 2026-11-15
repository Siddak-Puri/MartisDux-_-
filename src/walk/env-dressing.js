import * as THREE from 'three';

export const DRESSING_RADIUS = 30;
const FADE_FROM = 24;

export function regolithTexture(maxAniso = 8, size = 512) {
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const H = new Float32Array(size * size), A = new Float32Array(size * size).fill(1);
  for (const [cells, amp] of [[8, 0.5], [16, 0.35], [32, 0.25], [64, 0.18], [128, 0.12]]) {
    const L = Float32Array.from({ length: cells * cells }, rnd);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * cells, v = y / size * cells, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const s = fu * fu * (3 - 2 * fu), t = fv * fv * (3 - 2 * fv), at = (a, b) => L[(b % cells) * cells + (a % cells)];
      H[y * size + x] += amp * ((at(i, j) * (1 - s) + at(i + 1, j) * s) * (1 - t) + (at(i, j + 1) * (1 - s) + at(i + 1, j + 1) * s) * t);
    }
  }
  for (let k = 0; k < 260; k++) {
    const cx = rnd() * size, cy = rnd() * size, r = 1.2 + rnd() ** 4 * 7, tone = 0.88 + rnd() * 0.24, sq = 0.6 + rnd() * 0.8;
    for (let dy = -Math.ceil(r); dy <= r; dy++) for (let dx = -Math.ceil(r); dx <= r; dx++) {
      const d = Math.hypot(dx * sq, dy / sq) / r; if (d > 1) continue;
      const i = (((Math.floor(cy) + dy) % size + size) % size) * size + (((Math.floor(cx) + dx) % size + size) % size);
      H[i] += Math.sqrt(1 - d * d) * r * 0.035; A[i] = A[i] * 0.5 + tone * 0.5;
    }
  }
  const data = new Uint8Array(size * size * 4), at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  let mean = 0; for (const h of H) mean += h; mean /= H.length;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, gx = (at(x + 1, y) - at(x - 1, y)) * 2.2, gy = (at(x, y - 1) - at(x, y + 1)) * 2.2;
    const alb = Math.max(0.6, Math.min(1.4, A[i] * (1 + (H[i] - mean) * 0.35)));
    data[i * 4] = Math.round(Math.max(0, Math.min(1, -gx * 0.5 + 0.5)) * 255);
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, -gy * 0.5 + 0.5)) * 255);
    data[i * 4 + 2] = Math.round(alb / 2 * 255); data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso; t.needsUpdate = true;
  return t;
}

function hash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function rockGeometry(variant) {
  const g = new THREE.IcosahedronGeometry(1, variant % 2 ? 1 : 2), p = g.attributes.position;
  const flat = [0.55, 0.7, 0.45, 0.8, 0.6][variant];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.72 + 0.4 * hash(Math.round(x * 9), Math.round(y * 9) + variant * 31, Math.round(z * 9));
    p.setXYZ(i, x * k * (1 + variant * 0.06), y * k * flat, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function blobTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1), a = Math.max(0, 1 - d) ** 1.6;
    data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
  }
  const t = new THREE.DataTexture(data, size, size); t.needsUpdate = true; return t;
}

export function createDressing({ groundY, slopeAt, brightAt, sunDir }, maxPerVariant = 220) {
  const group = new THREE.Group(); group.name = 'illustrative-dressing';
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const meshes = [0, 1, 2, 3, 4].map(v => {
    const m = new THREE.InstancedMesh(rockGeometry(v), material, maxPerVariant);
    m.count = 0; m.frustumCulled = false; group.add(m); return m;
  });
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1a0d08, transparent: true, opacity: 0.55, alphaMap: blobTexture(), depthWrite: false }), maxPerVariant * 5);
  shadows.count = 0; shadows.frustumCulled = false; shadows.renderOrder = 1; group.add(shadows);
  const sunH = Math.hypot(sunDir.x, sunDir.z), away = new THREE.Vector2(-sunDir.x / sunH, -sunDir.z / sunH), shadowLen = sunH / sunDir.y;
  const shadowYaw = Math.atan2(-away.y, away.x);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), N = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
  const CELL = 7;
  let last = null;
  function update(x, z, force = false) {
    if (!force && last && Math.hypot(x - last.x, z - last.z) < 0.5) return;
    last = { x, z };
    const counts = [0, 0, 0, 0, 0], R = DRESSING_RADIUS;
    let ns = 0;
    for (let cj = Math.floor((z - R - 4) / CELL); cj <= (z + R + 4) / CELL; cj++) for (let ci = Math.floor((x - R - 4) / CELL); ci <= (x + R + 4) / CELL; ci++) {
      const cx = (ci + 0.2 + 0.6 * hash(ci, cj, 2)) * CELL, cz = (cj + 0.2 + 0.6 * hash(ci, cj, 3)) * CELL;
      if (Math.hypot(cx - x, cz - z) > R + 4) continue;
      const p = 0.06 + Math.min(1, slopeAt(cx, cz) / 10) * 0.45 + Math.max(0, Math.min(1, (brightAt(cx, cz) - 0.42) * 4)) * 0.3;
      if (hash(ci, cj, 1) > p) continue;
      const n = 3 + Math.floor(hash(ci, cj, 4) * 11), spread = 0.6 + hash(ci, cj, 5) * 1.8, big = 0.1 + hash(ci, cj, 6) ** 2 * 0.38;
      for (let k = 0; k < n; k++) {
        const u1 = Math.max(1e-6, hash(ci * 31 + k, cj, 7)), u2 = hash(ci, cj * 31 + k, 8), rr = spread * Math.sqrt(-2 * Math.log(u1)) * 0.6;
        const px = cx + rr * Math.cos(6.2832 * u2), pz = cz + rr * Math.sin(6.2832 * u2), d = Math.hypot(px - x, pz - z);
        if (d >= R) continue;
        const size = (k === 0 ? big : big * (0.12 + 0.55 * hash(ci + k, cj - k, 9) ** 2)) * (1 - THREE.MathUtils.smoothstep(d, 24, R));
        if (size < 0.012) continue;
        const v = Math.floor(hash(ci - k, cj + k, 10) * 5), mesh = meshes[v];
        if (counts[v] >= maxPerVariant) continue;
        const gy = groundY(px, pz);
        N.set(groundY(px - 0.5, pz) - groundY(px + 0.5, pz), 1, groundY(px, pz - 0.5) - groundY(px, pz + 0.5)).normalize();
        Q.setFromUnitVectors(UP, N).multiply(Q2.setFromAxisAngle(UP, hash(ci, k, 11) * 6.2832));
        const sx = size * (0.85 + 0.5 * hash(k, ci, 12)), sz = size * (0.85 + 0.5 * hash(k, cj, 13));
        M.compose(P.set(px, gy + size * 0.18, pz), Q, S.set(sx, size, sz));
        mesh.setMatrixAt(counts[v], M);
        const tone = 0.7 + hash(ci + k, cj, 14) * 0.6;
        mesh.setColorAt(counts[v], C.setRGB(0.16 * tone, 0.1 * tone, 0.08 * tone)); counts[v]++;
        const len = size * 0.55 * shadowLen, w = Math.max(sx, sz) * 1.9;
        M.compose(P.set(px + away.x * len * 0.45, gy + 0.012, pz + away.y * len * 0.45), Q.setFromUnitVectors(UP, N).multiply(Q2.setFromAxisAngle(UP, shadowYaw)), S.set(w + len, 1, w));
        shadows.setMatrixAt(ns++, M);
      }
    }
    meshes.forEach((m, v) => { m.count = counts[v]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    shadows.count = ns; shadows.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}
