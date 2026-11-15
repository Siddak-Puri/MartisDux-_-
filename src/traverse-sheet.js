import { formatDuration } from './eva.js';
import { formatLocalTime, missionSol } from './mars-time.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const metres = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const rad = Math.PI / 180, R = 3396190;

function routeSvg(samples, stations) {
  const lat0 = samples[0].lat, lon0 = samples[0].lon, k = Math.cos(lat0 * rad);
  const xy = p => [(p.lon - lon0) * rad * R * k, (p.lat - lat0) * rad * R];
  const pts = samples.map(xy), all = pts.concat(stations.map(xy));
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 640, H = 340, pad = 40, span = Math.max(maxX - minX, (maxY - minY) * W / H, 50);
  const s = (W - 2 * pad) / span, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const P = ([x, y]) => [W / 2 + (x - cx) * s, H / 2 - (y - cy) * s];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${P(p).map(v => v.toFixed(1)).join(' ')}`).join('');
  const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find(v => v * s > 70) ?? 10000;
  const base = P(pts[0]);
  const marks = stations.map(st => { const [x, y] = P(xy(st)); return `<g><circle cx="${x}" cy="${y}" r="11" fill="#ffd36b" stroke="#120b07"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700">${st.n}</text></g>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="sheet-map" role="img" aria-label="Plan view of the traverse">
    <rect width="${W}" height="${H}" fill="#f6efe4"/>
    <path d="${path}" fill="none" stroke="#e8772e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <g><rect x="${base[0] - 9}" y="${base[1] - 9}" width="18" height="18" fill="#120b07"/><text x="${base[0] + 14}" y="${base[1] + 4}" font-size="11" font-weight="700">BASE</text></g>
    ${marks}
    <g transform="translate(${W - 34} 40)"><path d="M0 -18 7 4 0 -1 -7 4Z" fill="#120b07"/><text y="18" text-anchor="middle" font-size="11" font-weight="700">N</text></g>
    <g transform="translate(${pad} ${H - 18})"><rect width="${nice * s}" height="5" fill="#120b07"/><text y="-5" font-size="10">${metres(nice)}</text></g>
  </svg>`;
}

function profileSvg(samples, stations) {
  const z = samples.map(p => p.z).filter(Number.isFinite);
  if (z.length < 2) return '';
  const W = 640, H = 110, total = samples.at(-1).d || 1, lo = Math.min(...z), hi = Math.max(...z), dz = Math.max(hi - lo, 5);
  const X = d => 30 + d / total * (W - 40), Y = v => 12 + (hi - v) / dz * (H - 34);
  const line = samples.filter(p => Number.isFinite(p.z)).map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)} ${Y(p.z).toFixed(1)}`).join('');
  const marks = stations.map(st => `<g><line x1="${X(st.d)}" x2="${X(st.d)}" y1="8" y2="${H - 22}" stroke="#c9a14a" stroke-dasharray="3 3"/><text x="${X(st.d)}" y="${H - 8}" text-anchor="middle" font-size="10" font-weight="700">${st.n}</text></g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="sheet-profile" role="img" aria-label="Elevation profile"><path d="${line}" fill="none" stroke="#120b07" stroke-width="2"/>${marks}
    <text x="2" y="16" font-size="9">${Math.round(hi)} m</text><text x="2" y="${H - 24}" font-size="9">${Math.round(lo)} m</text></svg>`;
}

