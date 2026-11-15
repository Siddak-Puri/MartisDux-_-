import { Cartesian2, Cartesian3, Color, ArcType, PointPrimitiveCollection, LabelCollection, LabelStyle, VerticalOrigin, DistanceDisplayCondition, PolylineOutlineMaterialProperty, NearFarScalar, Rectangle } from 'cesium';
import { loadRoverPosition, loadTraverse } from './rover-live.js';

const $ = id => document.getElementById(id);
const KEY = 'dtm16';
const errColor = e => e <= 2 ? '#7fb77e' : e <= 5 ? '#f4c45c' : '#e5533a';
const pct = v => `${Math.round(v * 100)}%`;
const svg = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export function scatterChart(rows, key = KEY, size = 220) {
  const pad = 26, max = 25, s = v => pad + (Math.min(v, max) / max) * (size - pad - 8);
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'truth-scatter', role: 'img',
    'aria-label': `Scatter plot of ${rows.length} waypoints: rover-measured tilt against orbital slope` });
  for (const t of [0, 5, 10, 15, 20, 25]) {
    root.append(svg('line', { x1: s(t), x2: s(t), y1: size - pad, y2: size - s(max), class: 'grid' }));
    root.append(svg('line', { y1: size - s(t), y2: size - s(t), x1: pad, x2: s(max), class: 'grid' }));
    const lx = svg('text', { x: s(t), y: size - pad + 12, 'text-anchor': 'middle' }); lx.textContent = t; root.append(lx);
    const ly = svg('text', { x: pad - 5, y: size - s(t) + 3, 'text-anchor': 'end' }); ly.textContent = t; root.append(ly);
  }
  root.append(svg('line', { x1: s(0), y1: size - s(0), x2: s(max), y2: size - s(max), class: 'identity' }));
  for (const r of rows) {
    const e = Math.abs(r[key] - r.tilt);
    root.append(svg('circle', { cx: s(r.tilt).toFixed(1), cy: (size - s(r[key])).toFixed(1), r: 2.1, fill: errColor(e), 'fill-opacity': .75 }));
  }
  const ax = svg('text', { x: size / 2 + pad / 2, y: size - 1, 'text-anchor': 'middle', class: 'axis' }); ax.textContent = 'Rover-measured tilt (°)';
  const ay = svg('text', { x: 9, y: size / 2 - pad / 2, 'text-anchor': 'middle', class: 'axis', transform: `rotate(-90 9 ${size / 2 - pad / 2})` }); ay.textContent = 'Slope from orbit (°)';
  root.append(ax, ay);
  return root;
}

