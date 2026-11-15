import * as THREE from 'three';
import { MARS_R, RAD, unit, sampleRaster, edgeDistanceM, lodStep, smoothstep } from './env-math.js';

const VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 n1; attribute vec2 geo; attribute vec2 uv1;
varying vec2 vUv; varying vec2 vUv1; varying vec2 vGeo; varying vec3 vN; varying vec3 vWorld;
void main() {
  vN = normalize(mat3(modelMatrix) * n1);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vUv = uv; vUv1 = uv1; vGeo = geo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FRAG = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D mapPage; uniform sampler2D mapOv; uniform float usePage;
uniform sampler2D pMap; uniform vec4 pBounds; uniform vec4 selfB; uniform vec2 band; uniform float blendOn;
uniform vec4 hole; uniform float holeOn; uniform vec3 tint;
uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor; uniform vec3 groundColor;
uniform vec3 fogColor; uniform float fogScale;
uniform sampler2D detailMap; uniform float detailOn; uniform vec2 metresPerDeg;
varying vec2 vUv; varying vec2 vUv1; varying vec2 vGeo; varying vec3 vN; varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  if (holeOn > 0.5 && vGeo.x > hole.x && vGeo.x < hole.z && vGeo.y > hole.y && vGeo.y < hole.w) discard;   // finer layer here
  vec3 tex = usePage > 0.5 ? texture2D(mapPage, vUv).rgb : texture2D(mapOv, vUv1).rgb;
  if (blendOn > 0.5) {                                   // imagery fades into the parent's near this layer's edge
    vec2 e = min(vGeo - selfB.xy, selfB.zw - vGeo) / band;
    float w = smoothstep(0.0, 1.0, min(e.x, e.y));
    vec2 puv = (vGeo - pBounds.xy) / (pBounds.zw - pBounds.xy);
    tex = mix(texture2D(pMap, puv).rgb, tex, w);
  }
  vec3 n = normalize(vN);
  float d = length(vWorld - cameraPosition);
  // ILLUSTRATIVE regolith detail, only within 30 m (zero beyond): modulates shading and tone of the
  // measured surface; it never moves vertices, so measured elevation and the walk height are unchanged.
  if (detailOn > 0.5 && d < 30.0) {
    float w = 1.0 - smoothstep(12.0, 30.0, d);
    vec2 mp = vGeo * metresPerDeg;                                   // metres east / north
    vec4 a = texture2D(detailMap, mp / 1.9), b = texture2D(detailMap, mat2(0.8, -0.6, 0.6, 0.8) * mp / 5.3 + 0.37);
    vec2 dn = (a.rg - 0.5) * 1.1 + (b.rg - 0.5) * 0.6;
    n = normalize(n + (vec3(1.0, 0.0, 0.0) * dn.x + vec3(0.0, 0.0, -1.0) * dn.y) * w);
    tex *= mix(1.0, a.b + b.b, w * 0.6);
  }
  vec3 albedo = tex * tint;
  vec3 light = sunColor * max(dot(n, sunDir), 0.0) + mix(groundColor, skyColor, n.y * 0.5 + 0.5);
  vec3 col = albedo * light;
  col = mix(col, fogColor, 1.0 - exp(-d / fogScale));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const loader = new THREE.TextureLoader();
function texture(url, maxAniso) {
  return new Promise((resolve, reject) => loader.load(url, t => {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso; t.generateMipmaps = true;
    resolve(t);
  }, undefined, reject));
}

async function loadRaster(dem, base) {
  let buf = await (await fetch(base + dem.url)).arrayBuffer();
  const sig = new Uint8Array(buf, 0, 2);
  if (sig[0] === 31 && sig[1] === 139) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const q = new Uint16Array(buf), h = new Float32Array(q.length);
  if (q.length !== dem.width * dem.height) throw new Error(`DEM ${dem.url}: ${q.length} samples, expected ${dem.width * dem.height}`);
  for (let i = 0; i < q.length; i++) h[i] = q[i] === dem.nodata ? NaN : q[i] * dem.scale + dem.offset;
  return { width: dem.width, height: dem.height, lon0: dem.lon0, lat0: dem.lat0, dlon: dem.dlon, dlat: dem.dlat, h };
}

export class TerrainLayer {
  constructor(def, parent, shared, base, maxAniso) {
    Object.assign(this, { def, parent, shared, base, maxAniso });
    this.group = new THREE.Group(); this.group.name = def.id;
    this.wrap = def.id === 'global';
    this.bounds = def.bounds;
    const [w, s, e, n] = def.bounds;
    this.ref = [(w + e) / 2, (s + n) / 2];
    const mono = def.imagery.mode !== 'RGB';
    this.uniforms = {
      hole: { value: new THREE.Vector4() }, holeOn: { value: 0 },
      tint: { value: mono ? shared.tintMono.value : new THREE.Vector3(1, 1, 1) },
      pMap: { value: null }, pBounds: { value: new THREE.Vector4() }, selfB: { value: new THREE.Vector4(w - this.ref[0], s - this.ref[1], e - this.ref[0], n - this.ref[1]) },
      band: { value: new THREE.Vector2(1, 1) }, blendOn: { value: 0 },
      detailOn: def.walkable ? shared.detailOn : { value: 0 },
      metresPerDeg: { value: new THREE.Vector2(RAD * MARS_R * Math.cos(this.ref[1] * RAD), RAD * MARS_R) },
    };
    this.spacingM = def.dem.dlat * RAD * MARS_R;
    const ov = def.imagery.overview;
    this.ovMpp = (ov.bounds[3] - ov.bounds[1]) / ov.size[1] * RAD * MARS_R;
    this.pages = new Map(def.imagery.pages.map(p => [p.key, p]));
    this.loaded = false; this.loading = null;
    this.pageCount = 0; this.maxPages = { region: 40, crater: 48, landing: 96 }[def.id] ?? 16;
  }

  load() {
    this.loading ??= Promise.all([loadRaster(this.def.dem, this.base), texture(this.base + this.def.imagery.overview.url, this.maxAniso)])
      .then(([raster, ov]) => { this.raster = raster; this.overview = ov; this.makeChunks(); this.loaded = true; });
    return this.loading;
  }

  attachToParent() {
    const P = this.parent; if (!P) return;
    P.uniforms.holeOn.value = 1;
    const [w, s, e, n] = this.bounds;
    P.uniforms.hole.value.set(w - P.ref[0], s - P.ref[1], e - P.ref[0], n - P.ref[1]);
    const pb = P.def.imagery.overview.bounds;
    this.uniforms.pMap.value = P.overview;
    this.uniforms.pBounds.value.set(pb[0] - this.ref[0], pb[1] - this.ref[1], pb[2] - this.ref[0], pb[3] - this.ref[1]);
    const bandM = Math.max(this.def.blendM, 60), lat = this.ref[1];
    this.uniforms.band.value.set(bandM / (RAD * MARS_R * Math.cos(lat * RAD)), bandM / (RAD * MARS_R));
    this.uniforms.blendOn.value = 1;
  }

  heightRC(r, c) {
    const g = this.raster;
    r = Math.max(0, Math.min(g.height - 1, r));
    c = this.wrap ? ((c % (g.width - 1)) + g.width - 1) % (g.width - 1) : Math.max(0, Math.min(g.width - 1, c));
    const h = g.h[r * g.width + c];
    if (!this.parent) return h;
    return this.blend(h, g.lat0 - r * g.dlat, g.lon0 + c * g.dlon);
  }
  heightAt(lat, lon) {
    if (!this.raster) return this.parent ? this.parent.heightAt(lat, lon) : 0;
    const h = sampleRaster(this.raster, lat, lon, this.wrap);
    if (!this.parent) return h;
    return this.blend(h, lat, lon);
  }
  blend(h, lat, lon) {
    if (Number.isNaN(h)) return this.parent.heightAt(lat, lon);
    if (this.def.blendM > 0) {
      const d = edgeDistanceM(this.bounds, lat, lon);
      if (d < this.def.blendM) { const hp = this.parent.heightAt(lat, lon); return hp + (h - hp) * smoothstep(0, this.def.blendM, d); }
    }
    return h;
  }
  contains(lat, lon) { const [w, s, e, n] = this.bounds; return lat >= s && lat <= n && lon >= w && lon <= e; }

  makeChunks() {
    const g = this.raster, C = this.def.chunk;
    this.chunks = [];
    for (let cy = 0; cy < Math.ceil((g.height - 1) / C); cy++) for (let cx = 0; cx < Math.ceil((g.width - 1) / C); cx++) {
      const c0 = cx * C, c1 = Math.min(c0 + C, g.width - 1), r0 = cy * C, r1 = Math.min(r0 + C, g.height - 1);
      const lat = g.lat0 - (r0 + r1) / 2 * g.dlat, lon = g.lon0 + (c0 + c1) / 2 * g.dlon;
      const h = this.heightRC(Math.round((r0 + r1) / 2), Math.round((c0 + c1) / 2));
      const center = unit(lat, lon).map(v => v * (MARS_R + (Number.isFinite(h) ? h : 0)));
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
        uniforms: { ...this.shared, ...this.uniforms, mapOv: { value: this.overview }, mapPage: { value: this.overview }, usePage: { value: 0 } },
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.position.set(...center); mesh.visible = false;
      this.group.add(mesh);
      const maxStep = Math.max(1, 2 ** Math.floor(Math.log2(Math.max(c1 - c0, r1 - r0) / 4)));
      this.chunks.push({ key: `${cy}_${cx}`, c0, c1, r0, r1, center, mesh, step: 0, maxStep, geos: new Map(), page: this.pages.get(`${cy}_${cx}`), pageState: 0,
        radiusM: Math.hypot((c1 - c0) * g.dlon * Math.cos(lat * RAD), (r1 - r0) * g.dlat) * RAD * MARS_R / 2 });
    }
  }

  buildGeometry(ch, step) {
    const g = this.raster, cols = [], rows = [];
    for (let c = ch.c0; c < ch.c1; c += step) cols.push(c); cols.push(ch.c1);
    for (let r = ch.r0; r < ch.r1; r += step) rows.push(r); rows.push(ch.r1);
    const nC = cols.length, nR = rows.length, nTop = nC * nR, rim = 2 * (nC + nR) - 4, n = nTop + rim;
    const pos = new Float32Array(n * 3), n1 = new Float32Array(n * 3), uv = new Float32Array(n * 2), uv1 = new Float32Array(n * 2), geo = new Float32Array(n * 2);
    const pb = ch.page?.bounds ?? this.def.imagery.overview.bounds, ob = this.def.imagery.overview.bounds;
    const [cxm, cym, czm] = ch.center, dE0 = g.dlon * RAD * MARS_R, dN = g.dlat * RAD * MARS_R;
    const H = new Float32Array(nTop), grad = new Float32Array(nTop * 2);
    const X = this.shared.exag.value, h0 = this.shared.h0.value;
    for (let j = 0; j < nR; j++) for (let i = 0; i < nC; i++) {
      const r = rows[j], c = cols[i], k = j * nC + i, h = this.heightRC(r, c);
      H[k] = Number.isFinite(h) ? h0 + (h - h0) * X : h0;
      const dE = dE0 * Math.max(0.02, Math.cos((g.lat0 - r * g.dlat) * RAD));
      const hx = (this.heightRC(r, c + step) - this.heightRC(r, c - step)) / (2 * step * dE);
      const hy = (this.heightRC(r - step, c) - this.heightRC(r + step, c)) / (2 * step * dN);
      grad[k * 2] = Number.isFinite(hx) ? hx * X : 0; grad[k * 2 + 1] = Number.isFinite(hy) ? hy * X : 0;
    }
    const put = (k, lat, lon, h, gx, gy, drop) => {
      const sa = Math.sin(lat * RAD), ca = Math.cos(lat * RAD), so = Math.sin(lon * RAD), co = Math.cos(lon * RAD);
      const ux = ca * co, uy = sa, uz = -ca * so, rr = MARS_R + h - drop;
      const ex = -so, ez = -co, nx = -sa * co, ny = ca, nz = sa * so, k3 = k * 3;
      pos[k3] = ux * rr - cxm; pos[k3 + 1] = uy * rr - cym; pos[k3 + 2] = uz * rr - czm;
      const vx = ux - (ex * gx + nx * gy), vy = uy - ny * gy, vz = uz - (ez * gx + nz * gy), L = Math.hypot(vx, vy, vz);
      n1[k3] = vx / L; n1[k3 + 1] = vy / L; n1[k3 + 2] = vz / L;
      uv[k * 2] = (lon - pb[0]) / (pb[2] - pb[0]); uv[k * 2 + 1] = (lat - pb[1]) / (pb[3] - pb[1]);
      uv1[k * 2] = (lon - ob[0]) / (ob[2] - ob[0]); uv1[k * 2 + 1] = (lat - ob[1]) / (ob[3] - ob[1]);
      geo[k * 2] = lon - this.ref[0]; geo[k * 2 + 1] = lat - this.ref[1];
    };
    for (let j = 0; j < nR; j++) for (let i = 0; i < nC; i++) {
      const k = j * nC + i;
      put(k, g.lat0 - rows[j] * g.dlat, g.lon0 + cols[i] * g.dlon, H[k], grad[k * 2], grad[k * 2 + 1], 0);
    }
    const ring = [];
    for (let i = 0; i < nC; i++) ring.push(i);
    for (let j = 1; j < nR; j++) ring.push(j * nC + nC - 1);
    for (let i = nC - 2; i >= 0; i--) ring.push((nR - 1) * nC + i);
    for (let j = nR - 2; j > 0; j--) ring.push(j * nC);
    const drop = Math.max(2 * step * this.spacingM, 4);
    ring.forEach((v, m) => {
      const j = Math.floor(v / nC), i = v % nC;
      put(nTop + m, g.lat0 - rows[j] * g.dlat, g.lon0 + cols[i] * g.dlon, H[v], grad[v * 2], grad[v * 2 + 1], drop);
    });
    const index = new Uint32Array((nC - 1) * (nR - 1) * 6 + ring.length * 6);
    let q = 0;
    for (let j = 0; j < nR - 1; j++) for (let i = 0; i < nC - 1; i++) {
      const a = j * nC + i; index.set([a, a + nC, a + 1, a + 1, a + nC, a + nC + 1], q); q += 6;
    }
    ring.forEach((v, m) => { const w2 = ring[(m + 1) % ring.length], a = nTop + m, b = nTop + (m + 1) % ring.length; index.set([v, a, w2, w2, a, b], q); q += 6; });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('n1', new THREE.BufferAttribute(n1, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    geom.setAttribute('geo', new THREE.BufferAttribute(geo, 2));
    geom.setIndex(new THREE.BufferAttribute(index, 1));
    geom.computeBoundingSphere();
    geom.userData.vertices = n;
    let hmax = -Infinity; for (const h of H) if (h > hmax) hmax = h;
    ch.hmax = Math.max(ch.hmax ?? -Infinity, hmax);
    return geom;
  }

  update(view, budget) {
    if (!this.loaded) return 0;
    let built = 0;
    const tmp = view.tmp;
    for (const ch of this.chunks) {
      tmp.set(0, 0, 0).applyMatrix4(ch.mesh.matrixWorld);
      const dist = Math.max(0.5, tmp.distanceTo(view.camera) - ch.radiusM);
      if (dist > view.maxDist || (ch.hmax !== undefined && dist * dist / (2 * MARS_R) > ch.hmax - view.eyeH + 150)) { ch.mesh.visible = false; continue; }
      let step = lodStep(this.spacingM, 1, dist, view.focalPx, ch.maxStep, view.tolPx * (this.def.walkable ? 1 : 1.5));
      if (step !== ch.step) {
        let geom = ch.geos.get(step);
        if (!geom && built < budget) { geom = this.buildGeometry(ch, step); ch.geos.set(step, geom); built += geom.userData.vertices; }
        if (!geom && ch.step === 0) { step = ch.maxStep; geom = ch.geos.get(step) ?? this.buildGeometry(ch, step); ch.geos.set(step, geom); }
        if (geom) {
          for (const [s, gm] of ch.geos) if (s !== step && s !== ch.maxStep) { gm.dispose(); ch.geos.delete(s); }
          ch.mesh.geometry = geom; ch.step = step;
        } else if (!ch.step) continue;
      }
      ch.mesh.visible = true;
      const ovPx = this.ovMpp / dist * view.focalPx;
      if (ch.page && ovPx > 1.2 && ch.pageState === 0 && view.pageSlots > 0) {
        view.pageSlots--; ch.pageState = 1;
        texture(this.base + ch.page.url, this.maxAniso).then(t => {
          ch.pageTex = t; ch.pageState = 2; ch.lastUsed = performance.now();
          ch.mesh.material.uniforms.mapPage.value = t; ch.mesh.material.uniforms.usePage.value = 1;
          this.pageCount++; this.evictPages();
        }).catch(() => { ch.pageState = 3; });
      }
      if (ch.pageState === 2 && ovPx > 0.8) ch.lastUsed = performance.now();
    }
    return built;
  }

  rebuild() {
    for (const ch of this.chunks ?? []) { for (const g of ch.geos.values()) g.dispose(); ch.geos.clear(); ch.step = 0; ch.hmax = undefined; ch.mesh.visible = false; }
  }

  evictPages() {
    if (this.pageCount <= this.maxPages) return;
    const loaded = this.chunks.filter(c => c.pageState === 2).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const ch of loaded.slice(0, this.pageCount - this.maxPages)) {
      ch.mesh.material.uniforms.usePage.value = 0; ch.mesh.material.uniforms.mapPage.value = this.overview;
      ch.pageTex.dispose(); ch.pageTex = null; ch.pageState = 0; this.pageCount--;
    }
  }

  stats() {
    const vis = this.chunks?.filter(c => c.mesh.visible) ?? [];
    return { id: this.def.id, visible: vis.length, finestStep: vis.length ? Math.min(...vis.map(c => c.step)) : null,
      pages: this.pageCount, vertices: vis.reduce((s, c) => s + (c.mesh.geometry.userData.vertices ?? 0), 0) };
  }
}