export function createTraverseSheet({ marswalk, routes, notify }) {
  const dialog = $('sheet-dialog'), body = $('sheet-body');
  function open() {
    const s = marswalk.sheet(), state = routes.getState();
    if (!s?.plan || !state.profile) { notify('Plan a walk first.'); return; }
    const { plan: p, stations, travel, params, risk, sun, day, startHour } = s;
    const samples = state.profile.samples, now = new Date();
    const end = startHour + p.total / 3698.97;
    const verdict = s.ok ? 'GO' : 'NO-GO';
    const rows = stations.map(st => `<tr><td class="n">${st.n}</td><td><b>${esc(st.name)}</b><br>${esc(st.task)}${st.sol ? ` (Perseverance cored here, sol ${st.sol})` : ''}${st.unit ? `<br><i>${esc(st.unit.label)}</i> ${esc(st.unit.notes)}` : ''}</td>
      <td>${formatLocalTime(startHour + st.arrive / 3698.97)}<br><small>+${formatDuration(st.arrive)}</small></td><td>${metres(st.d)}</td><td>${st.home == null ? '—' : formatDuration(st.home)}</td>
      <td>${st.photoSrc ? `<img src="${esc(st.photoSrc)}" alt="" referrerpolicy="no-referrer">` : ''}</td></tr>`).join('');
    const rules = [
      `Walkback limit: ${p.noReturn ? `do not pass ${metres(p.noReturn.d)}` : 'every point of this traverse is within walking distance of base'}${travel === 'rover' ? ' if the rover fails' : ''}.`,
      `Worst walk-back margin: ${Number.isFinite(p.worstMargin) ? formatDuration(p.worstMargin) : '—'} · farthest point is ${formatDuration(p.maxToBase)} walk from base.`,
      `Reserve ${params.reserveMinutes} min is never planned into. Suit time ${params.budgetHours} h.`,
      day.start != null ? `Usable daylight ${formatLocalTime(day.start)}–${formatLocalTime(day.end)} local solar time. Back at base by ${formatLocalTime(end)}.` : 'No usable daylight on this sol.',
      `Solar storms: ${risk ? { clear: 'none forecast during the traverse', caution: 'glancing CME near the traverse window', nogo: 'CME DUE: stay near shelter' }[risk.level] : 'forecast unavailable'} (NASA DONKI).`,
    ];
    body.innerHTML = `
      <header class="sheet-head"><div><p>MARTISDUX · TRAVERSE SHEET</p><h2>${esc(state.start.name || 'Base')} → ${esc(state.destination.name || 'Destination')}</h2></div><b class="sheet-verdict" data-ok="${s.ok}">${verdict}</b></header>
      <p class="sheet-meta">${travel === 'rover' ? 'By rover' : 'On foot'} · Depart ${formatLocalTime(startHour)} local · Perseverance sol ${missionSol('perseverance', now)} · Ls ${sun.ls.toFixed(0)}° · saved ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
      <dl class="sheet-stats"><div><dt>Distance</dt><dd>${metres(state.distance)}</dd></div><div><dt>Round trip</dt><dd>${formatDuration(p.total)}</dd></div><div><dt>Spare</dt><dd>${formatDuration(p.margin)}</dd></div><div><dt>Steepest</dt><dd>${state.profile.maxSlope.toFixed(0)}°</dd></div><div><dt>Oxygen</dt><dd>${(p.oxygen / 1000).toFixed(1)} kg</dd></div><div><dt>Dose</dt><dd>${p.dose.toFixed(2)} mSv</dd></div></dl>
      ${routeSvg(samples, stations)}
      ${profileSvg(samples, stations)}
      <table class="sheet-table"><thead><tr><th>#</th><th>Station · task · rock unit</th><th>Arrive</th><th>Out</th><th>Walk home</th><th>Ground</th></tr></thead><tbody>${rows}</tbody></table>
      <h3>Safety limits</h3><ul class="sheet-rules">${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="sheet-foot">Route: safest path on NASA/USGS HiRISE elevation, slope map checked against Perseverance's measured tilt. Geology: USGS. Photos: NASA/JPL-Caltech. Planning estimates, not flight rules.</p>`;
    dialog.showModal();
  }
  $('sheet-open').addEventListener('click', open);
  $('sheet-close').addEventListener('click', () => dialog.close());
  $('sheet-save').addEventListener('click', async () => {
    const button = $('sheet-save'); button.disabled = true;
    try {
      const r = await fetch('/__save-sheet', { method: 'POST' }), out = r.ok ? await r.json() : null;
      if (!out?.file) throw new Error('unavailable');
      dialog.close(); notify(`Saved to your Desktop: ${out.file}`, 7000);
    } catch { dialog.close(); notify('Could not save the sheet. Saving works in the MartisDux desktop app.', 6000); }
    finally { button.disabled = false; }
  });
  return { open };
}
