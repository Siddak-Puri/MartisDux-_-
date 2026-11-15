import { MARS_RADIUS } from './data.js';

const rad = Math.PI / 180, deg = 180 / Math.PI;

export const SLOPE_CLASSES = [
  { id: 'easy', label: 'Easy walking', max: 10, color: [0, 0, 0, 0] },
  { id: 'caution', label: 'Caution', max: 20, color: [244, 196, 92, 150] },
  { id: 'steep', label: 'Steep', max: 30, color: [255, 120, 48, 190] },
  { id: 'nogo', label: 'No-go', max: Infinity, color: [214, 38, 38, 215] },
];
export const DEFAULT_MAX_WALK_SLOPE = 25;

export const slopeClass = s => SLOPE_CLASSES.find(c => s < c.max) ?? SLOPE_CLASSES.at(-1);

export function computeSlope(grid, factor = 1) {
  const width = Math.floor((grid.width - 1) / factor) + 1, height = Math.floor((grid.height - 1) / factor) + 1;
  const step = grid.step * factor;
  const elevation = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const v = grid.values[r * factor * grid.width + c * factor];
    elevation[r * width + c] = v === grid.nodata || !Number.isFinite(v) || v < -1e10 ? NaN : v * (grid.scale ?? 1) + (grid.offset ?? 0);
  }
  const lat0 = (grid.y0 - (grid.height - 1) * grid.step / 2) / MARS_RADIUS * deg;
  const dx = step * Math.cos(lat0 * rad), dy = step;
  const slope = new Float32Array(width * height).fill(NaN);
  for (let r = 1; r < height - 1; r++) for (let c = 1; c < width - 1; c++) {
    const i = r * width + c, e = elevation;
    const a = e[i - width - 1], b = e[i - width], cc = e[i - width + 1], d = e[i - 1], f = e[i + 1], g = e[i + width - 1], h = e[i + width], k = e[i + width + 1];
    const gx = ((cc + 2 * f + k) - (a + 2 * d + g)) / (8 * dx);
    const gy = ((g + 2 * h + k) - (a + 2 * b + cc)) / (8 * dy);
    const s = Math.atan(Math.hypot(gx, gy)) * deg;
    if (Number.isFinite(s) && Number.isFinite(e[i])) slope[i] = s;
  }
  return { slope, elevation, width, height, step, dx, dy, x0: grid.x0, y0: grid.y0, lat0, source: grid.id };
}

export const cellOf = (s, p) => {
  const col = Math.round((p.lon * rad * MARS_RADIUS - s.x0) / s.step), row = Math.round((s.y0 - p.lat * rad * MARS_RADIUS) / s.step);
  return col < 0 || row < 0 || col >= s.width || row >= s.height ? null : { col, row, i: row * s.width + col };
};
export const pointOf = (s, col, row) => ({ lon: (s.x0 + col * s.step) / MARS_RADIUS * deg, lat: (s.y0 - row * s.step) / MARS_RADIUS * deg });
export function slopeAt(s, p) { const c = cellOf(s, p); return c ? s.slope[c.i] : NaN; }
export function bounds(s) {
  const h = s.step / 2, k = deg / MARS_RADIUS;
  return { west: (s.x0 - h) * k, east: (s.x0 + (s.width - 1) * s.step + h) * k, north: (s.y0 + h) * k, south: (s.y0 - (s.height - 1) * s.step - h) * k };
}

export function slopeImage(s) {
  const out = new Uint8ClampedArray(s.width * s.height * 4);
  for (let i = 0; i < s.slope.length; i++) {
    const v = s.slope[i];
    if (!Number.isFinite(v)) continue;
    const color = slopeClass(v).color;
    out.set(color, i * 4);
  }
  return out;
}

export function walkCost(slope, maxSlope = DEFAULT_MAX_WALK_SLOPE) {
  if (!Number.isFinite(slope) || slope > maxSlope) return Infinity;
  const t = slope / maxSlope;
  return 1 + 6 * t * t + (slope > 10 ? 2 * t : 0);
}

class MinHeap {
  constructor() { this.keys = []; this.ids = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    const k = this.keys, d = this.ids; let i = d.length; k.push(key); d.push(id);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; d[i] = d[p]; i = p; }
    k[i] = key; d[i] = id;
  }
  pop() {
    const k = this.keys, d = this.ids, top = d[0], lastK = k.pop(), lastD = d.pop(), n = d.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lastK) break; k[i] = k[c]; d[i] = d[c]; i = c; }
      k[i] = lastK; d[i] = lastD;
    }
    return top;
  }
}

function nearestPassable(s, cell, maxSlope, radius = 40) {
  if (walkCost(s.slope[cell.i], maxSlope) < Infinity) return cell;
  for (let r = 1; r <= radius; r++) {
    let best = null, bestD = Infinity;
    for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
      const row = cell.row + dr, col = cell.col + dc;
      if (row < 0 || col < 0 || row >= s.height || col >= s.width) continue;
      const i = row * s.width + col;
      if (walkCost(s.slope[i], maxSlope) === Infinity) continue;
      const dist = Math.hypot(dr * s.dy, dc * s.dx);
      if (dist < bestD) { bestD = dist; best = { row, col, i }; }
    }
    if (best) return best;
  }
  return null;
}

function lineCells(s, a, b) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row)) * 4));
  const out = new Set();
  for (let t = 0; t <= n; t++) {
    const fc = a.col + (b.col - a.col) * t / n, fr = a.row + (b.row - a.row) * t / n;
    for (const oc of [-0.35, 0.35]) for (const or of [-0.35, 0.35]) {
      const col = Math.round(fc + oc), row = Math.round(fr + or);
      if (col >= 0 && row >= 0 && col < s.width && row < s.height) out.add(row * s.width + col);
    }
  }
  return out;
}

