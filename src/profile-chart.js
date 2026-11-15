import { slopeClass } from './hazards.js';
import { formatRouteDistance } from './route-geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 300, H = 96, PAD = { l: 4, r: 4, t: 10, b: 16 };
const CLASS_COLOR = { easy: '#fef3e2', caution: 'rgb(244 196 92)', steep: 'rgb(255 120 48)', nogo: '#ff5a3c' };
const el = (name, attrs = {}) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const metres = z => `${Math.round(z).toLocaleString()} m`;

export function createProfileChart(container, { label = 'Elevation profile along the route' } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  const tip = document.createElement('div'); tip.className = 'profile-tip'; tip.hidden = true;
  const caption = document.createElement('div'); caption.className = 'profile-axis';
  container.replaceChildren(svg, tip, caption);
  let samples = [], sx = () => 0, sy = () => 0, marker = null, hover = null;

  function render(profile) {
    samples = (profile?.samples ?? []).filter(p => Number.isFinite(p.z));
    svg.replaceChildren();
    container.hidden = samples.length < 2;
    if (samples.length < 2) return;
    const total = samples.at(-1).d || 1;
    let lo = Infinity, hi = -Infinity;
    for (const p of samples) { lo = Math.min(lo, p.z); hi = Math.max(hi, p.z); }
    const pad = Math.max(5, (hi - lo) * .08); lo -= pad; hi += pad;
    sx = d => PAD.l + (W - PAD.l - PAD.r) * d / total;
    sy = z => PAD.t + (H - PAD.t - PAD.b) * (1 - (z - lo) / (hi - lo));
    svg.append(el('line', { x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b, class: 'profile-base' }));
    const area = samples.map((p, i) => `${i ? 'L' : 'M'}${sx(p.d).toFixed(1)},${sy(p.z).toFixed(1)}`).join('') + `L${sx(total).toFixed(1)},${H - PAD.b}L${sx(0).toFixed(1)},${H - PAD.b}Z`;
    svg.append(el('path', { d: area, class: 'profile-area' }));
    let run = null;
    const flush = () => { if (run && run.pts.length > 1) svg.append(el('path', { d: run.pts.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(''), class: 'profile-line', stroke: CLASS_COLOR[run.id] })); };
    for (const p of samples) {
      const id = Number.isFinite(p.slope) ? slopeClass(p.slope).id : 'easy', pt = `${sx(p.d).toFixed(1)},${sy(p.z).toFixed(1)}`;
      if (!run || run.id !== id) { const last = run?.pts.at(-1); flush(); run = { id, pts: last ? [last, pt] : [pt] }; }
      else run.pts.push(pt);
    }
    flush();
    hover = el('g', { class: 'profile-hover', visibility: 'hidden' });
    hover.append(el('line', { y1: PAD.t - 4, y2: H - PAD.b }), el('circle', { r: 3.5 }));
    marker = el('g', { class: 'profile-marker', visibility: 'hidden' });
    marker.append(el('line', { y1: PAD.t - 4, y2: H - PAD.b }), el('circle', { r: 4 }));
    svg.append(hover, marker);
    caption.innerHTML = `<span>${metres(hi - pad)} high · ${metres(lo + pad)} low</span><span>${formatRouteDistance(total)}</span>`;
  }

  const nearest = d => samples.reduce((m, p) => Math.abs(p.d - d) < Math.abs(m.d - d) ? p : m, samples[0]);
  function place(group, p) {
    const x = sx(p.d), y = sy(p.z);
    group.querySelector('line').setAttribute('x1', x); group.querySelector('line').setAttribute('x2', x);
    group.querySelector('circle').setAttribute('cx', x); group.querySelector('circle').setAttribute('cy', y);
    group.setAttribute('visibility', 'visible');
  }
  svg.addEventListener('pointermove', e => {
    if (samples.length < 2) return;
    const box = svg.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * W;
    const total = samples.at(-1).d, p = nearest(Math.max(0, Math.min(total, (x - PAD.l) / (W - PAD.l - PAD.r) * total)));
    place(hover, p);
    const cls = Number.isFinite(p.slope) ? slopeClass(p.slope) : null;
    tip.textContent = `${formatRouteDistance(p.d)} · ${metres(p.z)} · ${cls ? `${p.slope.toFixed(0)}° ${cls.label}` : 'slope unmapped'}`;
    tip.hidden = false;
    const x0 = e.clientX - box.left - tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(0, x0), box.width - tip.offsetWidth)}px`;
  });
  svg.addEventListener('pointerleave', () => { hover?.setAttribute('visibility', 'hidden'); tip.hidden = true; });

  return {
    render,
    mark(d) { if (marker && samples.length > 1) place(marker, nearest(d)); },
  };
}
