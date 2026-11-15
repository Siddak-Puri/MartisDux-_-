import { metabolicRate, oxygenGrams, evaDose, EVA_DEFAULTS, formatDuration } from '../../eva.js';
import { loadSpaceWeather, walkRisk, ARRIVAL_UNCERTAINTY_H } from '../../space-weather.js';
import { marsClock } from '../../mars-time.js';
import { dustSeason } from '../../conditions.js';
import { bearing, turn } from './geo.js';

const O2_CAPACITY_G = oxygenGrams(metabolicRate(EVA_DEFAULTS.flatSpeed, 0) * EVA_DEFAULTS.budgetHours * 3600);
const RESERVE_PERCENT = 100 * EVA_DEFAULTS.reserveMinutes / (EVA_DEFAULTS.budgetHours * 60);
const metres = n => `${Math.round(n).toLocaleString('en-US')} m`.replace('-', '−');
const signed = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} m`;

export function nextTurn(route, along, maxAhead = 400) {
  if (!route || route.length - along < 20) return null;
  for (let s = along + 5; s <= Math.min(route.length - 30, along + maxAhead); s += 5) {
    const a = route.at(s), b = route.at(s + 30), change = turn(bearing(a.dx, a.dz), bearing(b.dx, b.dz));
    if (Math.abs(change) >= 30) return { distance: s + 15 - along, direction: change > 0 ? 'right' : 'left', angle: change };
  }
  return null;
}

export function forwardCue(state, route) {
  const h = state?.hazard;
  if (!state || state.mode === 'stale' || state.mode === 'waiting') return null;
  if (h?.level === 'steep') return { tone: 'caution', glyph: 'slope', text: `SLOPE ≥15° · ${metres(h.distance)}`, basis: 'dem' };
  if (h?.level === 'caution') return { tone: 'caution', glyph: 'slope', text: `SLOPE ≥10° · ${metres(h.distance)}`, basis: 'dem' };
  if (route && state.route && state.route.offRoute <= 12) {
    const t = nextTurn(route, state.route.walked);
    if (t && t.distance >= 10) return { tone: 'normal', glyph: t.direction, text: `TURN ${t.direction.toUpperCase()} · ${metres(t.distance)}`, basis: 'route' };
  }
  if (h?.level === 'unknown') return { tone: 'caution', glyph: 'edge', text: `1 M MAP EDGE · ${metres(h.distance)}`, basis: 'dem' };
  return null;
}

export const elevationFraction = (elevation, { min, max }) => Number.isFinite(elevation) ? Math.max(0, Math.min(1, (elevation - min) / (max - min))) : null;

export function stepSuit(suit, { dt, moved, rise, speed = 1 }) {
  if (!(dt > 0) || dt > 1) return suit;
  const simDt = dt * speed, v = Math.min(moved / dt / speed, 2), grade = moved > 0.05 ? rise / moved : 0;
  const watts = metabolicRate(v, grade);
  suit.seconds += simDt; suit.o2Used += oxygenGrams(watts * simDt); suit.doseMicroSv += evaDose(simDt) * 1000; suit.watts = watts;
  return suit;
}

export function spaceWeatherLine(sw, now = Date.now()) {
  if (!sw) return { value: 'LOADING', level: 'unknown', detail: 'Requesting NASA DONKI CME forecasts.' };
  if (!sw.arrivals) return { value: 'UNKNOWN', level: 'unknown', detail: `No forecast available${sw.error ? ` (${sw.error})` : ''}.` };
  const risk = walkRisk(sw.arrivals, now, now + EVA_DEFAULTS.budgetHours * 3600000), hours = Math.max(0, (now - sw.fetched) / 3600000);
  const age = hours < 1 ? '<1 h old' : `${Math.round(hours)} h old`, stale = !sw.live || hours > 6;
  const value = risk.level === 'nogo' ? 'CME ARRIVAL FORECAST' : risk.level === 'caution' ? 'CME GLANCING FORECAST' : 'NO CME FORECAST';
  const next = risk.next ? `Next forecast CME arrival at Mars: ${new Date(risk.next.arrival).toISOString().slice(0, 16).replace('T', ' ')} UTC ±${ARRIVAL_UNCERTAINTY_H} h.` : 'No CME arrival at Mars forecast for the next 8 h.';
  return { value: `${value} · ${stale ? 'STALE' : 'MODEL'}`, level: risk.level === 'clear' ? 'clear' : 'caution', detail: `${next} WSA-ENLIL model via NASA DONKI, ${age}. Not a dose measurement.` };
}

const GLYPHS = {
  left: 'M14 5 7 12l7 7M8 12h10', right: 'm10 5 7 7-7 7m6-7H6', slope: 'M3 19 12 6l9 13H3zm9-8v4m0 2v1', edge: 'M4 4v16M9 6h2m4 0h2M9 12h2m4 0h2M9 18h2m4 0h2',
};
const ARC = { cx: 116.15, r: 120, half: 25.68 * Math.PI / 180 };
const arcPoint = (f, r = ARC.r) => { const a = (f - 0.5) * 2 * ARC.half; return [ARC.cx - r * Math.cos(a), 60 - r * Math.sin(a)]; };

export function createTelemetry(root, { field, start, range }) {
  const host = root.querySelector('.helmet-fit-window'), aim = root.querySelector('.helmet-aim svg');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => { const [x1, y1] = arcPoint(f), [x2, y2] = arcPoint(f, ARC.r + 5); return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`; }).join('');
  aim.insertAdjacentHTML('beforeend', `<path class="elev-ticks" d="${ticks}"/><path class="elev-marker" d="M0 0l9 -4.5v9z" hidden/>`);
  host.insertAdjacentHTML('beforeend', `
  <div class="tm-cue" hidden role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path/></svg><span></span></div>
  <button class="tm-elev" type="button" title="Switch between ground elevation and change since the start"><span class="tm-label" data-t="elev-mode">GROUND ELEV</span><strong data-t="elev">—</strong><span class="tm-sub" data-t="elev-sub"></span></button>
  <div class="tm-speed" hidden data-t="speed"></div>
  <aside class="tm-rail" aria-label="Simulated telemetry">
   <button class="tm-row" type="button" aria-expanded="false" data-row="vitals"><i class="tm-dot"></i><span class="tm-label">SIM SUIT</span><span data-t="vitals">—</span></button>
   <div class="tm-detail" hidden data-detail="vitals"></div>
   <button class="tm-row" type="button" aria-expanded="false" data-row="wx"><i class="tm-dot"></i><span class="tm-label">SPACE WX</span><span data-t="wx">LOADING</span></button>
   <div class="tm-detail" hidden data-detail="wx"></div>
  </aside>`);
  const $ = s => host.querySelector(s), cache = new Map();
  const set = (key, text) => { if (cache.get(key) !== text) { cache.set(key, text); $(`[data-t="${key}"]`).textContent = text; } };
  const marker = aim.querySelector('.elev-marker'), cue = $('.tm-cue');
  const suit = { seconds: 0, o2Used: 0, doseMicroSv: 0, watts: 0 };
  const startElevation = field.height(start.x, start.z);
  let relative = false, last = null, weather = null;
  loadSpaceWeather().then(v => { weather = v; }).catch(error => { weather = { error: error.message }; });
  host.addEventListener('click', e => {
    if (e.target.closest('.tm-elev')) { relative = !relative; cache.delete('elev'); return; }
    const row = e.target.closest('.tm-row'); if (!row) return;
    const open = row.getAttribute('aria-expanded') !== 'true'; row.setAttribute('aria-expanded', String(open));
    $(`[data-detail="${row.dataset.row}"]`).hidden = !open;
  });

  function update(state, { now, speed = 1, route = null, relief = false }) {
    const tracked = state && state.mode !== 'stale' && state.mode !== 'waiting' && state.position;
    const elevation = tracked ? field.height(state.position.x, state.position.z) : NaN, mapped = Number.isFinite(elevation);
    set('elev-mode', relative ? 'ΔELEV FROM START' : 'GROUND ELEV');
    set('elev', !mapped ? (tracked ? 'NOT MAPPED' : '—') : relative ? signed(elevation - startElevation) : metres(elevation));
    set('elev-sub', mapped ? 'MOLA AREOID · 1 M DEM' : '');
    const f = elevationFraction(elevation, range);
    marker.toggleAttribute('hidden', f === null);
    if (f !== null) { const [x, y] = arcPoint(f, ARC.r - 3); marker.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`); }
    root.dataset.terrain = ['steep', 'caution'].includes(state?.hazard?.level) ? 'caution' : 'normal';
    if (tracked && last && mapped) stepSuit(suit, { dt: (now - last.now) / 1000, moved: Math.hypot(state.position.x - last.x, state.position.z - last.z), rise: elevation - last.elevation, speed });
    last = tracked && mapped ? { now, x: state.position.x, z: state.position.z, elevation } : null;
    const o2 = Math.max(0, 100 * (1 - suit.o2Used / O2_CAPACITY_G)), low = o2 <= RESERVE_PERCENT;
    set('vitals', `O₂ ${o2.toFixed(o2 > 99.9 ? 0 : 1)}% · EVA ${formatDuration(suit.seconds)}`);
    $('[data-row="vitals"]').dataset.level = low ? 'caution' : 'clear';
    const vd = $('[data-detail="vitals"]');
    if (!vd.hidden) { const t = `Simulated, not sensors. O₂ ${low ? 'in reserve' : 'above reserve'} (tank sized for ${EVA_DEFAULTS.budgetHours} h). Metabolic rate ${Math.round(suit.watts)} W (Pandolf model, Mars gravity). Dose estimate ${suit.doseMicroSv.toFixed(2)} µSv at the Curiosity RAD surface rate. Heart rate: not modelled.`; if (vd.textContent !== t) vd.textContent = t; }
    const wx = spaceWeatherLine(weather);
    set('wx', wx.value); $('[data-row="wx"]').dataset.level = wx.level;
    const wd = $('[data-detail="wx"]');
    if (!wd.hidden) { const ls = marsClock(new Date()).ls, t = `${wx.detail} Dust: ${dustSeason(ls) ? 'dust-storm season' : 'outside dust-storm season'} (Ls ${ls.toFixed(0)}°, seasonal model, not an observation). Surface radiation: unknown.`; if (wd.textContent !== t) wd.textContent = t; }
    const c = forwardCue(state, route), key = c ? c.text + c.tone : '';
    if (cache.get('cue') !== key) {
      cache.set('cue', key); cue.hidden = !c;
      if (c) { cue.dataset.tone = c.tone; cue.querySelector('path').setAttribute('d', GLYPHS[c.glyph]); cue.querySelector('span').textContent = c.text; }
    }
    const tag = [relief ? 'RELIEF ×2 · NOT TO SCALE' : '', speed > 1 ? `SIM SPEED ${speed}×` : ''].filter(Boolean).join('\n');
    if (cache.get('speed') !== tag) { cache.set('speed', tag); const el = $('.tm-speed'); el.hidden = !tag; el.textContent = tag; }
  }
  return { update };
}
