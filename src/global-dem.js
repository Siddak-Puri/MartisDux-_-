import { MARS_RADIUS } from './data.js';
import { distanceBetween } from './surface-navigation.js';

const rad = Math.PI / 180;
export const DEM_MAX_LEVEL = 7;
export const DEM_SAMPLES = 512;
export const tileSpan = level => 180 / 2 ** level;
export const sampleSpacing = (level, lat = 0) => tileSpan(level) * rad * MARS_RADIUS / DEM_SAMPLES * Math.cos(lat * rad);

export function routeWindow(start, destination, maxCells = 1000) {
  const d = distanceBetween(start, destination), pad = Math.max(3000, d * .35);
  const lat = (start.lat + destination.lat) / 2, k = 1 / (rad * MARS_RADIUS);
  const padLat = pad * k, padLon = pad * k / Math.max(.2, Math.cos(lat * rad));
  const box = {
    west: Math.min(start.lon, destination.lon) - padLon, east: Math.max(start.lon, destination.lon) + padLon,
    south: Math.max(-89, Math.min(start.lat, destination.lat) - padLat), north: Math.min(89, Math.max(start.lat, destination.lat) + padLat),
  };
  if (box.east - box.west > 180) return null;
  const sideMetres = Math.max((box.north - box.south) * rad * MARS_RADIUS, (box.east - box.west) * rad * MARS_RADIUS * Math.cos(lat * rad));
  for (let level = DEM_MAX_LEVEL; level >= 2; level--) {
    if (sideMetres / sampleSpacing(level, lat) <= maxCells) return { box, level, spacing: sampleSpacing(level, lat) };
  }
  return null;
}

export function tilesFor(box, level) {
  const span = tileSpan(level), cols = 2 ** (level + 1), rows = 2 ** level;
  const clamp = (v, n) => Math.max(0, Math.min(n - 1, v));
  return {
    x0: clamp(Math.floor((box.west + 180) / span), cols), x1: clamp(Math.floor((box.east + 180) / span), cols),
    y0: clamp(Math.floor((90 - box.north) / span), rows), y1: clamp(Math.floor((90 - box.south) / span), rows),
  };
}

export async function demGrid(fetchTile, box, level) {
  const t = tilesFor(box, level), span = tileSpan(level), n = DEM_SAMPLES;
  const jobs = [];
  for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) jobs.push(fetchTile(x, y, level).then(tile => ({ x, y, tile })));
  const tiles = await Promise.all(jobs);
  const fullW = (t.x1 - t.x0 + 1) * n + 1, fullH = (t.y1 - t.y0 + 1) * n + 1;
  const west = -180 + t.x0 * span, north = 90 - t.y0 * span, perSample = span / n;
  const c0 = Math.max(0, Math.floor((box.west - west) / perSample)), c1 = Math.min(fullW - 1, Math.ceil((box.east - west) / perSample));
  const r0 = Math.max(0, Math.floor((north - box.north) / perSample)), r1 = Math.min(fullH - 1, Math.ceil((north - box.south) / perSample));
  const width = c1 - c0 + 1, height = r1 - r0 + 1, values = new Float32Array(width * height).fill(NaN);
  for (const { x, y, tile } of tiles) {
    const offC = (x - t.x0) * n - c0, offR = (y - t.y0) * n - r0;
    for (let r = Math.max(0, -offR); r <= n && r + offR < height; r++) for (let c = Math.max(0, -offC); c <= n && c + offC < width; c++) {
      const v = tile.values[r * tile.width + c];
      values[(r + offR) * width + c + offC] = v === tile.nodata || v < -1e10 ? NaN : v;
    }
  }
  const step = perSample * rad * MARS_RADIUS;
  return { id: `dem-L${level}`, values, width, height, step, x0: (west + c0 * perSample) * rad * MARS_RADIUS, y0: (north - r0 * perSample) * rad * MARS_RADIUS, scale: 1, offset: 0, nodata: NaN, level };
}

export function tileGrid(tile, x, y, level) {
  const span = tileSpan(level), step = span / DEM_SAMPLES * rad * MARS_RADIUS;
  return { id: `tile-${level}-${x}-${y}`, values: tile.values, width: tile.width, height: tile.height, step,
    x0: (-180 + x * span) * rad * MARS_RADIUS, y0: (90 - y * span) * rad * MARS_RADIUS, scale: 1, offset: 0, nodata: tile.nodata };
}