export function findSafePath(s, start, destination, { maxSlope = DEFAULT_MAX_WALK_SLOPE } = {}) {
  const a0 = cellOf(s, start), b0 = cellOf(s, destination);
  if (!a0 || !b0) throw new Error('Hazard routing needs both pins inside the Jezero elevation model.');
  const a = nearestPassable(s, a0, maxSlope), b = nearestPassable(s, b0, maxSlope);
  if (!a) throw new Error('Pin A sits on no-go or unmapped ground. Move it to gentler terrain.');
  if (!b) throw new Error('Pin B sits on no-go or unmapped ground. Move it to gentler terrain.');
  const { width, height, dx, dy, slope } = s, n = width * height, dd = Math.hypot(dx, dy);
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) cost[i] = walkCost(slope[i], maxSlope);
  const g = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const heap = new MinHeap(), bc = b.col, br = b.row;
  const h = i => { const r = (i / width) | 0, c = i - r * width, ex = Math.abs(c - bc) * dx, ey = Math.abs(r - br) * dy; return Math.max(ex, ey) + (Math.SQRT2 - 1) * Math.min(ex, ey); };
  const steps = [[-1, -1, dd], [-1, 0, dy], [-1, 1, dd], [0, -1, dx], [0, 1, dx], [1, -1, dd], [1, 0, dy], [1, 1, dd]];
  g[a.i] = 0; heap.push(a.i, h(a.i));
  let found = false;
  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    if (i === b.i) { found = true; break; }
    closed[i] = 1;
    const r = (i / width) | 0, c = i - r * width;
    for (const [sr, sc, len] of steps) {
      const rr = r + sr, cc = c + sc;
      if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
      const j = rr * width + cc;
      if (closed[j] || cost[j] === Infinity) continue;
      if (sr && sc && (cost[r * width + cc] === Infinity || cost[rr * width + c] === Infinity)) continue;
      const next = g[i] + len * (cost[i] + cost[j]) / 2;
      if (next < g[j]) { g[j] = next; from[j] = i; heap.push(j, next + h(j)); }
    }
  }
  if (!found) throw new Error(`No walkable route under ${maxSlope}° connects these pins within the mapped area.`);
  const chain = [];
  for (let i = b.i; i !== -1; i = from[i]) chain.push(i);
  chain.reverse();
  const cells = chain.map(i => ({ i, row: (i / width) | 0, col: i % width }));
  const kept = [cells[0]];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let best = anchor + 1, localMax = slope[cells[anchor].i];
    for (let j = anchor + 1; j < cells.length; j++) {
      localMax = Math.max(localMax, slope[cells[j].i]);
      if (j - anchor > 400) break;
      const line = lineCells(s, cells[anchor], cells[j]);
      let ok = true;
      for (const k of line) if (cost[k] === Infinity || slope[k] > localMax + 0.5) { ok = false; break; }
      if (ok) best = j;
    }
    kept.push(cells[best]); anchor = best;
  }
  const points = kept.map(c => pointOf(s, c.col, c.row));
  return [{ lat: start.lat, lon: start.lon }, ...points, { lat: destination.lat, lon: destination.lon }]
    .filter((p, i, all) => i === 0 || p.lat !== all[i - 1].lat || p.lon !== all[i - 1].lon);
}

function thin(samples, n) {
  if (samples.length <= n) return samples;
  const out = [], size = samples.length / n;
  for (let b = 0; b < n; b++) {
    const bucket = samples.slice(Math.floor(b * size), Math.max(Math.floor(b * size) + 1, Math.floor((b + 1) * size)));
    out.push(bucket.reduce((m, p) => (Number.isFinite(p.slope) && !(p.slope <= m.slope) ? p : m), bucket[0]));
  }
  out.push(samples.at(-1));
  return out;
}

export function routeProfile(s, points) {
  const classes = Object.fromEntries(SLOPE_CLASSES.map(c => [c.id, 0]));
  let distance = 0, maxSlope = 0, ascent = 0, descent = 0, unmapped = 0, lastZ = null, steepest = null;
  const samples = [];
  const R = MARS_RADIUS;
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1], q = points[k];
    const ex = (q.lon - p.lon) * rad * R * Math.cos((p.lat + q.lat) / 2 * rad), ny = (q.lat - p.lat) * rad * R;
    const len = Math.hypot(ex, ny), n = Math.max(1, Math.ceil(len / (s.step / 2)));
    for (let t = k === 1 ? 0 : 1; t <= n; t++) {
      const pt = { lat: p.lat + (q.lat - p.lat) * t / n, lon: p.lon + (q.lon - p.lon) * t / n };
      const c = cellOf(s, pt), seg = t === 0 ? 0 : len / n;
      distance += seg;
      const v = c ? s.slope[c.i] : NaN, z = c ? s.elevation[c.i] : NaN;
      samples.push({ d: distance, z, slope: v, lat: pt.lat, lon: pt.lon });
      if (!Number.isFinite(v)) { unmapped += seg; continue; }
      classes[slopeClass(v).id] += seg;
      if (v > maxSlope) { maxSlope = v; steepest = pt; }
      if (Number.isFinite(z)) { if (lastZ !== null) { const dz = z - lastZ; if (dz > 0) ascent += dz; else descent -= dz; } lastZ = z; }
    }
  }
  return { distance, maxSlope, ascent, descent, unmapped, classes, steepest, samples: thin(samples, 320) };
}

export function gridFor(grids, ...points) {
  return grids.find(s => points.every(p => { const c = cellOf(s, p); return c && Number.isFinite(s.elevation[c.i]); })) ?? null;
}
