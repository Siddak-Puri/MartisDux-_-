import { timeAt, walkSpeed, formatDuration, EVA_DEFAULTS } from './eva.js';

const MARS_RADIUS = 3396190;

export function distanceAt(timeline, t) {
  if (!timeline.length) return 0;
  let lo = 0, hi = timeline.length - 1;
  if (t <= timeline[0].t) return timeline[0].d;
  if (t >= timeline[hi].t) return timeline[hi].d;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (timeline[mid].t <= t) lo = mid; else hi = mid; }
  const a = timeline[lo], b = timeline[hi];
  return a.d + (b.d - a.d) * (t - a.t) / (b.t - a.t || 1);
}

export function pointAt(samples, d) {
  if (!samples.length) return null;
  let lo = 0, hi = samples.length - 1;
  if (d <= samples[0].d) return { lat: samples[0].lat, lon: samples[0].lon };
  if (d >= samples[hi].d) return { lat: samples[hi].lat, lon: samples[hi].lon };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].d <= d) lo = mid; else hi = mid; }
  const a = samples[lo], b = samples[hi], f = (d - a.d) / (b.d - a.d || 1);
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

export function buildTimeline(plan, stations, stopSeconds) {
  const out = plan.outbound, phases = [];
  let t = 0, d = 0;
  for (const station of [...stations].sort((a, b) => a.d - b.d)) {
    const at = Math.min(out.distance, Math.max(d, station.d));
    if (at > d) {
      const dt = timeAt(out.timeline, at) - timeAt(out.timeline, d);
      phases.push({ kind: 'out', d0: d, d1: at, t0: t, t1: t + dt, station }); t += dt; d = at;
    }
    phases.push({ kind: 'science', d0: d, d1: d, t0: t, t1: t + stopSeconds, station }); t += stopSeconds;
  }
  if (d < out.distance) {
    const dt = out.time - timeAt(out.timeline, d);
    phases.push({ kind: 'out', d0: d, d1: out.distance, t0: t, t1: t + dt, station: null }); t += dt;
  }
  phases.push({ kind: 'back', d0: out.distance, d1: 0, t0: t, t1: t + plan.back.time, station: null });
  return { phases, total: t + plan.back.time, length: out.distance };
}

export function stateAt(timeline, plan, t) {
  const elapsed = Math.max(0, Math.min(timeline.total, t));
  const phase = timeline.phases.find(p => elapsed < p.t1) ?? timeline.phases.at(-1);
  let d = phase.d0;
  if (phase.kind === 'out') d = Math.min(phase.d1, distanceAt(plan.outbound.timeline, timeAt(plan.outbound.timeline, phase.d0) + (elapsed - phase.t0)));
  else if (phase.kind === 'back') d = timeline.length - distanceAt(plan.back.timeline, elapsed - phase.t0);
  return { phase, d: Math.max(0, Math.min(timeline.length, d)), elapsed, done: t >= timeline.total };
}

export function homePath(field, start, p = EVA_DEFAULTS) {
  const { width, height, time, slope, dx, dy } = field;
  if (start == null || !Number.isFinite(time[start])) return null;
  const pace = i => 1 / walkSpeed(Math.tan(slope[i] * Math.PI / 180), p.flatSpeed);
  const dd = Math.hypot(dx, dy), cells = [start];
  let i = start, metres = 0;
  for (let guard = width * height; time[i] > 0 && guard > 0; guard--) {
    const r = (i / width) | 0, c = i - r * width, here = pace(i);
    let best = -1, bestCost = Infinity, bestLen = 0;
    for (let sr = -1; sr <= 1; sr++) for (let sc = -1; sc <= 1; sc++) {
      if (!sr && !sc) continue;
      const rr = r + sr, cc = c + sc;
      if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
      const j = rr * width + cc;
      if (!(time[j] < time[i])) continue;
      if (sr && sc && (!Number.isFinite(time[r * width + cc]) || !Number.isFinite(time[rr * width + c]))) continue;
      const len = sr && sc ? dd : sr ? dy : dx, cost = time[j] + len * Math.max(here, pace(j));
      if (cost < bestCost) { bestCost = cost; best = j; bestLen = len; }
    }
    if (best < 0) return null;
    cells.push(best); metres += bestLen; i = best;
  }
  return { cells, seconds: time[start], metres };
}

