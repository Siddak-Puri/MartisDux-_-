import { PLACES, SAMPLES, lookup, sampleGrid, thin, traverse } from '../terrain/region.js';
import { contourSet, svgEl } from '../terrain/contours.js';
import { smoothPath } from '../util/path.js';
import { hatchRaster, slopeGrid } from '../terrain/slope.js';

// Section 02: the western floor of Jezero crater drawn as four layers in an
// exploded stack, driven by an accessible tablist. A 9.5 km square from the
// landing site to Neretva Vallis; terrain, route and sites are real data.

const SIZE = 400;
const CROP = { x0: 0.6, y0: 0, x1: 1.6, y1: 1 };
const STEEP_DEGREES = 15;
const toPx = ([x, y]) => [(x - CROP.x0) * SIZE, (y - CROP.y0) * SIZE];

// Warm dark ramp for the dark module panel (low → high)
const RAMP = [
  [0, [34, 20, 13]],
  [0.3, [78, 41, 22]],
  [0.55, [138, 72, 31]],
  [0.78, [196, 120, 52]],
  [1, [240, 204, 156]],
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

function rasterTerrain(grid) {
  const n = 220;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  const e = 1 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / (n - 1);
      const v = y / (n - 1);
      const h = lookup(grid, u, v);
      // Simple hillshade from the north-west.
      const dx = lookup(grid, u + e, v) - lookup(grid, u - e, v);
      const dy = lookup(grid, u, v + e) - lookup(grid, u, v - e);
      const shade = Math.max(0.62, Math.min(1.25, 1 - (dx + dy) * 11));
      const [r, g, b] = ramp(h);
      const k = (y * n + x) * 4;
      img.data[k] = r * shade;
      img.data[k + 1] = g * shade;
      img.data[k + 2] = b * shade;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function label(svg, num, text) {
  const g = svgEl('g', { transform: 'translate(16 30)', class: 'plane-tag' }, svg);
  svgEl('text', { class: 'plane-label plane-label--num', x: 0, y: 0 }, g).textContent = num;
  svgEl('text', { class: 'plane-label', x: 34, y: 0 }, g).textContent = text;
}

function drawPlanes(planes) {
  const grid = sampleGrid(110, 110, CROP);
  const contours = contourSet(grid, { count: 12, width: SIZE, height: SIZE, indexEvery: 99 });

  // L1 — terrain & elevation
  const terrain = planes.terrain;
  svgEl('image', { href: rasterTerrain(grid), width: SIZE, height: SIZE, preserveAspectRatio: 'none' }, terrain);
  contours.forEach((c) => svgEl('path', { d: c.d, class: 'plane-contour' }, terrain));
  label(terrain, 'L1', 'Elevation');

  // L2 — route & terrain context: Perseverance's drive from landing to Neretva Vallis
  const routes = planes.routes;
  contours.forEach((c) => svgEl('path', { d: c.d, class: 'plane-contour plane-contour--ghost' }, routes));
  const route = thin(traverse(0, PLACES.neretva.sol), 0.012).map(toPx);
  svgEl('path', { d: smoothPath(route), class: 'plane-route' }, routes);
  const ends = [route[0], route[route.length - 1]];
  ends.forEach(([x, y], i) => svgEl('circle', { cx: x, cy: y, r: i ? 8 : 7, class: `plane-waypoint${i ? ' plane-waypoint--end' : ''}` }, routes));
  // Short labels: the Sites layer names these places, and the planes can be combined.
  svgEl('text', { class: 'plane-poi-label', x: ends[0][0] + 14, y: ends[0][1] - 10 }, routes).textContent = 'A';
  svgEl('text', { class: 'plane-poi-label', x: ends[1][0] - 10, y: ends[1][1] - 14, 'text-anchor': 'end' }, routes).textContent = 'B';
  label(routes, 'L2', 'Route');

  // L3 — scientific points of interest: places the rover sampled
  const poi = planes.poi;
  const bunsen = SAMPLES.find((s) => s.feature === 'Bunsen Peak');
  const sites = [
    { at: PLACES.neretva.at, name: 'Neretva Vallis' },
    { at: bunsen.at, name: 'Bunsen Peak', below: true },
    { at: PLACES.delta.at, name: 'Delta front', left: true },
    { at: PLACES.landing.at, name: 'Landing site', left: true },
    { at: PLACES.seitah.at, name: 'Séítah', left: true, below: true },
  ];
  sites.forEach(({ at, name, left, below }) => {
    const [x, y] = toPx(at);
    svgEl('rect', { x: x - 7, y: y - 7, width: 14, height: 14, class: 'plane-poi', transform: `rotate(45 ${x} ${y})` }, poi);
    svgEl('text', { class: 'plane-poi-label', x: left ? x - 16 : x + 16, y: below ? y + 22 : y + 4, 'text-anchor': left ? 'end' : 'start' }, poi).textContent = name;
  });
  label(poi, 'L3', 'Sites');

  // L4 — environment & hazard context: real slopes of 15° or more
  const hazard = planes.hazard;
  const slopes = slopeGrid(sampleGrid(80, 80, CROP));
  svgEl('image', { href: hatchRaster(slopes, STEEP_DEGREES, SIZE, SIZE), width: SIZE, height: SIZE, preserveAspectRatio: 'none' }, hazard);
  const zone = PLACES.seitah.zone;
  const [dx, dy] = toPx([zone.x, zone.y]);
  svgEl('ellipse', { cx: dx, cy: dy, rx: zone.rx * SIZE * 1.4, ry: zone.ry * SIZE * 1.4, class: 'plane-hazard-edge' }, hazard);
  svgEl('text', { class: 'plane-poi-label', x: dx, y: dy - zone.ry * SIZE * 1.4 - 10, 'text-anchor': 'middle' }, hazard).textContent = 'Sand ripples';
  // Label the largest steep patch: the cell with the most steep neighbours.
  let best = 0;
  let at = [0.5, 0.5];
  for (let j = 2; j < slopes.rows - 2; j++) {
    for (let i = 2; i < slopes.cols - 2; i++) {
      let n = 0;
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) n += slopes.data[(j + b) * slopes.cols + i + a] >= STEEP_DEGREES;
      if (n > best) {
        best = n;
        at = [i / (slopes.cols - 1), j / (slopes.rows - 1)];
      }
    }
  }
  const sx = Math.min(at[0] * SIZE + 12, SIZE - 110);
  svgEl('text', { class: 'plane-poi-label', x: sx, y: at[1] * SIZE + 4 }, hazard).textContent = `Slopes ≥ ${STEEP_DEGREES}°`;
  label(hazard, 'L4', 'Hazards');
}

export function initLayers(root) {
  if (!root) return;
  const stack = root.querySelector('[data-stack]');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
  const modeButton = root.querySelector('[data-stack-mode]');

  drawPlanes({
    terrain: root.querySelector('[data-plane-svg="terrain"]'),
    routes: root.querySelector('[data-plane-svg="routes"]'),
    poi: root.querySelector('[data-plane-svg="poi"]'),
    hazard: root.querySelector('[data-plane-svg="hazard"]'),
  });

  function select(index, { focus = false } = {}) {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    stack.dataset.active = String(index);
    if (focus) tabs[index].focus();
    // Let the concept map below follow the chosen layer.
    root.dispatchEvent(new CustomEvent('layerfocus', { bubbles: true, detail: { index } }));
  }

  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i)));
  root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const moves = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let next = null;
    if (e.key in moves) next = (current + moves[e.key] + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(next, { focus: true });
  });

  // Mouse users can also pick a plane directly (the tabs remain the accessible control).
  stack.querySelectorAll('[data-plane]').forEach((plane) => {
    plane.addEventListener('click', () => select(Number(plane.dataset.plane)));
  });

  modeButton.addEventListener('click', () => {
    const combined = modeButton.getAttribute('aria-pressed') !== 'true';
    modeButton.setAttribute('aria-pressed', String(combined));
    stack.dataset.mode = combined ? 'combined' : 'exploded';
  });
}
