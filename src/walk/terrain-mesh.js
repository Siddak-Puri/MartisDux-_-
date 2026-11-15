import * as THREE from 'three';

const CHUNK = 64;
const LODS = [{ step: 1, until: 110 }, { step: 4, until: 380 }, { step: 16, until: Infinity }];
const SKIRT_Y = -0.6;

function chunkGeometry(hf, c0, r0, step) {
  const cMax = Math.min(c0 + CHUNK, hf.nx - 1), rMax = Math.min(r0 + CHUNK, hf.nz - 1);
  const cols = [], rows = [];
  for (let c = c0; c < cMax; c += step) cols.push(c); cols.push(cMax);
  for (let r = r0; r < rMax; r += step) rows.push(r); rows.push(rMax);
  const nC = cols.length, nR = rows.length, s = hf.step, span = Math.max(2, step);
  const ring = 2 * (nC + nR) - 4;
  const pos = new Float32Array((nC * nR + ring) * 3), nor = new Float32Array(pos.length), uv = new Float32Array((nC * nR + ring) * 2);
  const put = (i, x, y, z, nx, ny, nz) => {
    pos.set([x, y, z], i * 3); nor.set([nx, ny, nz], i * 3);
    uv[i * 2] = x / hf.width; uv[i * 2 + 1] = 1 - z / hf.depth;
  };
  for (let j = 0; j < nR; j++) for (let i = 0; i < nC; i++) {
    const x = cols[i] * s, z = rows[j] * s, y = hf.at(cols[i], rows[j]);
    const gx = (hf.height(x + span, z) - hf.height(x - span, z)) / (2 * span), gz = (hf.height(x, z + span) - hf.height(x, z - span)) / (2 * span);
    const L = Math.hypot(gx, 1, gz);
    put(j * nC + i, x, y, z, -gx / L, 1 / L, -gz / L);
  }
  const index = [];
  for (let j = 0; j < nR - 1; j++) for (let i = 0; i < nC - 1; i++) {
    const a = j * nC + i; index.push(a, a + nC, a + 1, a + 1, a + nC, a + nC + 1);
  }
  const rim = [];
  for (let i = 0; i < nC; i++) rim.push(i);
  for (let j = 1; j < nR; j++) rim.push(j * nC + nC - 1);
  for (let i = nC - 2; i >= 0; i--) rim.push((nR - 1) * nC + i);
  for (let j = nR - 2; j > 0; j--) rim.push(j * nC);
  let k = nC * nR;
  const below = rim.map(v => { put(k, pos[v * 3], SKIRT_Y, pos[v * 3 + 2], nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); return k++; });
  for (let m = 0; m < rim.length; m++) {
    const a = rim[m], b = rim[(m + 1) % rim.length], a2 = below[m], b2 = below[(m + 1) % rim.length];
    index.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

function grainTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (n, seed) => { const a = new Float32Array(n * n); let x = seed; for (let i = 0; i < a.length; i++) { x = (x * 1103515245 + 12345) >>> 0; a[i] = x / 4294967296; } return a; };
  const octave = (u, v, n, L) => {
    const x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const at = (a, b) => L[((b % n + n) % n) * n + ((a % n + n) % n)], sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
  const L = [8, 16, 32, 64, 128].map((n, k) => [n, lattice(n * n, 7 + k * 31)]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let r = 0, g = 0;
    L.forEach(([n, l], k) => { const o = octave(u, v, n, l); if (k >= 2) r += o * [0, 0, 0.3, 0.35, 0.35][k]; else g += o * 0.5; });
    const i = (y * size + x) * 4; data[i] = Math.min(255, r * 255); data[i + 1] = Math.min(255, g * 255); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

export function createTerrain(hf, texture) {
  const group = new THREE.Group(); group.name = 'terrain';
  const material = new THREE.MeshLambertMaterial({ map: texture, color: '#f2b88e' });
  const detail = grainTexture();
  material.onBeforeCompile = sh => {
    sh.uniforms.grain = { value: detail };
    sh.uniforms.grainScale = { value: new THREE.Vector2(hf.width / 2.5, hf.depth / 2.5) };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform sampler2D grain; uniform vec2 grainScale;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  { vec2 g = texture2D(grain, vMapUv * grainScale).rg; diffuseColor.rgb *= mix(0.8, 1.16, g.r) * mix(0.9, 1.08, g.g); }');
  };
  const chunks = [];
  for (let r0 = 0; r0 < hf.nz - 1; r0 += CHUNK) for (let c0 = 0; c0 < hf.nx - 1; c0 += CHUNK) {
    const mesh = new THREE.Mesh(undefined, material);
    mesh.matrixAutoUpdate = false;
    const cx = (c0 + Math.min(CHUNK, hf.nx - 1 - c0) / 2) * hf.step, cz = (r0 + Math.min(CHUNK, hf.nz - 1 - r0) / 2) * hf.step;
    chunks.push({ c0, r0, cx, cz, mesh, geometries: [], lod: -1 });
  }
  let last = null;
  function update(x, z, force = false) {
    if (!force && last && Math.hypot(x - last.x, z - last.z) < 6) return;
    last = { x, z };
    for (const ch of chunks) {
      const d = Math.max(0, Math.hypot(x - ch.cx, z - ch.cz) - CHUNK * 0.7);
      const lod = LODS.findIndex(l => d < l.until);
      if (lod === ch.lod) continue;
      ch.geometries[lod] ??= chunkGeometry(hf, ch.c0, ch.r0, LODS[lod].step);
      ch.mesh.geometry = ch.geometries[lod]; ch.lod = lod;
      if (!ch.mesh.parent) group.add(ch.mesh);
    }
  }
  return { group, update, material };
}
