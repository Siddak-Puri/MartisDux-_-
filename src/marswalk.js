import { Cartesian2, Cartesian3, Color, LabelStyle, VerticalOrigin, DistanceDisplayCondition, NearFarScalar,
  SingleTileImageryProvider, Rectangle, Credit, PointPrimitiveCollection, LabelCollection } from 'cesium';
import { EVA_DEFAULTS, ROVER_SPEED, planMarswalk, reverseSamples, walkBackField, formatDuration, timeAt, oxygenGrams } from './eva.js';
import { bearingTo, distanceBetween } from './surface-navigation.js';
import { sunAt, daylight, formatLocalTime, nextLocalTime } from './mars-time.js';
import { cellOf, bounds } from './hazards.js';
import { createConditions, describe } from './conditions.js';
import { tilesFor, boxAround, pack } from './offline.js';
import { loadSpaceWeather, walkRisk, setApiKey, apiKey, ARRIVAL_UNCERTAINTY_H } from './space-weather.js';
import { loadGeology, unitsAlong, describeAge, unitAt, loadLocalGeology, localUnitAt, localUnitsAlong } from './geology.js';
import { pickPhotos } from './ground-photos.js';
import { lineOfSight } from './mission-control.js';

const $ = id => document.getElementById(id);
const SOL_HOUR = 88775.244 / 24;
const LANDING = { lat: 18.4446, lon: 77.4509, name: 'Octavia E. Butler Landing (base)' };
const STORE = 'martisdux-eva-params';
const metres = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const rad = Math.PI / 180;
const distance = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * rad), b.lat - a.lat) * rad * 3396190;

