import {
  ASPECT, META, PLACES, SAMPLES, formatElevation, formatLonLat, heightAt, lookup, sampleGrid, thin, toLonLat, traverse,
} from '../terrain/region.js';
import { contourSet, svgEl } from '../terrain/contours.js';
import { smoothPath } from '../util/path.js';
import { hatchRaster, slopeGrid } from '../terrain/slope.js';

// The map of Jezero crater. Terrain is the USGS CTX elevation model, the
// routes are Perseverance's actual drives, and the sites and samples are
// placed where the rover was on the sol NASA records for them.

// Map layers, in the same order as the layer tabs (L1–L4) above the map.
const LAYERS = [
  { key: 'relief', label: 'L1 · Terrain & elevation' },
  { key: 'route', label: 'L2 · Routes & terrain context' },
  { key: 'sites', label: 'L3 · Scientific points of interest' },
  { key: 'hazard', label: 'L4 · Environment & hazards' },
];

const VB_W = 1600;
const VB_H = 900;
const COLS = 'ABCDEFGH';
const ROWS = 5;
const START = PLACES.landing.at;
const STEEP_DEGREES = 15;

// Four places Perseverance actually went, in the order it reached them.
const SITES = [
  {
    id: 'seitah',
    num: '01',
    name: 'Séítah',
    type: 'Caution · sand ripples',
    caution: true,
    place: PLACES.seitah,
    text: 'Ridges and rippled sand on the crater floor, where the rover spent months coring igneous rock. Crossing one sandy ripple it measured 65.5% wheel slip, above the team’s 60% limit, so later drives planned around the ripples.',
    data: 'Sol 200: entered South Séítah. Samples sealed here: Montdenier to Malay (sols 194–337).',
  },
  {
    id: 'delta',
    num: '02',
    name: 'Delta front',
    type: 'Geology · sedimentary layers',
    place: PLACES.delta,
    text: 'The base of the fan of sediment an ancient river built out into Jezero’s lake. Fine-grained layered rock like this is among the best places to look for signs of past life.',
    data: 'Sols 490–516: Skinner Ridge and Wildcat Ridge sedimentary cores (Swift Run, Skyland, Hazeltop, Bearwallow).',
  },
  {
    id: 'neretva',
    num: '03',
    name: 'Neretva Vallis',
    type: 'Landforms · past water',
    place: PLACES.neretva,
    text: 'An ancient river valley that carried water into the crater. In its “Bright Angel” outcrops the rover cored Cheyava Falls (“Sapphire Canyon”), which NASA says holds a potential biosignature that still needs further study.',
    data: 'Sol 1215 (21 July 2024): Sapphire Canyon core sealed.',
  },
  {
    id: 'rim',
    num: '04',
    name: 'Lookout Hill',
    type: 'Viewpoint · crater rim',
    place: PLACES.rim,
    text: 'The top of Jezero’s rim, reached on 10 December 2024 after a climb of about three and a half months and 500 vertical metres. From here the rover got its first view out of the crater.',
    data: 'Sol 1354: top of the rim. Next stop, Witch Hazel Hill, just over the crest.',
  },
].map((site) => ({ ...site, at: site.place.at, route: thin(traverse(0, site.place.sol), 0.006) }));

const RAMP = [
  [0, [26, 15, 14]],
  [0.25, [62, 32, 20]],
  [0.5, [112, 58, 28]],
  [0.72, [168, 96, 42]],
  [0.88, [214, 148, 86]],
  [1, [240, 206, 160]],
];

function ramp(t) {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((c, n) => c + (c1[n] - c) * k);
    }
  }
  return RAMP[RAMP.length - 1][1];
}

const toVB = ([x, y]) => [(x / ASPECT) * VB_W, y * VB_H];

