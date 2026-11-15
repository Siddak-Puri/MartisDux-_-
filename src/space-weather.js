const API = 'https://api.nasa.gov/DONKI';
const CACHE = 'martisdux-space-weather';
const KEY_STORE = 'martisdux-nasa-api-key';
const DAY = 86400000;
export const ARRIVAL_UNCERTAINTY_H = 12;

const iso = d => d.toISOString().slice(0, 10);
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } },
};
const BUILT_IN = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_NASA_API_KEY) || '';
export const apiKey = () => { try { return localStorage.getItem(KEY_STORE) || BUILT_IN || 'DEMO_KEY'; } catch { return BUILT_IN || 'DEMO_KEY'; } };

export function marsArrivals(cmes) {
  const out = [];
  for (const cme of cmes ?? []) {
    const analyses = cme.cmeAnalyses ?? [];
    const best = analyses.filter(a => a.isMostAccurate);
    for (const a of best.length ? best : analyses.slice(-1)) for (const run of a.enlilList ?? []) for (const hit of run.impactList ?? []) {
      if (hit.location !== 'Mars' || !hit.arrivalTime) continue;
      out.push({ id: cme.activityID, arrival: Date.parse(hit.arrivalTime), glancing: Boolean(hit.isGlancingBlow), speed: a.speed ?? null,
        source: cme.sourceLocation || null, link: cme.link || run.link || null, modelled: run.modelCompletionTime ?? null });
    }
  }
  const byId = new Map();
  for (const a of out) if (!byId.has(a.id) || (a.modelled ?? '') > (byId.get(a.id).modelled ?? '')) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => a.arrival - b.arrival);
}

export function walkRisk(arrivals, startMs, endMs, hours = ARRIVAL_UNCERTAINTY_H) {
  const pad = hours * 3600000;
  const overlapping = arrivals.filter(a => a.arrival + pad >= startMs && a.arrival - pad <= endMs);
  const next = arrivals.find(a => a.arrival + pad >= startMs) ?? null;
  const direct = overlapping.filter(a => !a.glancing);
  return { level: direct.length ? 'nogo' : overlapping.length ? 'caution' : 'clear', overlapping, next };
}

async function getJson(path, params, signal) {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, api_key: apiKey() })}`;
  const r = await fetch(url, { signal });
  if (r.status === 429) throw new Error(`NASA API hourly limit reached${apiKey() === 'DEMO_KEY' ? ' for the shared DEMO_KEY' : ''}. Add a free api.nasa.gov key under the planning assumptions.`);
  if (!r.ok) throw new Error(`NASA DONKI ${r.status}`);
  const saved = r.headers.get('X-MartisDux-Offline') === '1';
  const text = await r.text();
  return { data: text.trim() ? JSON.parse(text) : [], saved };
}

let inflight = null;
export function loadSpaceWeather(options = {}) {
  if (!inflight || options.force) inflight = fetchSpaceWeather(options).finally(() => setTimeout(() => { inflight = null; }, 60000));
  return inflight;
}
async function fetchSpaceWeather({ force = false } = {}) {
  const cached = store.get(CACHE);
  if (!force && cached && Date.now() - cached.fetched < 3600000) return { ...cached, live: true, cached: true };
  if (navigator.onLine === false) return cached ? { ...cached, live: false, cached: true } : { error: 'Offline: no space weather saved yet.' };
  const now = new Date(), params = { startDate: iso(new Date(now - 30 * DAY)), endDate: iso(new Date(now.getTime() + 7 * DAY)) };
  const signal = AbortSignal.timeout(20000);
  try {
    const cme = await getJson('CME', params, signal);
    if (cme.saved) return cached ? { ...cached, live: false, cached: true } : { error: 'Offline: no space weather saved yet.' };
    const result = { fetched: Date.now(), arrivals: marsArrivals(cme.data), cmeCount: cme.data.length,
    };
    store.set(CACHE, result);
    return { ...result, live: true, cached: false };
  } catch (error) {
    return cached ? { ...cached, live: false, cached: true, error: error.message } : { error: error.message };
  }
}

export function setApiKey(key) { try { key ? localStorage.setItem(KEY_STORE, key.trim()) : localStorage.removeItem(KEY_STORE); localStorage.removeItem(CACHE); } catch { } }