export function createGroundTruth({ viewer, mars, terrain, notify, stopRotation, setPlacesCollapsed, reducedMotion }) {
  let data = null, loading = null, visible = false, points = null;
  const shown = [];

  async function load() {
    const bundled = name => fetch(`data/perseverance/${name}.json`).then(r => { if (!r.ok) throw new Error(name); return r.json(); });
    if (!loading) loading = Promise.all([bundled('validation'), bundled('routes'), loadTraverse('data/perseverance/traverse.json')])
      .then(([validation, routes, traverse]) => (data = { validation, routes, traverse }))
      .catch(error => { loading = null; throw error; });
    return loading;
  }

  function build() {
    const { validation, traverse } = data;
    const runs = [[]];
    for (const d of traverse.drives) for (const [lon, lat] of d.c) {
      const run = runs.at(-1), last = run.at(-1);
      if (last && Math.hypot((lon - last[0]) * 56000, (lat - last[1]) * 59000) > 60) runs.push([]);
      runs.at(-1).push([lon, lat]);
    }
    const material = new PolylineOutlineMaterialProperty({ color: Color.fromCssColorString('#fef3e2'), outlineColor: Color.fromCssColorString('#120b07'), outlineWidth: 1.5 });
    for (const run of runs) if (run.length > 1) shown.push(viewer.entities.add({ show: false, polyline: {
      positions: Cartesian3.fromDegreesArray(run.flat(), mars), width: 3.5, clampToGround: true, arcType: ArcType.GEODESIC, zIndex: 8, material } }));
    points = viewer.scene.primitives.add(new PointPrimitiveCollection({ show: false }));
    const outline = Color.fromCssColorString('#120b07'), scale = new NearFarScalar(500, 1.3, 60000, .55);
    for (const r of validation.rows) points.add({ id: `truth:${r.rmc}`,
      position: Cartesian3.fromDegrees(r.lon, r.lat, (terrain?.heightAt(r) ?? 0) + 1.5, mars),
      pixelSize: 7, color: Color.fromCssColorString(errColor(Math.abs(r[KEY] - r.tilt))), outlineColor: outline, outlineWidth: 1.5,
      scaleByDistance: scale, disableDepthTestDistance: 2e4 });
    renderPanel();
  }

  let rover = null;
  const roverPoints = viewer.scene.primitives.add(new PointPrimitiveCollection());
  const roverLabels = viewer.scene.primitives.add(new LabelCollection());
  function drawRover(r) {
    roverPoints.removeAll(); roverLabels.removeAll();
    const position = Cartesian3.fromDegrees(r.lon, r.lat, (terrain?.heightAt(r) ?? 0) + 3, mars), near = new DistanceDisplayCondition(0, 80000);
    roverPoints.add({ id: 'rover:now', position, pixelSize: 13, color: Color.fromCssColorString('#ff9c4c'), outlineColor: Color.fromCssColorString('#fef3e2'), outlineWidth: 3,
      distanceDisplayCondition: near, disableDepthTestDistance: 2e4 });
    roverLabels.add({ id: 'rover:now', position, text: `PERSEVERANCE · SOL ${r.sol}`, font: '600 11px "Martian Mono Variable"', fillColor: Color.fromCssColorString('#ffd2ad'),
      outlineColor: Color.fromCssColorString('#120b07'), outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -14), distanceDisplayCondition: near, disableDepthTestDistance: 2e4 });
    viewer.scene.requestRender();
  }
  function roverText() {
    if (!rover) return '';
    const when = rover.updated ? new Date(rover.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    return `Perseverance now: sol ${rover.sol}, ${(rover.dist / 1000).toFixed(1)} km driven. ${rover.live ? `Live from NASA MMGIS${when ? `, rover team update of ${when}` : ''}` : 'Saved copy (offline)'}.`;
  }
  fetch('data/perseverance/validation.json').then(r => r.json()).then(v => {
    const last = v.rows.reduce((a, b) => (b.sol > a.sol || (b.sol === a.sol && b.dist > a.dist) ? b : a));
    return loadRoverPosition({ sol: last.sol, lat: last.lat, lon: last.lon, dist: last.dist, updated: null });
  }).then(r => { if (!r) return; rover = r; drawRover(r); if (data) renderPanel(); }).catch(() => {});

  function renderPanel() {
    const { validation: v, routes } = data, f = v.footprints[KEY], corridorSteep = routes.corridor500m.steep + routes.corridor500m.nogo;
    const pathSteep = routes.roverPath.classShare.steep + routes.roverPath.classShare.nogo;
    $('truth-stats').innerHTML = `
      <div><strong>${f.mae.toFixed(1)}°</strong><span>mean error<br><small>no-skill guess ${v.baseline.mae.toFixed(1)}°</small></span></div>
      <div><strong>${f.pearson.toFixed(2)}</strong><span>correlation (r)<br><small>${f.n} waypoints</small></span></div>
      <div><strong>${pct(f.within5)}</strong><span>within 5°<br><small>${pct(f.within2)} within 2°</small></span></div>
      <div><strong>${Math.round(corridorSteep / Math.max(pathSteep, 1e-4))}×</strong><span>steep-ground avoidance<br><small>${(corridorSteep * 100).toFixed(1)}% nearby · ${(pathSteep * 100).toFixed(2)}% driven</small></span></div>`;
    $('truth-chart').replaceChildren(scatterChart(v.rows));
    $('truth-live').textContent = [roverText(), data.traverse.live ? 'Path: live from NASA.' : 'Path: saved copy.', `Statistics: ${v.compared} waypoints up to the ${v.generated} snapshot.`].filter(Boolean).join(' ');
    $('truth-note').textContent = `Perseverance drove ${(routes.roverPath.mappedMetres / 1000).toFixed(1)} km over our HiRISE slope map and never entered ground it marks no-go. `
      + `Route shape is a harder test: over ${routes.planned} one-kilometre legs our walking planner stayed ${routes.planner.medianDeviation} m (median) from the rover's path, `
      + `about the same as a straight line (${routes.straight.medianDeviation} m), because rover drivers also steer around rocks, sand and toward science targets. `
      + `Rover tilt is a ~3 m footprint and includes rocks and wheel sinkage. Points: green ≤2°, amber ≤5°, red >5° error.`;
  }

  fetch('data/curiosity/validation.json').then(r => r.ok ? r.json() : null).then(c => {
    if (!c) return;
    const f = c.footprints[KEY];
    $('truth-second-text').textContent = `Different rover, crater and terrain (the climb up Mount Sharp): across ${f.n} Curiosity waypoints up to sol ${c.lastSol}, `
      + `our slope map is off from the rover's measured tilt by ${f.mae.toFixed(1)}° on average (no-skill guess ${c.baseline.mae.toFixed(1)}°), r = ${f.pearson.toFixed(2)}, ${pct(f.within5)} within 5°. `
      + `Weaker than at Jezero, and honest about why: on Mount Sharp's rougher slopes the 16 m grid reads ${Math.abs(f.bias).toFixed(1)}° too flat on average and misses ${f.missedSteep} of ${f.roverSteep} places where the rover tilted 10° or more. `
      + `That is why routes use the native 1 m DTM wherever one exists (a 9 m footprint already improves to ${c.footprints.dtm9.mae.toFixed(1)}°, r = ${c.footprints.dtm9.pearson.toFixed(2)}).`;
    $('truth-second').hidden = false;
  }).catch(() => {});

  function flyToTraverse() {
    stopRotation();
    const rows = data.validation.rows, lats = rows.map(r => r.lat), lons = rows.map(r => r.lon);
    const w = Math.min(...lons), e = Math.max(...lons), span = e - w, wide = window.innerWidth > 760;
    const rect = Rectangle.fromDegrees(w - span * .04, Math.min(...lats) - span * .18, e + span * (wide ? .42 : .04), Math.max(...lats) + span * .04);
    const destination = viewer.camera.getRectangleCameraCoordinates(rect);
    viewer.camera.flyTo({ destination, duration: reducedMotion ? 0 : 2.2 });
  }

  async function setVisible(value) {
    if (value && !data) {
      $('truth-toggle').setAttribute('aria-busy', 'true');
      try { await load(); build(); }
      catch { notify('Perseverance ground-truth data could not load.'); return false; }
      finally { $('truth-toggle').removeAttribute('aria-busy'); }
    }
    visible = value;
    $('truth-toggle').setAttribute('aria-pressed', String(value));
    $('truth-panel').hidden = !value;
    shown.forEach(e => { e.show = value; });
    if (points) points.show = value;
    if (value) setPlacesCollapsed?.(true);
    viewer.scene.requestRender();
    return true;
  }

  function handlePick(id) {
    if (id && typeof id === 'object') id = id.id;
    if (id === 'rover:now' && rover) { notify(roverText(), 7000); return true; }
    if (!visible || typeof id !== 'string' || !id.startsWith('truth:')) return false;
    const r = data.validation.rows.find(row => `truth:${row.rmc}` === id);
    if (!r) return false;
    notify(`Sol ${r.sol} · ${(r.dist / 1000).toFixed(2)} km into the drive — rover tilt ${r.tilt.toFixed(1)}° (pitch ${r.pitch.toFixed(1)}°, roll ${r.roll.toFixed(1)}°); orbital slope ${r[KEY].toFixed(1)}° (16 m), ${r.dtm5.toFixed(1)}° (5 m). Error ${Math.abs(r[KEY] - r.tilt).toFixed(1)}°.`, 9000);
    return true;
  }

  $('truth-toggle').addEventListener('click', async () => {
    const show = !visible;
    if (await setVisible(show) && show) flyToTraverse();
  });
  $('truth-close').addEventListener('click', () => setVisible(false));
  $('truth-fly').addEventListener('click', () => data && flyToTraverse());

  return { setVisible, handlePick, load, get visible() { return visible; } };
}
