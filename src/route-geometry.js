import { MARS_RADIUS, normalizeLongitude } from './data.js';

const radians = Math.PI / 180;
const degrees = 180 / Math.PI;
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const vector = ({ lat, lon }) => [Math.cos(lat * radians) * Math.cos(lon * radians), Math.cos(lat * radians) * Math.sin(lon * radians), Math.sin(lat * radians)];
const coordinate = p => ({ lat: Math.atan2(p[2], Math.hypot(p[0], p[1])) * degrees, lon: normalizeLongitude(Math.atan2(p[1], p[0]) * degrees) });

export function surfaceRoute(start, destination) {
  for (const p of [start, destination]) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || p.lon < -180 || p.lon > 360) {
      throw new Error('Enter valid Martian latitude and longitude.');
    }
  }
  const a = vector(start), b = vector(destination);
  const cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const sine = Math.hypot(...cross), cosine = Math.max(-1, Math.min(1, dot(a,b)));
  const angle = Math.atan2(sine, cosine), distance = angle * MARS_RADIUS;
  if (distance < 1) throw new Error('Choose a destination at least one metre from the start.');
  if (Math.PI - angle < 1e-7) throw new Error('These pins are opposite each other. Move one slightly to choose a route direction.');
  const tangent = b.map((value,i) => (value-cosine*a[i])/sine);
  const at = fraction => coordinate(a.map((value,i) => value*Math.cos(angle*fraction)+tangent[i]*Math.sin(angle*fraction)));
  const segments = Math.max(16, Math.ceil(angle / (0.5 * radians)));
  const points = Array.from({ length: segments+1 }, (_,i) => at(i/segments));
  points[0] = { lat: start.lat, lon: normalizeLongitude(start.lon) };
  points[segments] = { lat: destination.lat, lon: normalizeLongitude(destination.lon) };
  return { distance, angle, points, midpoint: at(.5) };
}

export function formatRouteDistance(metres) {
  if (metres < 1000) return `${Math.round(metres).toLocaleString()} m`;
  return `${(metres/1000).toLocaleString(undefined, { maximumFractionDigits: metres < 100_000 ? 2 : 1 })} km`;
}
