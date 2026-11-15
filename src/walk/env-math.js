export const MARS_R = 3396190;
export const RAD = Math.PI / 180;

export function unit(lat, lon) {
  const cl = Math.cos(lat * RAD);
  return [cl * Math.cos(lon * RAD), Math.sin(lat * RAD), -cl * Math.sin(lon * RAD)];
}
export function toLatLon([x, y, z]) {
  const r = Math.hypot(x, y, z);
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) / RAD, lon: Math.atan2(-z, x) / RAD };
}
export const eastOf = lon => [-Math.sin(lon * RAD), 0, -Math.cos(lon * RAD)];
export const northOf = (lat, lon) => [-Math.sin(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD), Math.sin(lat * RAD) * Math.sin(lon * RAD)];

export const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const wrapLon = lon => ((lon + 180) % 360 + 360) % 360 - 180;

export function distanceM(a, b) {
  const s = Math.sin((b.lat - a.lat) * RAD / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin((b.lon - a.lon) * RAD / 2) ** 2;
  return 2 * MARS_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function edgeDistanceM([w, s, e, n], lat, lon) {
  const ky = MARS_R * RAD, kx = ky * Math.cos(lat * RAD);
  const dx = Math.min(lon - w, e - lon) * kx, dy = Math.min(lat - s, n - lat) * ky;
  if (dx >= 0 && dy >= 0) return Math.min(dx, dy);
  return -Math.hypot(Math.min(0, dx), Math.min(0, dy));
}

export function sampleRaster(g, lat, lon, wrap = false) {
  let fc = (lon - g.lon0) / g.dlon;
  const fr = (g.lat0 - lat) / g.dlat;
  if (wrap) fc = ((fc % (g.width - 1)) + (g.width - 1)) % (g.width - 1);
  if (fr < 0 || fc < 0 || fr > g.height - 1 || fc > g.width - 1) return NaN;
  const r0 = Math.min(Math.floor(fr), g.height - 2), c0 = Math.min(Math.floor(fc), g.width - 2), a = fr - r0, b = fc - c0;
  const i = r0 * g.width + c0, h = g.h;
  return h[i] * (1 - a) * (1 - b) + h[i + 1] * (1 - a) * b + h[i + g.width] * a * (1 - b) + h[i + g.width + 1] * a * b;
}

export function lodStep(spacingM, scale, distance, focalPx, maxStep, tolPx = 3) {
  const px = spacingM * scale / Math.max(distance, 1e-4) * focalPx;
  let step = 1;
  while (step * 2 <= maxStep && px * step * 2 <= tolPx) step *= 2;
  return step;
}

export const maxScaleFor = (mpp, mmPerPx = 0.6) => mmPerPx / 1000 / mpp;

export const switchScale = parentMpp => 0.3e-3 / parentMpp;

export function scaleText(scale) {
  const n = 1 / scale;
  const nice = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : Math.round(n / (n >= 1e4 ? 100 : 10)) * (n >= 1e4 ? 100 : 10);
  return `1 : ${typeof nice === 'number' ? nice.toLocaleString('en-US') : nice}`;
}
export function metresText(m) {
  if (m >= 10000) return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  if (m >= 10) return `${Math.round(m)} m`;
  return `${m.toFixed(m >= 1 ? 1 : 2)} m`;
}
