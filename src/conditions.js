const LIVE = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';
const num = v => { const n = Number(v); return v === '--' || v === '' || v == null || !Number.isFinite(n) ? null : n; };

export function climateAt(data, ls) {
  const bin = Math.floor((((ls % 360) + 360) % 360) / data.binDegrees) * data.binDegrees;
  return data.climate.find(c => c.ls === bin) ?? null;
}

export const dustSeason = ls => (((ls % 360) + 360) % 360) >= 180;

export function jezeroVsGale(shared) {
  if (!shared?.length) return null;
  const mean = f => shared.reduce((s, r) => s + f(r), 0) / shared.length;
  return { sols: shared.length, night: mean(r => r.jezero.airMin - r.gale.airMin), day: mean(r => r.jezero.airMax - r.gale.airMax),
    from: shared[0].date, to: shared.at(-1).date };
}

const latestFrom = soles => {
  const rows = soles.map(s => ({ date: s.terrestrial_date, sol: Number(s.sol), ls: num(s.ls), airMin: num(s.min_temp), airMax: num(s.max_temp),
    groundMin: num(s.min_gts_temp), groundMax: num(s.max_gts_temp), pressure: num(s.pressure), uv: s.local_uv_irradiance_index !== '--' ? s.local_uv_irradiance_index : null }))
    .filter(r => r.airMin !== null && r.airMax !== null).sort((a, b) => b.sol - a.sol);
  return rows[0] ?? null;
};

export function createConditions() {
  let data = null, latest = null, live = false;
  const ready = fetch('data/weather/conditions.json').then(r => r.json()).then(d => {
    data = d; latest = latestFrom(d.latest.map(r => ({ terrestrial_date: r.date, sol: r.sol, ls: r.ls, min_temp: r.airMin, max_temp: r.airMax,
      min_gts_temp: r.groundMin, max_gts_temp: r.groundMax, pressure: r.pressure, local_uv_irradiance_index: r.uv ?? '--' })));
  });
  const refresh = () => navigator.onLine === false ? Promise.resolve() : fetch(LIVE, { cache: 'no-cache' })
    .then(r => r.ok ? r.json().then(json => ({ json, saved: r.headers.get('X-MartisDux-Offline') === '1' })) : Promise.reject(new Error(r.status)))
    .then(({ json, saved }) => { const row = latestFrom(json.soles ?? []); if (row && (!latest || row.sol >= latest.sol)) { latest = row; live = !saved; } })
    .catch(() => {});
  const liveReady = ready.then(refresh);
  return {
    ready, liveReady,
    get data() { return data; }, get latest() { return latest; }, get live() { return live; },
  };
}

const UV = { Low: 'low', Moderate: 'moderate', High: 'high', Very_High: 'very high' };
const range = (s, unit = ' °C') => s ? `${Math.round(s.p10)} to ${Math.round(s.p90)}${unit}` : '—';

export function describe(conditions, ls) {
  const d = conditions.data; if (!d) return null;
  const c = climateAt(d, ls), cmp = jezeroVsGale(d.jezero.sharedSols), latest = conditions.latest;
  const uvTop = c && Object.entries(c.uv).sort((a, b) => b[1] - a[1])[0];
  return {
    season: c && {
      title: `Ls ${Math.round(ls)}° · measured over ${c.years} Earth years (${c.sols} sols)`,
      air: `Air ${range(c.airMin)} at night, ${range(c.airMax)} by day`,
      ground: `Ground ${range(c.groundMin)} at night, ${range(c.groundMax)} by day`,
      pressure: c.pressure ? `Pressure ~${Math.round(c.pressure.median)} Pa (about 0.8% of Earth's)` : '',
      uv: uvTop ? `UV most often ${UV[uvTop[0]] ?? uvTop[0]} (${Math.round(uvTop[1] * 100)}% of sols)` : '',
    },
    dust: dustSeason(ls),
    latest: latest && {
      title: `${conditions.live ? 'Live from NASA' : 'Saved copy (offline)'} · Curiosity sol ${latest.sol}, ${latest.date}`,
      text: `Air ${Math.round(latest.airMin)} to ${Math.round(latest.airMax)} °C${latest.groundMin !== null ? `, ground ${Math.round(latest.groundMin)} to ${Math.round(latest.groundMax)} °C` : ''}${latest.pressure ? `, ${Math.round(latest.pressure)} Pa` : ''}${latest.uv ? `, UV ${UV[latest.uv] ?? latest.uv}` : ''}.`,
    },
    jezero: cmp && `Gale is ~3,750 km away and 1.9 km lower. On the ${cmp.sols} sols both rovers reported (${cmp.from} to ${cmp.to}), Jezero's air was ${Math.abs(Math.round(cmp.night))} °C ${cmp.night < 0 ? 'colder' : 'warmer'} at night and ${Math.abs(Math.round(cmp.day))} °C ${cmp.day < 0 ? 'colder' : 'warmer'} by day.`,
  };
}
