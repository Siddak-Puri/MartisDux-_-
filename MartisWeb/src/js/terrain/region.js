import { DEM_B64, META, PLACES, SAMPLES, TRAVERSE } from '../../data/jezero.js';

// The mapped region: the western floor, delta front, Neretva Vallis and
// western rim of Jezero crater, Mars. Every diagram on the site (layers,
// journey tiles, map and AR tile) reads this one region, so the story stays
// coherent — and all of it is real data, built by scripts/build_jezero_data.py
// from the USGS CTX elevation model and NASA's Perseverance traverse.
//
// Coordinates: x ∈ [0, ASPECT] west→east, y ∈ [0, 1] north→south (screen-like).

export const ASPECT = 16 / 9;
export { META, PLACES, SAMPLES, TRAVERSE };

const { cols: DEM_COLS, rows: DEM_ROWS, base, unit } = META;

// Decode once: uint16 decimetres above `base` → metres.
const DEM = (() => {
  const bytes = Uint8Array.from(atob(DEM_B64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(DEM_COLS * DEM_ROWS);
  for (let i = 0; i < out.length; i++) out[i] = base + view.getUint16(i * 2, true) * unit;
  return out;
})();

/** Elevation in metres (relative to the Mars geoid) at a point, bilinear. */
export function heightAt(x, y) {
  const fx = Math.min(DEM_COLS - 1.001, Math.max(0, (x / ASPECT) * (DEM_COLS - 1)));
  const fy = Math.min(DEM_ROWS - 1.001, Math.max(0, y * (DEM_ROWS - 1)));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const a = DEM[j * DEM_COLS + i];
  const b = DEM[j * DEM_COLS + i + 1];
  const c = DEM[(j + 1) * DEM_COLS + i];
  const d = DEM[(j + 1) * DEM_COLS + i + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Site coordinates → longitude (°E) and latitude (°N). */
export function toLonLat(x, y) {
  return [META.lonW + (x / ASPECT) * (META.lonE - META.lonW), META.latN - y * (META.latN - META.latS)];
}

/** Metres on the ground per unit of site y (x uses the same scale). */
export const METRES_PER_UNIT = META.heightM;

/**
 * Sample the region into a normalised grid (values 0…1). The grid also carries
 * the real elevation range (`minM`, `maxM`) and cell size in metres, so
 * slopes and readouts can be given in real units.
 */
export function sampleGrid(cols, rows, { x0 = 0, y0 = 0, x1 = ASPECT, y1 = 1 } = {}) {
  const data = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / (rows - 1);
    for (let i = 0; i < cols; i++) {
      const x = x0 + ((x1 - x0) * i) / (cols - 1);
      const v = heightAt(x, y);
      data[j * cols + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const range = max - min || 1;
  for (let k = 0; k < data.length; k++) data[k] = (data[k] - min) / range;
  return {
    data, cols, rows, x0, y0, x1, y1,
    minM: min,
    maxM: max,
    cellXm: ((x1 - x0) * METRES_PER_UNIT) / (cols - 1),
    cellYm: ((y1 - y0) * METRES_PER_UNIT) / (rows - 1),
  };
}

/** Bilinear lookup in a sampled grid, with u, v ∈ [0, 1]. */
export function lookup(grid, u, v) {
  const { data, cols, rows } = grid;
  const fx = Math.min(cols - 1.001, Math.max(0, u * (cols - 1)));
  const fy = Math.min(rows - 1.001, Math.max(0, v * (rows - 1)));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const a = data[j * cols + i];
  const b = data[j * cols + i + 1];
  const c = data[(j + 1) * cols + i];
  const d = data[(j + 1) * cols + i + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Perseverance's actual drive between two sols, as [x, y] points. */
export function traverse(fromSol = 0, toSol = Infinity) {
  return TRAVERSE.filter(([, , sol]) => sol >= fromSol && sol <= toSol).map(([x, y]) => [x, y]);
}

/** Thin a polyline to points at least `gap` apart (keeps both ends). */
export function thin(points, gap) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = out[out.length - 1];
    if (Math.hypot(points[i][0] - px, points[i][1] - py) >= gap) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export const formatElevation = (m) => `${m < 0 ? '−' : ''}${Math.abs(Math.round(m)).toLocaleString('en-US')} m`;
export const formatLonLat = ([lon, lat]) => `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
