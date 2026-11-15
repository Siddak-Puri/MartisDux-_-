import { DATASETS } from './data.js';
import { tileUrl } from './tile-access.js';

export function registerOffline() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return Promise.resolve(null);
  return navigator.serviceWorker.register(window.martisDuxAppearance ? 'sw.js?desktop' : 'sw.js').catch(error => { console.warn('[MartisDux] Offline support unavailable.', error); return null; });
}

export function tilesFor(box, { maxTiles = 1500 } = {}) {
  const urls = [];
  const plan = [['hirise', 8, 17], ['ctx', 4, 12], ['viking', 0, 7], ['themis', 4, 9], ['mola', 0, 7]];
  for (const [id, minLevel, maxLevel] of plan) {
    const d = DATASETS[id];
    if (d.bounds) {
      const [w, s, e, n] = d.bounds;
      if (box.east < w || box.west > e || box.north < s || box.south > n) continue;
    }
    for (let z = minLevel; z <= Math.min(maxLevel, d.maximumLevel); z++) {
      const span = 180 / 2 ** z, cols = 2 ** (z + 1), rows = 2 ** z;
      const x0 = Math.max(0, Math.floor((box.west + 180) / span)), x1 = Math.min(cols - 1, Math.floor((box.east + 180) / span));
      const y0 = Math.max(0, Math.floor((90 - box.north) / span)), y1 = Math.min(rows - 1, Math.floor((90 - box.south) / span));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) urls.push(tileUrl(id, x, y, z, d.url));
    }
  }
  return urls.slice(0, maxTiles);
}

export function boxAround(points, marginMetres = 400) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon), lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginMetres / 3396190 * 180 / Math.PI, dLon = dLat / Math.cos(lat * Math.PI / 180);
  return { west: Math.min(...lons) - dLon, east: Math.max(...lons) + dLon, south: Math.min(...lats) - dLat, north: Math.max(...lats) + dLat };
}

export async function pack(urls, onProgress) {
  const service = await registerOffline();
  if (!service) throw new Error('Offline packing is available in the installed app.');
  const registration = await navigator.serviceWorker.ready;
  if (!registration.active) throw new Error('Offline packing needs an active worker.');
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => { onProgress?.(data); if (data.finished) resolve(data); };
    registration.active.postMessage({ type: 'pack', urls }, [channel.port2]);
  });
}