export function lineOfSight(grid, a, b, heightA = 2, heightB = 2) {
  const { width, elevation, dx, dy } = grid;
  const za = elevation[a.row * width + a.col] + heightA, zb = elevation[b.row * width + b.col] + heightB;
  if (!Number.isFinite(za) || !Number.isFinite(zb)) return null;
  const n = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
  const total = Math.hypot((b.col - a.col) * dx, (b.row - a.row) * dy);
  for (let k = 1; k < n; k++) {
    const f = k / n, z = elevation[Math.round(a.row + (b.row - a.row) * f) * width + Math.round(a.col + (b.col - a.col) * f)];
    if (!Number.isFinite(z)) continue;
    const d = f * total;
    if (z + d * (total - d) / (2 * MARS_RADIUS) > za + (zb - za) * f) return false;
  }
  return true;
}

export const DRILLS = {
  storm: { label: 'Solar storm', warn: 20 * 60 },
  leak: { label: 'Suit leak', air: 40 * 60 },
  injury: { label: 'Injury', slow: 2 },
  rover: { label: 'Rover breaks down' },
};

export function decide(kind, s, drill = DRILLS[kind]) {
  const fmt = formatDuration, left = s.usable - s.elapsed;
  const riding = s.travel === 'rover' && kind !== 'rover' && s.rideHome != null;
  const go = riding ? 'DRIVE HOME NOW' : 'WALK HOME NOW', by = riding ? ' by rover' : '';
  const base = { kind, means: riding ? 'ride' : 'walk', slow: 1 };
  if (kind === 'storm') {
    const home = riding ? s.rideHome : s.walkHome, spare = drill.warn - home;
    return { ...base, home, spare, level: spare >= 0 ? 'warn' : 'bad', title: go,
      text: spare >= 0 ? `Storm particles arrive in ${fmt(drill.warn)}. Home is ${fmt(home)} away${by}. You make it with ${fmt(spare)} to spare.`
        : `Storm particles arrive in ${fmt(drill.warn)}. Home is ${fmt(home)} away${by}: ${fmt(-spare)} in the open. Move now.` };
  }
  if (kind === 'leak') {
    const home = riding ? s.rideHome : s.walkHome, spare = drill.air - home;
    return { ...base, home, spare, level: spare >= 0 ? 'warn' : 'bad', title: spare >= 0 ? go : 'SHARE AIR AND GO',
      text: spare >= 0 ? `Air for ${fmt(drill.air)}. Home is ${fmt(home)} away${by}. You arrive with ${fmt(spare)} of air left.`
        : `Air for ${fmt(drill.air)}, but home is ${fmt(home)} away${by}. Connect to your crewmate's supply and go now.` };
  }
  if (kind === 'injury') {
    const home = riding ? s.rideHome : s.walkHome * drill.slow, spare = left - home;
    return { ...base, slow: riding ? 1 : drill.slow, home, spare, level: spare >= 0 ? 'warn' : 'bad', title: spare >= 0 ? (riding ? go : 'TURN BACK NOW') : 'CALL FOR PICKUP',
      text: riding ? `Home is ${fmt(home)} away by rover. Suit time to spare: ${fmt(spare)}.`
        : spare >= 0 ? `At half speed, home is ${fmt(home)} away. Suit time to spare: ${fmt(spare)}.`
          : `At half speed, home is ${fmt(home)} away but the suit has ${fmt(Math.max(0, left))}. Crewmate assists; call for pickup.` };
  }
  const home = s.walkHome, spare = left - home;
  return { ...base, means: 'walk', home, spare, level: spare >= 0 ? 'warn' : 'bad', title: spare >= 0 ? 'WALK HOME NOW' : 'CALL FOR PICKUP',
    text: spare >= 0 ? `Rover is dead. Home on foot: ${fmt(home)}. Suit time to spare: ${fmt(spare)}. The plan kept you inside the walkback limit.`
      : `Rover is dead. Home on foot is ${fmt(home)} but the suit has ${fmt(Math.max(0, left))}. Call for pickup.` };
}