function loadParams() {
  try { return { ...EVA_DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { ...EVA_DEFAULTS }; }
}

export function createMarswalk({ viewer, mars, routes, terrain, hazards, notify, photos }) {
  let params = loadParams(), startHour = 9, samples = [], field = null, fieldKey = '', fieldJob = 0, plan = null;
  let rangeLayer = null, rangeShown = false, frame = 0, worker = null, last = null, travel = 'foot', stations = [];

  let spaceWeather = null;
  const refreshSpace = force => loadSpaceWeather({ force }).then(w => { spaceWeather = w; schedule(); });
  refreshSpace(false); window.addEventListener('online', () => refreshSpace(false));
  let geology = null;
  let localGeology = null, geologyStarted = false;
  function loadWalkGeology() {
    if (geologyStarted) return;
    geologyStarted = true;
    loadGeology().then(g => { geology = g; schedule(); }).catch(error => console.warn('[MartisDux] Geologic map unavailable.', error));
    loadLocalGeology().then(g => { localGeology = g; schedule(); }).catch(error => console.warn('[MartisDux] Jezero geologic map unavailable.', error));
  }
  photos?.ready.then(schedule);
  const conditions = createConditions();
  conditions.ready.then(schedule); conditions.liveReady.then(schedule);

  const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  const labels = viewer.scene.primitives.add(new LabelCollection());
  fetch('data/perseverance/samples.json').then(r => r.json()).then(data => {
    samples = data.samples.filter(s => s.type !== 'Atmospheric');
    const near = new DistanceDisplayCondition(0, 40000), scale = new NearFarScalar(800, 1.15, 40000, .6);
    const sites = new Map();
    for (const s of samples) { const key = `${s.lat},${s.lon}`; (sites.get(key) ?? sites.set(key, []).get(key)).push(s); }
    for (const group of sites.values()) {
      const s = group[0], h = (terrain?.heightAt(s) ?? 0) + 2, position = Cartesian3.fromDegrees(s.lon, s.lat, h, mars);
      points.add({ id: `sample:${s.number}`, position, pixelSize: 9, color: Color.fromCssColorString('#7ad3ff'), outlineColor: Color.fromCssColorString('#0b1a24'), outlineWidth: 2,
        distanceDisplayCondition: near, scaleByDistance: scale, disableDepthTestDistance: 2e4 });
      labels.add({ id: `sample:${s.number}`, position, text: `${group.map(g => g.name.replace(/ \(aka .*\)/, '')).join(' · ')}\n${s.rock ?? s.type}`,
        font: '10px "Instrument Sans Variable"', fillColor: Color.fromCssColorString('#d9f2ff'), outlineColor: Color.fromCssColorString('#081118'), outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -10),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 9000), disableDepthTestDistance: 2e4, scaleByDistance: new NearFarScalar(800, 1, 9000, .75) });
    }
    viewer.scene.requestRender(); schedule();
  }).catch(error => console.warn('[MartisDux] Sample sites unavailable.', error));

  function requestField(grid, start) {
    const base = cellOf(grid, start);
    if (!base) return;
    const key = `${grid.source}|${grid.step}|${grid.x0}|${grid.y0}|${base.i}|${params.flatSpeed}|${params.maxSlope}`;
    if (key === fieldKey) return;
    fieldKey = key; field = null; const id = ++fieldJob;
    const payload = { width: grid.width, height: grid.height, dx: grid.dx, dy: grid.dy, slope: grid.slope };
    const done = time => { if (id !== fieldJob) return; field = { grid, time, base }; if (rangeShown) paintRange(); schedule(); };
    if (worker === null) {
      try { worker = new Worker(new URL('./walkback-worker.js', import.meta.url), { type: 'module' }); }
      catch { worker = false; }
    }
    if (worker) {
      worker.onmessage = ({ data }) => { if (data.id === fieldJob) { console.info(`[MartisDux] Walk-back field ${grid.width}×${grid.height} in ${Math.round(data.ms)} ms (worker).`); done(data.time); } };
      worker.postMessage({ id, grid: { ...payload, slope: grid.slope.slice() }, base: base.i, params });
    } else setTimeout(() => done(walkBackField(payload, base.i, params)), 0);
  }
  const toBase = p => {
    if (!field) return null;
    const c = cellOf(field.grid, p); if (!c) return null;
    const t = field.time[c.i]; return Number.isFinite(t) ? t : null;
  };

  function paintRange() {
    if (rangeLayer) { viewer.imageryLayers.remove(rangeLayer, true); rangeLayer = null; }
    if (!field || !rangeShown) { viewer.scene.requestRender(); return; }
    const { grid, time } = field, { width, height } = grid, usable = (params.budgetHours * 60 - params.reserveMinutes - params.stopMinutes) * 60;
    const trip = travel === 'rover' ? 1 + params.flatSpeed / ROVER_SPEED : 2;
    const rgba = new Uint8ClampedArray(width * height * 4), band = t => Math.floor(t / 1800);
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
      const i = r * width + c, t = time[i];
      if (!Number.isFinite(t)) continue;
      const round = trip * t <= usable;
      const edge = (c + 1 < width && band(time[i + 1]) !== band(t)) || (r + 1 < height && band(time[i + width]) !== band(t));
      const limit = (c + 1 < width && (trip * time[i + 1] <= usable) !== round) || (r + 1 < height && (trip * time[i + width] <= usable) !== round);
      if (limit) rgba.set([255, 255, 255, 235], i * 4);
      else if (edge && round) rgba.set([122, 211, 255, band(t) % 2 ? 150 : 210], i * 4);
      else if (round) rgba.set([122, 211, 255, 26 + 20 * (band(t) % 2)], i * 4);
      else rgba.set([18, 8, 4, 110], i * 4);
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const b = bounds(grid);
    SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), { rectangle: Rectangle.fromDegrees(b.west, b.south, b.east, b.north), ellipsoid: mars,
      credit: new Credit('Walk-back range: MartisDux suited-walking model over NASA elevation data') }).then(provider => {
      if (!rangeShown || field?.grid !== grid) return;
      rangeLayer = viewer.imageryLayers.addImageryProvider(provider); rangeLayer.alpha = .9; viewer.scene.requestRender();
    });
  }

  function showRange(on) {
    rangeShown = on; $('eva-range').setAttribute('aria-pressed', String(on));
    $('eva-range').firstChild.textContent = on ? 'Hide safe-return zone' : 'Show safe-return zone';
    paintRange();
  }
  let rangeAuto = false, rangeRoute = '', sandMetres = 0, localCover = false;
  fetch('data/perseverance/validation.json').then(r => r.json()).then(v => {
    const f = v.footprints.dtm16; $('eva-proof-mae').textContent = `${f.mae.toFixed(1)}°`; $('eva-proof-n').textContent = String(f.n);
  }).catch(() => {});
  $('eva-proof').addEventListener('click', () => { if ($('truth-toggle').getAttribute('aria-pressed') !== 'true') $('truth-toggle').click(); });

  let pollKey = '';
  function renderPoll(items, pending, key) {
    const ul = $('eva-poll');
    if (ul.children.length !== items.length) ul.replaceChildren(...items.map((_, i) => {
      const li = document.createElement('li'); li.style.setProperty('--i', i);
      li.append(document.createElement('i'), document.createElement('span'), document.createElement('small'), document.createElement('b')); return li;
    }));
    items.forEach((item, i) => {
      const li = ul.children[i]; li.dataset.state = item.state;
      li.children[1].textContent = item.label; li.children[2].textContent = item.note;
      li.children[3].textContent = { go: 'GO', caution: 'CHECK', nogo: 'NO-GO', pending: '…' }[item.state];
    });
    if (!pending && key !== pollKey) { pollKey = key; ul.classList.remove('is-polling'); void ul.offsetWidth; ul.classList.add('is-polling'); }
  }

  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }

  function update() {
    const state = routes.getState(), card = $('eva-card');
    const profile = state.profile, ready = state.safe && profile?.samples?.length > 1 && state.grid;
    card.hidden = !ready; $('eva-more').hidden = !ready;
    if (!ready) { plan = null; last = null; $('live-start').disabled = true; if (stations.length) clearStations(); return; }
    loadWalkGeology();
    const covering = (hazards?.routingGrids ?? []).filter(g => { const c = cellOf(g, state.start); return c && Number.isFinite(g.slope[c.i]); });
    const fieldGrid = covering.sort((a, b) => b.width * b.step * b.height * b.step - a.width * a.step * a.height * a.step)[0] ?? state.grid;
    requestField(fieldGrid, state.start);
    const outbound = profile.samples.map(s => ({ d: s.d, z: s.z, lat: s.lat, lon: s.lon }));
    const sites = []; const seen = new Set();
    for (const s of samples) {
      const key = `${s.lat},${s.lon}`; if (seen.has(key)) continue;
      const near = outbound.reduce((best, p) => Math.min(best, distance(p, s)), Infinity);
      const along = outbound.find(p => distance(p, s) === near)?.d ?? 0;
      if (near <= 150 && along >= 120) { seen.add(key); sites.push({ ...s, offset: near, d: along }); }
    }
    sites.sort((a, b) => a.d - b.d);
    const atDestination = sites.some(s => distance(s, state.destination) < 60);
    const stops = sites.length + (atDestination ? 0 : 1);
    const routeKey = JSON.stringify([state.start, state.destination]);
    if (routeKey !== rangeRoute) { rangeRoute = routeKey; if (!rangeAuto && !rangeShown) showRange(true); }
    plan = planMarswalk({ outbound, back: reverseSamples(outbound), stops, toBase, points: outbound, mode: travel }, params);
    render(plan, sites, stops, state);
  }

  function render(p, sites, stops, state) {
    const pending = !field;
    const now = new Date(), when = nextLocalTime(state.start, startHour, now), sun = sunAt(state.start, when), day = daylight(state.start, when);
    const endHour = startHour + p.total / SOL_HOUR;
    const inDaylight = day.start != null && startHour >= day.start && endHour <= day.end;
    p.checks.daylight = inDaylight;
    const startMs = when.getTime(), endMs = startMs + p.total * 1000;
    const risk = spaceWeather?.arrivals ? walkRisk(spaceWeather.arrivals, startMs, endMs) : null;
    p.checks.spaceWeather = risk ? risk.level !== 'nogo' : true;
    last = { plan: p, sites, state, risk, sun, day, startHour, ok: p.ok && inDaylight && p.checks.spaceWeather && !pending };
    renderSpace(risk, startMs, endMs);
    const ok = p.ok && inDaylight && !pending && p.checks.spaceWeather;
    $('eva-verdict').textContent = pending ? 'CHECKING' : ok ? 'GO' : 'NO-GO';
    const reasons = [];
    if (p.margin < 0) reasons.push('too long for the suit');
    else if (p.noReturn) reasons.push(travel === 'rover' ? "you couldn't walk home if the rover broke down" : 'you could not get back in time');
    if (!inDaylight) reasons.push('it would end after dark');
    if (risk?.level === 'nogo') reasons.push('a solar storm is due');
    $('eva-headline').textContent = pending ? 'Checking the walk home…'
      : ok && travel === 'rover' ? `Safe to drive. If the rover breaks down anywhere, you can still walk home.`
      : ok ? `Safe to go. You'd be back with ${formatDuration(p.margin)} of suit time to spare.`
      : `Not safe: ${reasons.join(', ') || 'see the warning below'}.`;
    $('eva-headline').dataset.state = pending ? 'pending' : ok ? 'go' : 'nogo';
    $('eva-verdict').dataset.state = pending ? 'pending' : ok ? 'go' : 'nogo';
    $('eva-total').textContent = formatDuration(p.total);
    $('eva-total-note').textContent = `round trip · ${params.budgetHours} h suit`;
    const segs = [['out', p.outbound.time], ['sci', p.science], ['back', p.back.time], ['res', params.reserveMinutes * 60]];
    const free = Math.max(0, p.budget - segs.reduce((s, [, v]) => s + v, 0));
    $('eva-bar').replaceChildren(...[...segs, ['free', free]].map(([k, v]) => {
      const el = document.createElement('span'); el.className = `eva-seg eva-${k}`; el.style.flexGrow = String(v); el.title = `${k}: ${formatDuration(v)}`; return el;
    }));
    $('eva-bar').classList.toggle('is-over', p.total + params.reserveMinutes * 60 > p.budget);
    renderGeology(state);
    const alerts = [];
    if (sandMetres > 20) alerts.push(`${metres(sandMetres)} of windblown sand on this route (USGS map). Soft footing${travel === 'rover' ? ', and a rover can get stuck' : ''}.`);
    if (p.noReturn) alerts.push(travel === 'rover' ? `Walkback limit at ${metres(p.noReturn.d)}: past it, a rover breakdown leaves too little suit time to walk home.` : `Turn back before ${metres(p.noReturn.d)}, or you can't make it home.`);
    if (p.margin < 0) alerts.push(`Needs ${formatDuration(-p.margin)} more suit time. Pick a closer spot.`);
    if (!inDaylight && day.start != null) alerts.push(`Daylight ends at ${formatLocalTime(day.end)}. Leave earlier.`);
    if (risk?.level === 'nogo') alerts.push(`Solar storm due during the walk. Stay near shelter.`);
    if (p.outbound.unknown > 0) alerts.push(`${metres(p.outbound.unknown)} of the route has no elevation data.`);
    $('eva-alert').replaceChildren(...alerts.map(text => Object.assign(document.createElement('span'), { textContent: text }))); $('eva-alert').hidden = !alerts.length;
    $('eva-out').textContent = `${formatDuration(p.outbound.time)} · ${metres(p.outbound.distance)}`;
    $('eva-back').textContent = formatDuration(p.back.time);
    $('eva-stops').textContent = `${stops} × ${params.stopMinutes} min`;
    $('eva-energy').textContent = `${Math.round(p.energy / 4184).toLocaleString()} kcal`;
    $('eva-oxygen').textContent = `${Math.round(p.oxygen).toLocaleString()} g`;
    $('eva-dose').textContent = `${p.dose.toFixed(2)} mSv`;
    $('eva-dose').title = `≈ ${(p.dose / 0.1).toFixed(1)} chest X-rays. Surface rate 0.64 mSv/sol (Curiosity RAD). Solar storm: farthest point is ${formatDuration(p.maxToBase)} from shelter.`;
    $('eva-shelter').textContent = pending ? 'computing…' : formatDuration(p.maxToBase);
    $('eva-margin').textContent = pending ? 'computing…' : Number.isFinite(p.worstMargin) ? formatDuration(p.worstMargin) : '—';
    $('eva-margin').dataset.level = p.worstMargin < 0 ? 'bad' : p.worstMargin < 3600 ? 'warn' : 'ok';
    $('eva-start-out').textContent = formatLocalTime(startHour);
    const prof = state.profile, xrays = p.dose / 0.1;
    let contact = null;
    if (field) {
      let seen = 0, known = 0;
      for (const sample of prof.samples) { const c = cellOf(field.grid, sample); if (!c) continue; const v = lineOfSight(field.grid, field.base, c, 10, 2); if (v == null) continue; known++; if (v) seen++; }
      contact = known ? seen / known : null;
    }
    renderPoll([
      { label: 'Route', state: prof.maxSlope > 25 ? 'nogo' : prof.maxSlope > 15 ? 'caution' : 'go', note: `Steepest ${prof.maxSlope.toFixed(0)}°` },
      { label: 'Ground', state: sandMetres > 20 ? 'caution' : 'go', note: sandMetres > 20 ? `${metres(sandMetres)} of sand` : localCover ? 'No sand mapped' : 'Regional map only' },
      { label: 'Suit', state: p.checks.duration ? 'go' : 'nogo', note: p.margin >= 0 ? `${formatDuration(p.margin)} spare` : `${formatDuration(-p.margin)} short` },
      { label: 'Way home', state: pending ? 'pending' : p.checks.walkBack ? 'go' : 'nogo', note: pending ? 'Checking' : p.noReturn ? `Too far past ${metres(p.noReturn.d)}` : `Max ${formatDuration(p.maxToBase)} from base` },
      { label: 'Daylight', state: inDaylight ? 'go' : 'nogo', note: inDaylight ? `Back by ${formatLocalTime(endHour)}` : 'Ends after dark' },
      { label: 'Solar storms', state: !risk ? 'caution' : risk.level === 'nogo' ? 'nogo' : risk.level === 'caution' ? 'caution' : 'go', note: !risk ? 'No forecast' : risk.level === 'nogo' ? 'Storm due' : risk.level === 'caution' ? 'Weak storm near' : 'None forecast' },
      { label: 'Body', state: 'go', note: `O₂ ${(p.oxygen / 1000).toFixed(1)} kg · dose ${xrays < 1 ? '<1' : xrays.toFixed(0)} X-ray` },
      { label: 'Radio', state: contact == null ? 'pending' : contact >= .9 ? 'go' : 'caution', note: contact == null ? 'Checking' : `${Math.round(contact * 100)}% in contact` },
    ], pending, `${rangeRoute}|${travel}`);
    $('live-start').disabled = pending;
    const season = ['northern spring', 'northern summer', 'northern autumn', 'northern winter'][Math.floor(sun.ls / 90)];
    $('eva-sun-note').textContent = day.start == null ? 'No usable daylight on this sol.'
      : `Back by ${formatLocalTime(endHour)} · daylight ${formatLocalTime(day.start)}–${formatLocalTime(day.end)}`;
    $('eva-sun-note').title = `Mars local solar time. Sun ${sun.elevation.toFixed(0)}° high at the start. Ls ${sun.ls.toFixed(0)}°, ${season}. Earth time ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
    const cond = describe(conditions, sun.ls);
    $('eva-conditions').hidden = !cond;
    if (cond) {
      $('eva-dust').hidden = !cond.dust;
      $('eva-season-title').textContent = cond.season ? `Typical at Gale for this season · ${cond.season.title}` : 'Season';
      $('eva-season').replaceChildren(...(cond.season ? [cond.season.air, cond.season.ground, cond.season.pressure, cond.season.uv] : []).filter(Boolean).map(text => Object.assign(document.createElement('li'), { textContent: text })));
      $('eva-latest-title').textContent = cond.latest?.title ?? 'Latest report';
      $('eva-latest').textContent = cond.latest?.text ?? 'Unavailable.';
      $('eva-jezero').textContent = cond.jezero ? `${cond.jezero} Curiosity REMS (NASA/JPL-Caltech/CAB); Perseverance MEDA has no current public feed.` : '';
    }
    renderPhotos(state);
    renderStations(p, sites, state);
    $('eva-sites').hidden = !sites.length;
    $('eva-site-list').replaceChildren(...sites.map(s => {
      const li = document.createElement('li');
      li.innerHTML = `<strong></strong><small></small>`;
      li.querySelector('strong').textContent = s.name;
      li.querySelector('small').textContent = `${s.rock ?? s.type} · Perseverance sealed sol ${s.sol} · ${metres(s.d)} along route`;
      return li;
    }));
  }

  const geologyAt = p => {
    const l = localUnitAt(localGeology, p);
    if (l) return { label: `${l.hazard === 'avoid' ? '⚠ ' : ''}${l.name} (${l.code})`, notes: l.notes };
    const u = geology && unitAt(geology, p); return u ? { label: `${u.description} (${u.code})`, notes: '' } : null;
  };
  const stationLabels = viewer.scene.primitives.add(new LabelCollection());
  function renderStations(p, sites, state) {
    const list = sites.map(s => ({ name: s.name.replace(/ \(aka .*\)/, ''), lat: s.lat, lon: s.lon, d: s.d,
      task: s.type === 'Regolith' ? 'Scoop a regolith (loose soil) sample' : `Sample the ${(s.rock ?? s.type).toLowerCase()} rock`, sol: s.sol }));
    const end = state.profile.samples.at(-1);
    if (!sites.some(s => distance(s, state.destination) < 60))
      list.push({ name: state.destination.name || 'Destination', lat: state.destination.lat, lon: state.destination.lon, d: end.d, task: 'Photograph and sample the outcrop' });
    let science = 0;
    stations = list.map((s, i) => {
      const arrive = timeAt(p.outbound.timeline, s.d) + science; science += params.stopMinutes * 60;
      const unit = geologyAt?.(s);
      const photo = photos?.near([{ ...s, d: s.d }], 40)?.[0];
      const pic = photo && (photo.place.photos.find(x => x.cam === 'Mastcam-Z') ?? photo.place.photos[0]);
      return { ...s, n: i + 1, arrive, home: toBase(s), unit, photo, photoSrc: pic ? photos.url(pic, 'small') : null };
    });
    const ol = $('eva-stations-list');
    ol.replaceChildren(...stations.map(st => {
      const li = document.createElement('li');
      const num = Object.assign(document.createElement('b'), { textContent: String(st.n) });
      const body = document.createElement('div');
      body.append(Object.assign(document.createElement('strong'), { textContent: st.name }),
        Object.assign(document.createElement('small'), { textContent: st.task }),
        Object.assign(document.createElement('span'), { className: 'st-meta', textContent:
          `${metres(st.d)} · arrive +${formatDuration(st.arrive)} · ${st.home == null ? '—' : formatDuration(st.home)} home` }));
      if (st.unit) body.append(Object.assign(document.createElement('span'), { className: 'st-unit', textContent: `Rock: ${st.unit.label}`, title: st.unit.notes }));
      li.append(num, body);
      if (st.photo) {
        const b = document.createElement('button'); b.type = 'button'; b.title = 'Real Perseverance photo of this spot';
        b.append(Object.assign(document.createElement('img'), { src: st.photoSrc, alt: `Perseverance photo near ${st.name}`, referrerPolicy: 'no-referrer' }));
        b.addEventListener('click', () => photos.openPlace(st.photo.place));
        li.append(b);
      }
      return li;
    }));
    $('eva-stations').hidden = !stations.length;
    stationLabels.removeAll();
    for (const st of stations) stationLabels.add({ position: Cartesian3.fromDegrees(st.lon, st.lat, (terrain?.heightAt(st) ?? 0) + 4, mars),
      text: `${st.n}`, font: '600 15px "Instrument Sans Variable"', fillColor: Color.fromCssColorString('#120b07'), showBackground: true,
      backgroundColor: Color.fromCssColorString('#ffd36b'), backgroundPadding: new Cartesian2(7, 4), verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -14), distanceDisplayCondition: new DistanceDisplayCondition(0, 30000), disableDepthTestDistance: 2e4 });
    viewer.scene.requestRender();
  }
  function clearStations() { stations = []; stationLabels.removeAll(); viewer.scene.requestRender(); }

  function renderGeology(state) {
    const path = state.profile?.samples ?? [];
    const local = localGeology ? localUnitsAlong(localGeology, path) : [];
    const total = Math.max(1, path.at(-1)?.d ?? 1);
    const sand = local.filter(x => x.unit.code === 'Aeb').reduce((m, x) => m + x.to - x.from, 0);
    sandMetres = sand; localCover = local.length > 0;
    if (local.length) {
      $('eva-geology').hidden = false;
      $('eva-geology-title').textContent = 'ROCKS UNDERFOOT · USGS JEZERO MAP 1:75,000';
      $('eva-geology-note').textContent = 'USGS SIM 3464 (Sun & Stack 2020), Planetary Geologic Mapping Program. Unit edges may be off by 100–200 m.';
      const merged = new Map();
      for (const x of local) { const m = merged.get(x.unit.code) ?? { unit: x.unit, length: 0, from: x.from }; m.length += x.to - x.from; merged.set(x.unit.code, m); }
      $('eva-geology-list').replaceChildren(...[...merged.values()].sort((a, b) => a.from - b.from).map(m => {
        const li = document.createElement('li'); li.innerHTML = '<strong></strong><small></small>';
        li.style.borderLeftColor = m.unit.color;
        li.querySelector('strong').textContent = `${m.unit.name} (${m.unit.code})${m.unit.hazard === 'avoid' ? ' ⚠' : ''}`;
        li.querySelector('small').textContent = `${m.unit.notes} ${m.unit.age}. ${merged.size > 1 ? `${Math.max(1, Math.round(100 * m.length / total))}% of the route.` : 'The whole route.'}`;
        return li;
      }));
      return;
    }
    $('eva-geology-title').textContent = 'ROCKS UNDERFOOT · USGS MAP OF MARS 1:20M';
    $('eva-geology-note').textContent = 'Regional 1:20M map (Tanaka et al. 2014): unit boundaries are placed to about 5–10 km.';
    const stretches = geology ? unitsAlong(geology, path) : [];
    $('eva-geology').hidden = !stretches.length;
    const merged = new Map();
    for (const s of stretches) { const m = merged.get(s.unit.code) ?? { unit: s.unit, length: 0, from: s.from }; m.length += s.to - s.from; merged.set(s.unit.code, m); }
    $('eva-geology-list').replaceChildren(...[...merged.values()].sort((a, b) => a.from - b.from).map(m => {
      const li = document.createElement('li'); li.innerHTML = '<strong></strong><small></small>';
      li.querySelector('strong').textContent = `${m.unit.description} (${m.unit.code})`;
      const share = merged.size > 1 ? ` · ${Math.max(1, Math.round(100 * m.length / total))}% of the route` : ' · the whole route';
      li.querySelector('small').textContent = describeAge(m.unit) + share;
      return li;
    }));
  }

  let photoKey = '';
  function renderPhotos(state) {
    const path = state.profile?.samples ?? [];
    const near = photos?.near(path, 60) ?? [];
    $('eva-photos').hidden = !near.length;
    const key = near.map(n => n.place.rmc).join();
    if (key === photoKey) return; photoKey = key;
    if (!near.length) { $('eva-photo-strip').replaceChildren(); return; }
    const picked = pickPhotos(near, 9).map(item => ({ ...item, routeName: true }));
    const count = near.reduce((n, x) => n + x.place.photos.length, 0);
    $('eva-photos-note').textContent = `Real Perseverance photos taken beside this route (${count} in all).`;
    $('eva-photo-strip').replaceChildren(...picked.map((item, i) => {
      const b = document.createElement('button'); b.type = 'button';
      b.title = `${item.photo.cam}, sol ${item.photo.sol} · ${Math.round(item.d)} m along the route`;
      const img = Object.assign(document.createElement('img'), { src: photos.url(item.photo, 'small'), alt: b.title, referrerPolicy: 'no-referrer' });
      const em = document.createElement('em'); em.textContent = `${Math.round(item.d)} m · ${item.photo.cam}`;
      b.append(img, em); b.addEventListener('click', () => photos.open(picked, i));
      return b;
    }));
  }

  function photoUrlsForPack(state) {
    const near = photos?.near(state.profile?.samples ?? [], 60) ?? [];
    return near.flatMap(n => n.place.photos.flatMap(p => [photos.url(p, 'small'), photos.url(p, 'large')]));
  }

  function renderSpace(risk, startMs, endMs) {
    const box = $('eva-space'), when = ms => new Date(ms).toUTCString().slice(5, 22) + ' UTC';
    if (!spaceWeather) { box.dataset.level = 'pending'; return; }
    if (!spaceWeather.arrivals) {
      box.dataset.level = 'unknown';
      $('eva-space-status').textContent = 'Solar storm forecast unavailable';
      $('eva-space-detail').textContent = `${spaceWeather.error ?? ''} Check the habitat's space-weather alert before going out.`;
      return;
    }
    box.dataset.level = risk.level;
    const age = Math.round((Date.now() - spaceWeather.fetched) / 60000);
    const freshness = spaceWeather.live ? `Live from NASA DONKI, checked ${age < 1 ? 'just now' : `${age} min ago`}` : `Saved copy from ${new Date(spaceWeather.fetched).toLocaleString()} (offline)`;
    $('eva-space-status').textContent = risk.level === 'nogo' ? 'Solar storm due during the walk'
      : risk.level === 'caution' ? 'Weak solar storm near the walk time' : 'No solar storms forecast';
    const hit = risk.overlapping[0] ?? risk.next;
    $('eva-space-detail').innerHTML = '';
    const p = $('eva-space-detail');
    p.append(hit ? `${risk.overlapping.length ? 'Forecast' : 'Next forecast'} CME arrival at Mars: ${when(hit.arrival)}${hit.glancing ? ', glancing blow' : ', direct hit'}${hit.speed ? `, ${Math.round(hit.speed)} km/s` : ''} (±${ARRIVAL_UNCERTAINTY_H} h). `
      : `No coronal mass ejection is forecast to reach Mars after ${when(startMs)}. `);
    p.append(`${spaceWeather.cmeCount} CMEs analysed in the last 30 days. ${freshness}. `);
    if (hit?.link) { const a = Object.assign(document.createElement('a'), { href: hit.link, target: '_blank', rel: 'noopener noreferrer', textContent: 'NASA analysis ↗' }); p.append(a); }
  }

  document.querySelectorAll('[data-eva]').forEach(input => {
    input.value = params[input.dataset.eva];
    input.addEventListener('change', () => {
      const v = Number(input.value), min = Number(input.min), max = Number(input.max);
      if (!Number.isFinite(v)) { input.value = params[input.dataset.eva]; return; }
      params = { ...params, [input.dataset.eva]: Math.min(max, Math.max(min, v)) }; input.value = params[input.dataset.eva];
      try { localStorage.setItem(STORE, JSON.stringify(params)); } catch { }
      fieldKey = ''; schedule(); if (rangeShown) paintRange();
    });
  });
  const keyInput = $('eva-nasa-key');
  keyInput.value = apiKey() === 'DEMO_KEY' ? '' : apiKey();
  keyInput.addEventListener('change', () => { setApiKey(keyInput.value); refreshSpace(true); });
  document.querySelectorAll('[data-travel]').forEach(b => b.addEventListener('click', () => {
    travel = b.dataset.travel;
    document.querySelectorAll('[data-travel]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    schedule(); if (rangeShown) paintRange();
  }));
  $('eva-start').addEventListener('input', event => { startHour = Number(event.target.value); schedule(); });
  $('eva-range').addEventListener('click', () => {
    rangeShown = !rangeShown; rangeAuto = true; $('eva-range').setAttribute('aria-pressed', String(rangeShown));
    showRange(rangeShown);
  });
  $('eva-pack').addEventListener('click', async () => {
    const state = routes.getState(), status = $('eva-pack-status');
    if (!state.points?.length) return;
    const urls = [...tilesFor(boxAround(state.points, 500)), ...photoUrlsForPack(state)];
    status.hidden = false; status.textContent = `Packing ${urls.length} NASA image tiles for this walk…`;
    $('eva-pack').disabled = true;
    try {
      const result = await pack(urls, p => { status.textContent = `Packing NASA image tiles: ${p.done} of ${p.total}${p.failed ? ` (${p.failed} unavailable)` : ''}…`; });
      status.textContent = `Saved for offline.${result.failed ? ` ${result.failed} tiles missing.` : ''}`;
    } catch (error) { status.textContent = error.message; }
    finally { $('eva-pack').disabled = false; }
  });
  $('eva-demo').addEventListener('click', () => {
    const rochette = samples.find(s => s.name === 'Montdenier') ?? { lat: 18.4307394, lon: 77.4443657 };
    document.querySelector('[data-travel=foot]').click();
    routes.setRoute({ ...LANDING }, { lat: rochette.lat, lon: rochette.lon, name: 'Rochette · first rock cores' });
  });

  $('eva-demo-far').addEventListener('click', () => {
    const site = samples.find(s => s.name.startsWith('Kukaklek')) ?? { lat: 18.4516, lon: 77.4014 };
    document.querySelector('[data-travel=foot]').click();
    routes.setRoute({ ...LANDING }, { lat: site.lat, lon: site.lon, name: 'Delta front · ancient river delta' });
  });

  const demoList = $('eva-demos'), foldDemos = () => { demoList.open = !document.body.dataset.route || document.body.dataset.route === 'empty'; };
  new MutationObserver(foldDemos).observe(document.body, { attributes: true, attributeFilter: ['data-route'] }); foldDemos();

  document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset, base = d.fromLat ? { lat: Number(d.fromLat), lon: Number(d.fromLon), name: d.fromName } : { ...LANDING };
    document.querySelector(`[data-travel=${d.travel ?? 'foot'}]`).click();
    routes.setRoute(base, { lat: Number(d.lat), lon: Number(d.lon), name: d.name });
  }));

  function hud(position, along) {
    if (!last?.plan) return null;
    const { plan: p, sites, state, risk, sun } = last;
    const passed = sites.filter(s => s.d < along - 5);
    const elapsed = timeAt(p.outbound.timeline, along) + passed.length * params.stopMinutes * 60;
    const home = toBase(position);
    const usable = p.usable, margin = home == null ? null : usable - elapsed - home;
    const next = sites.find(s => s.d >= along - 5) ?? null;
    const energy = timeAt(p.outbound.timeline, along, 'e');
    return {
      elapsed, budgetLeft: p.budget - elapsed, usable, reserve: params.reserveMinutes * 60, home, margin,
      noReturn: p.noReturn, oxygen: oxygenGrams(energy), kcal: energy / 4184,
      base: { distance: distanceBetween(position, state.start), bearing: bearingTo(position, state.start) },
      next: next && { name: next.name.replace(/ \(aka .*\)/, ''), rock: next.rock ?? next.type, distance: distanceBetween(position, next), bearing: bearingTo(position, next), sol: next.sol },
      space: risk?.level ?? 'unknown', sun: sun.elevation, ok: last.ok,
    };
  }

  return {
    routeChanged: schedule, hud,
    sheet: () => last && { ...last, stations, travel, params },
    live: () => last?.plan && field ? { ...last, stations: [...stations], travel, params: { ...params }, field, toBase } : null,
    handlePick(id) {
      if (typeof id !== 'string' || !id.startsWith('sample:')) return false;
      const s = samples.find(x => `sample:${x.number}` === id); if (!s) return false;
      routes.setDestination({ lat: s.lat, lon: s.lon, name: `${s.name.replace(/ \(aka .*\)/, '')} sample site` });
      notify(`${s.name}: ${s.rock ?? s.type} sample taken by Perseverance. Set as your destination.`, 6000);
      return true;
    },
  };
}
