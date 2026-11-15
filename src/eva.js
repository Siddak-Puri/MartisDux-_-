export const MARS_G = 3.721, EARTH_G = 9.807, GRAVITY_RATIO = MARS_G / EARTH_G;

export const EVA_DEFAULTS = Object.freeze({
  crewMass: 75,
  suitMass: 70,
  toolMass: 10,
  flatSpeed: 0.9,
  terrain: 1.3,
  budgetHours: 8,
  reserveMinutes: 45,
  stopMinutes: 30,
  maxSlope: 25,
});

export function walkSpeed(grade, flatSpeed = EVA_DEFAULTS.flatSpeed) {
  const tobler = g => Math.exp(-3.5 * Math.abs(g + 0.05));
  return flatSpeed * tobler(grade) / tobler(0);
}

export function metabolicRate(v, grade, p = EVA_DEFAULTS) {
  const W = p.crewMass, L = p.suitMass + p.toolMass, G = Math.max(0, grade * 100);
  const standing = 1.5 * W;
  const load = 2 * (W + L) * (L / W) ** 2 * GRAVITY_RATIO;
  const moving = p.terrain * (W + L) * (1.5 * v * v + 0.35 * v * G) * GRAVITY_RATIO;
  return standing + load + moving;
}
export const restingRate = (p = EVA_DEFAULTS) => metabolicRate(0, 0, p);

export const oxygenGrams = joules => joules / 20100 * 1.429;

export const SURFACE_MSV_PER_DAY = 0.64;
export const evaDose = seconds => SURFACE_MSV_PER_DAY * seconds / 86400;

export function walkLeg(samples, p = EVA_DEFAULTS) {
  let time = 0, energy = 0, unknown = 0, peak = 0;
  const timeline = [{ d: 0, t: 0, e: 0 }];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], run = b.d - a.d;
    if (run <= 0) continue;
    let grade = (b.z - a.z) / run;
    if (!Number.isFinite(grade)) { grade = 0; unknown += run; }
    const v = walkSpeed(grade, p.flatSpeed), dt = run / v, rate = metabolicRate(v, grade, p);
    time += dt; energy += rate * dt; peak = Math.max(peak, rate);
    timeline.push({ d: b.d, t: time, e: energy });
  }
  return { time, energy, distance: samples.at(-1)?.d ?? 0, unknown, peakRate: peak, timeline };
}

export const reverseSamples = samples => {
  const total = samples.at(-1)?.d ?? 0;
  return samples.slice().reverse().map(s => ({ ...s, d: total - s.d }));
};

export const ROVER_SPEED = 2.2;
export function driveLeg(samples, p = EVA_DEFAULTS, speed = ROVER_SPEED) {
  let time = 0, energy = 0;
  const timeline = [{ d: 0, t: 0, e: 0 }], seated = restingRate(p) * 1.2;
  for (let i = 1; i < samples.length; i++) {
    const run = samples[i].d - samples[i - 1].d;
    if (run <= 0) continue;
    const dt = run / speed; time += dt; energy += seated * dt;
    timeline.push({ d: samples[i].d, t: time, e: energy });
  }
  return { time, energy, distance: samples.at(-1)?.d ?? 0, unknown: 0, peakRate: seated, timeline };
}

export function planMarswalk({ outbound, back, stops = 1, toBase, points = [], mode = 'foot' }, p = EVA_DEFAULTS) {
  const leg = mode === 'rover' ? driveLeg : walkLeg;
  const out = leg(outbound, p), ret = leg(back, p);
  const science = stops * p.stopMinutes * 60;
  const total = out.time + science + ret.time;
  const budget = p.budgetHours * 3600, usable = budget - p.reserveMinutes * 60;
  const energy = out.energy + ret.energy + restingRate(p) * science * 1.3;
  let noReturn = null, worstMargin = Infinity, maxToBase = 0;
  for (const s of points) {
    const home = toBase?.(s);
    if (home == null) continue;
    const elapsed = timeAt(out.timeline, s.d);
    maxToBase = Math.max(maxToBase, home);
    const margin = usable - (elapsed + home);
    worstMargin = Math.min(worstMargin, margin);
    if (margin < 0 && !noReturn) noReturn = { ...s, elapsed, home };
  }
  const checks = {
    duration: total <= usable,
    walkBack: !noReturn,
    daylight: true,
  };
  return {
    outbound: out, back: ret, science, total, budget, usable, energy,
    oxygen: oxygenGrams(energy), dose: evaDose(total), maxToBase, worstMargin, noReturn,
    margin: usable - total, checks, ok: checks.duration && checks.walkBack, mode,
  };
}

export function timeAt(timeline, d, key = 't') {
  if (!timeline.length) return 0;
  let lo = 0, hi = timeline.length - 1;
  if (d <= timeline[0].d) return timeline[0][key];
  if (d >= timeline[hi].d) return timeline[hi][key];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (timeline[mid].d <= d) lo = mid; else hi = mid; }
  const a = timeline[lo], b = timeline[hi];
  return a[key] + (b[key] - a[key]) * (d - a.d) / (b.d - a.d || 1);
}

export function walkBackField(grid, baseCell, p = EVA_DEFAULTS) {
  const { width, height, dx, dy, slope } = grid, n = width * height, dd = Math.hypot(dx, dy);
  const pace = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = slope[i];
    pace[i] = Number.isFinite(s) && s <= p.maxSlope ? 1 / walkSpeed(Math.tan(s * Math.PI / 180), p.flatSpeed) : Infinity;
  }
  const time = new Float64Array(n).fill(Infinity);
  if (!(pace[baseCell] < Infinity)) return time;
  const keys = [], ids = [];
  const push = (i, k) => { let j = ids.length; keys.push(k); ids.push(i); while (j > 0) { const q = (j - 1) >> 1; if (keys[q] <= k) break; keys[j] = keys[q]; ids[j] = ids[q]; j = q; } keys[j] = k; ids[j] = i; };
  const pop = () => {
    const top = ids[0], topK = keys[0], lk = keys.pop(), li = ids.pop(), size = ids.length;
    if (size) { let j = 0; for (;;) { let c = 2 * j + 1; if (c >= size) break; if (c + 1 < size && keys[c + 1] < keys[c]) c++; if (keys[c] >= lk) break; keys[j] = keys[c]; ids[j] = ids[c]; j = c; } keys[j] = lk; ids[j] = li; }
    return [top, topK];
  };
  const steps = [[-1, -1, dd], [-1, 0, dy], [-1, 1, dd], [0, -1, dx], [0, 1, dx], [1, -1, dd], [1, 0, dy], [1, 1, dd]];
  time[baseCell] = 0; push(baseCell, 0);
  while (ids.length) {
    const [i, t] = pop();
    if (t > time[i]) continue;
    const r = (i / width) | 0, c = i - r * width;
    for (const [sr, sc, len] of steps) {
      const rr = r + sr, cc = c + sc;
      if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
      const j = rr * width + cc;
      if (pace[j] === Infinity) continue;
      if (sr && sc && (pace[r * width + cc] === Infinity || pace[rr * width + c] === Infinity)) continue;
      const next = t + len * Math.max(pace[i], pace[j]);
      if (next < time[j]) { time[j] = next; push(j, next); }
    }
  }
  return time;
}

export const formatDuration = s => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(s / 60), h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