function renderRelief(canvas, grid) {
  const w = 768;
  const h = 432;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const ex = 1 / w;
  const ey = 1 / h;
  // Real metres per pixel, so the shading reflects true slopes.
  const span = grid.maxM - grid.minM;
  const mx = (grid.cellXm * (grid.cols - 1)) / w;
  const my = (grid.cellYm * (grid.rows - 1)) / h;
  // Light from the north-west, as on a traditional shaded-relief map.
  const L = [-0.62, -0.62, 0.48];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      const hgt = lookup(grid, u, v);
      const dx = (((lookup(grid, u + ex, v) - lookup(grid, u - ex, v)) * span) / (2 * mx)) * 2.5;
      const dy = (((lookup(grid, u, v + ey) - lookup(grid, u, v - ey)) * span) / (2 * my)) * 2.5;
      const len = Math.hypot(dx, dy, 1);
      const lambert = Math.max(0, (-dx * L[0] - dy * L[1] + L[2]) / len);
      const shade = 0.5 + lambert * 0.72;
      const [r, g, b] = ramp(hgt);
      const k = (y * w + x) * 4;
      img.data[k] = Math.min(255, r * shade);
      img.data[k + 1] = Math.min(255, g * shade);
      img.data[k + 2] = Math.min(255, b * shade);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawOverlay(svg, grid) {
  const contours = svgEl('g', { class: 'map-contours' }, svg);
  contourSet(grid, { count: 20, width: VB_W, height: VB_H, indexEvery: 4 }).forEach((c) => {
    svgEl('path', { d: c.d, class: c.index ? 'map-contour map-contour--index' : 'map-contour' }, contours);
  });

  const g = svgEl('g', { class: 'map-grid' }, svg);
  for (let i = 1; i < COLS.length; i++) svgEl('line', { x1: i * 200, y1: 0, x2: i * 200, y2: VB_H }, g);
  for (let j = 1; j < ROWS; j++) svgEl('line', { x1: 0, y1: j * 180, x2: VB_W, y2: j * 180 }, g);
  COLS.split('').forEach((c, i) => {
    svgEl('text', { x: i * 200 + 100, y: VB_H - 14, 'text-anchor': 'middle' }, g).textContent = c;
  });
  for (let j = 0; j < ROWS; j++) {
    svgEl('text', { x: VB_W - 14, y: j * 180 + 96, 'text-anchor': 'end' }, g).textContent = String(j + 1);
  }
}

/** Elevation profile along the route, in real metres. */
function profilePath(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    segs.push(len);
    total += len;
  }
  const n = 96;
  const samples = [];
  for (let s = 0; s < n; s++) {
    let dist = (total * s) / (n - 1);
    let i = 0;
    while (i < segs.length - 1 && dist > segs[i]) dist -= segs[i++];
    const t = Math.min(1, dist / (segs[i] || 1));
    const x = points[i][0] + (points[i + 1][0] - points[i][0]) * t;
    const y = points[i][1] + (points[i + 1][1] - points[i][1]) * t;
    samples.push(heightAt(x, y));
  }
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const span = Math.max(hi - lo, 40);
  const pts = samples.map((v, i) => [(i / (n - 1)) * 300, 52 - ((v - lo) / span) * 44]);
  const line = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`;
  return { line, area: `${line}L300 56L0 56Z`, lo, hi };
}

function drawHazard(svg) {
  const slopes = slopeGrid(sampleGrid(192, 108));
  svgEl('image', {
    href: hatchRaster(slopes, STEEP_DEGREES, 800, 450, { spacing: 7, alpha: 215 }),
    width: VB_W,
    height: VB_H,
    preserveAspectRatio: 'none',
  }, svg);
  // Séítah: drawn around the rover's own positions during its ripple campaign
  // (sols 200–380), dashed so it reads as an approximate zone, not a boundary.
  const zone = PLACES.seitah.zone;
  const [cx, cy] = toVB([zone.x, zone.y]);
  const rx = (zone.rx / ASPECT) * VB_W;
  const ry = zone.ry * VB_H;
  svgEl('ellipse', { cx, cy, rx, ry, class: 'map-hazard-edge' }, svg);
  svgEl('text', { x: cx, y: cy + ry + 30, 'text-anchor': 'middle', class: 'map-hazard-label' }, svg).textContent = 'Séítah ripples';
}

const gridRef = (u, v) => `${COLS[Math.min(7, Math.max(0, Math.floor(u * 8)))]}${Math.min(ROWS, Math.max(1, Math.floor(v * ROWS) + 1))}`;

export function initExplorer(root) {
  if (!root) return;
  const frame = root.querySelector('.map__frame');
  const markers = root.querySelector('[data-map-markers]');
  const panel = root.querySelector('[data-map-panel]');
  const readout = root.querySelector('[data-map-readout]');
  const routeSvg = root.querySelector('[data-map-route]');

  const grid = sampleGrid(384, 216);
  renderRelief(root.querySelector('[data-map-relief]'), grid);
  drawOverlay(root.querySelector('[data-map-overlay]'), sampleGrid(240, 135));
  drawHazard(root.querySelector('[data-map-hazard]'));

  // Route layers: the whole drive faintly, then the selected leg on top.
  routeSvg.replaceChildren();
  svgEl('path', { class: 'map__route-all', d: smoothPath(thin(traverse(), 0.004).map(toVB)) }, routeSvg);
  const halo = svgEl('path', { class: 'map__route-halo' }, routeSvg);
  const path = svgEl('path', { class: 'map__route-path', pathLength: 1 }, routeSvg);
  const waypoints = svgEl('g', {}, routeSvg);

  const landing = markers.querySelector('.map__landing');
  landing.style.setProperty('--x', (START[0] / ASPECT).toFixed(4));
  landing.style.setProperty('--y', START[1].toFixed(4));

  // Every sample core sealed inside the mapped area, as small diamonds.
  const seen = new Set();
  SAMPLES.forEach((s) => {
    const key = s.at.join();
    if (seen.has(key)) return; // paired cores from one spot share a mark
    seen.add(key);
    const dot = document.createElement('span');
    dot.className = 'map__sample';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.setProperty('--x', (s.at[0] / ASPECT).toFixed(4));
    dot.style.setProperty('--y', s.at[1].toFixed(4));
    markers.prepend(dot);
  });

  const buttons = SITES.map((site) => {
    const button = document.createElement('button');
    button.type = 'button';
    // Labels on the east half open leftward, clear of the overview panel.
    const east = site.at[0] / ASPECT > 0.55;
    button.className = `map__marker${site.caution ? ' map__marker--caution' : ''}${east ? ' map__marker--left' : ''}`;
    button.dataset.site = site.id;
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--x', (site.at[0] / ASPECT).toFixed(4));
    button.style.setProperty('--y', site.at[1].toFixed(4));
    button.innerHTML = `
      <span class="map__marker-dot" aria-hidden="true"></span>
      <span class="visually-hidden">Site ${site.num}: ${site.name}${site.caution ? ' (caution)' : ''}</span>
      <span class="map__marker-label" aria-hidden="true">${site.num}<span class="map__marker-name"> · ${site.name}</span></span>`;
    button.addEventListener('click', () => select(site.id, { announce: true }));
    button.addEventListener('focus', () => showReadout(site.at[0] / ASPECT, site.at[1]));
    markers.appendChild(button);
    return button;
  });

  let selected = null;

  function select(id, { announce = false } = {}) {
    const site = SITES.find((s) => s.id === id);
    if (!site) return;
    selected = site;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.site === id)));

    const pts = site.route;
    const d = smoothPath(pts.map(toVB));
    halo.setAttribute('d', d);
    path.setAttribute('d', d);
    path.classList.remove('is-drawn');
    // Restart the draw-on transition.
    void path.getBoundingClientRect();
    path.classList.add('is-drawn');
    waypoints.replaceChildren();
    // Samples collected on the way there.
    const done = new Set();
    SAMPLES.filter((s) => s.sol <= site.place.sol).forEach((s) => {
      const key = s.at.join();
      if (done.has(key)) return;
      done.add(key);
      const [x, y] = toVB(s.at);
      svgEl('circle', { cx: x, cy: y, r: 5, class: 'map__waypoint' }, waypoints);
    });

    const profile = profilePath(pts);
    const u = site.at[0] / ASPECT;
    const v = site.at[1];
    const p = site.place;
    panel.setAttribute('aria-live', announce ? 'polite' : 'off');
    panel.innerHTML = `
      <p class="mono mono--s map__panel-kicker">Site ${site.num} · Sol ${p.sol} · ${p.driven_km.toLocaleString('en-US')} km driven</p>
      <h3 class="h3 map__panel-title">${site.name}</h3>
      <p class="mono mono--s map__panel-type">${site.type}</p>
      <p class="map__panel-text">${site.text}</p>
      <dl class="map__panel-meta">
        <div><dt class="mono mono--s">NASA record</dt><dd>${site.data}</dd></div>
        <div><dt class="mono mono--s">Elevation along the rover’s route · ${formatElevation(profile.lo)} to ${formatElevation(profile.hi)}</dt>
          <dd><svg class="map__profile" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
            <path class="map__profile-area" d="${profile.area}" /><path class="map__profile-line" d="${profile.line}" />
          </svg></dd></div>
      </dl>`;
    showReadout(u, v);
  }

  function showReadout(u, v) {
    const x = u * ASPECT;
    readout.textContent = `${gridRef(u, v)} · ${formatLonLat(toLonLat(x, v))} · ${formatElevation(heightAt(x, v))}`;
  }

  frame.addEventListener('pointermove', (e) => {
    // The markers layer always spans the whole map, even where phones crop it.
    const r = markers.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) showReadout(u, v);
  });
  frame.addEventListener('pointerleave', () => {
    if (selected) showReadout(selected.at[0] / ASPECT, selected.at[1]);
  });

  // Layer chips: each one switches a real map layer on or off.
  const toggles = new Map([...root.querySelectorAll('[data-map-toggle]')].map((input) => [input.dataset.mapToggle, input]));
  const setLayer = (key, on) => {
    root.toggleAttribute(`data-${key}`, on);
    const input = toggles.get(key);
    if (input) input.checked = on;
  };
  toggles.forEach((input, key) => input.addEventListener('change', () => setLayer(key, input.checked)));
  toggles.forEach((input, key) => root.toggleAttribute(`data-${key}`, input.checked));

  // The layer tabs above the map put one layer in focus: it is switched on
  // and the others step back, so the map shows what that layer contributes.
  const focusLabel = root.querySelector('[data-map-focus]');
  const focusLayer = (index) => {
    const layer = LAYERS[index];
    if (!layer) return;
    setLayer(layer.key, true);
    root.dataset.focus = layer.key;
    focusLabel.textContent = `Highlighting ${layer.label}`;
  };
  document.addEventListener('layerfocus', (e) => focusLayer(e.detail.index));
  root.addEventListener('change', (e) => {
    // Changing chips by hand returns the map to an even view.
    if (e.target.matches('[data-map-toggle]')) {
      delete root.dataset.focus;
      focusLabel.textContent = 'Showing selected layers';
    }
  });

  // Start with the longest real route drawn so the map reads as a map straight away.
  select('rim');
}

export { META };
