const rad = Math.PI / 180, deg = 180 / Math.PI;
const mod = (x, m) => ((x % m) + m) % m;
const LEAPS = [[Date.UTC(2017, 0, 1), 37], [Date.UTC(2015, 6, 1), 36], [Date.UTC(2012, 6, 1), 35], [Date.UTC(2009, 0, 1), 34], [Date.UTC(2006, 0, 1), 33]];
const ttMinusUtc = ms => (LEAPS.find(([t]) => ms >= t)?.[1] ?? 32) + 32.184;

export function marsClock(date = new Date()) {
  const jdUT = 2440587.5 + date.getTime() / 8.64e7;
  const jdTT = jdUT + ttMinusUtc(date.getTime()) / 86400;
  const dt = jdTT - 2451545.0;
  const M = (19.3871 + 0.52402073 * dt) * rad;
  const alphaFMS = 270.3871 + 0.524038496 * dt;
  const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018];
  const tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
  const phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
  let pbs = 0;
  for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(((0.985626 * dt) / tau[i] + phi[i]) * rad);
  const eoc = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.050 * Math.sin(3 * M)
    + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + pbs;
  const ls = mod(alphaFMS + eoc, 360);
  const eot = 2.861 * Math.sin(2 * ls * rad) - 0.071 * Math.sin(4 * ls * rad) + 0.002 * Math.sin(6 * ls * rad) - eoc;
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mst = mod(24 * msd, 24);
  const declination = Math.asin(0.42565 * Math.sin(ls * rad)) * deg + 0.25 * Math.sin(ls * rad);
  return { jdTT, ls, eot, msd, mst, declination };
}

export function sunAt(point, date = new Date()) {
  const c = marsClock(date);
  const lmst = mod(c.mst + point.lon / 15, 24);
  const ltst = mod(lmst + c.eot / 15, 24);
  const H = (ltst - 12) * 15 * rad, phi = point.lat * rad, d = c.declination * rad;
  const sinEl = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * deg;
  const azimuth = mod(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * deg + 180, 360);
  return { ...c, lmst, ltst, elevation, azimuth, sol: Math.floor(c.msd) };
}

export function nextLocalTime(point, hours, from = new Date()) {
  const SOL_MS = 88775244;
  const now = sunAt(point, from).ltst;
  return new Date(from.getTime() + mod(hours - now, 24) / 24 * SOL_MS);
}

export function daylight(point, date = new Date(), minElevation = 10) {
  const c = marsClock(date), phi = point.lat * rad, d = c.declination * rad, h0 = minElevation * rad;
  const cosH = (Math.sin(h0) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  if (cosH >= 1) return { start: null, end: null, hours: 0 };
  if (cosH <= -1) return { start: 0, end: 24, hours: 24 };
  const H = Math.acos(cosH) * deg / 15;
  return { start: 12 - H, end: 12 + H, hours: 2 * H };
}

export const formatLocalTime = h => {
  if (h == null) return '—';
  const m = Math.round(mod(h, 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const MISSIONS = {
  perseverance: { name: 'Perseverance', site: 'Jezero', lat: 18.4446, lon: 77.4509, msdOffset: 52304 },
  curiosity: { name: 'Curiosity', site: 'Gale', lat: -4.5895, lon: 137.4417, msdOffset: 49269 },
};
export function missionSol(mission, date = new Date()) {
  const m = MISSIONS[mission] ?? mission;
  return Math.floor(marsClock(date).msd + m.lon / 360) - m.msdOffset;
}
