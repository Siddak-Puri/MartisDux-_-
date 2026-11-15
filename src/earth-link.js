const rad = Math.PI / 180;
export const AU_LIGHT_SECONDS = 499.004784;
export const AU_KM = 149597870.7;

const ELEMENTS = {
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
};

function heliocentric(body, T) {
  const [base, rate] = ELEMENTS[body];
  const [a, e, I, L, peri, node] = base.map((v, i) => v + rate[i] * T);
  const w = (peri - node) * rad, M = ((((L - peri) % 360) + 540) % 360 - 180) * rad;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node * rad), sn = Math.sin(node * rad), ci = Math.cos(I * rad), si = Math.sin(I * rad);
  return [
    (cw * cn - sw * sn * ci) * x + (-sw * cn - cw * sn * ci) * y,
    (cw * sn + sw * cn * ci) * x + (-sw * sn + cw * cn * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

export function earthMarsDistanceAU(date = new Date()) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
  const e = heliocentric('earth', T), m = heliocentric('mars', T);
  return Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]);
}

export const lightTimeSeconds = (date = new Date()) => earthMarsDistanceAU(date) * AU_LIGHT_SECONDS;

export function formatDelay(seconds) {
  const s = Math.round(seconds), m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}
export const clockDelay = seconds => {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
