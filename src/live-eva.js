import { Cartesian2, Cartesian3, Color, ArcType, PointPrimitiveCollection, LabelCollection, LabelStyle, VerticalOrigin, PolylineOutlineMaterialProperty } from 'cesium';
import { cellOf, pointOf } from './hazards.js';
import { ROVER_SPEED, formatDuration } from './eva.js';
import { buildTimeline, stateAt, pointAt, homePath, lineOfSight, decide, DRILLS } from './mission-control.js';
import { lightTimeSeconds, formatDelay } from './earth-link.js';

const $ = id => document.getElementById(id);
const clock = s => { const t = Math.max(0, Math.round(s)); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(v => String(v).padStart(2, '0')).join(':'); };
const metres = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

export function createLiveEva({ viewer, mars, marswalk, routes, terrain, notify, shield }) {
  let snap = null, timeline = null, samples = [], simT = 0, speed = 300, mode = 'idle', frame = 0, lastNow = 0, drill = null, here = null;
  const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  const labels = viewer.scene.primitives.add(new LabelCollection());
  const lines = [];
  const place = p => Cartesian3.fromDegrees(p.lon, p.lat, (terrain?.heightAt(p) ?? 0) + 3, mars);
  const outline = Color.fromCssColorString('#120b07');
  let crew = null, crewLabel = null;

  function marker(p, text, color) {
    const position = place(p);
    const point = points.add({ position, pixelSize: 15, color: Color.fromCssColorString(color), outlineColor: Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    const label = labels.add({ position, text, font: '600 11px "Martian Mono Variable"', fillColor: Color.WHITE, outlineColor: outline, outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY });
    return [point, label];
  }
  function line(path, color) {
    if (path.length < 2) return;
    lines.push(viewer.entities.add({ polyline: { positions: Cartesian3.fromDegreesArray(path.flatMap(p => [p.lon, p.lat]), mars), width: 5, clampToGround: true, arcType: ArcType.GEODESIC, zIndex: 20,
      material: new PolylineOutlineMaterialProperty({ color: Color.fromCssColorString(color), outlineColor: outline, outlineWidth: 2 }) } }));
  }
  function clearMap() {
    points.removeAll(); labels.removeAll(); crew = crewLabel = null;
    lines.splice(0).forEach(e => viewer.entities.remove(e));
    viewer.scene.requestRender();
  }
  function moveCrew(p) {
    here = p;
    if (!crew) [crew, crewLabel] = marker(p, 'CREW', '#ff9c4c');
    const position = place(p); crew.position = position; crewLabel.position = position;
    viewer.scene.requestRender();
  }

  const level = (id, value) => { $(id).dataset.level = value; };
  function gauges(position, elapsed, home, suitLeft, spare) {
    $('live-elapsed').textContent = clock(elapsed);
    $('live-suit').textContent = formatDuration(Math.max(0, suitLeft));
    $('live-home').textContent = home == null ? '—' : home < 45 ? 'At base' : formatDuration(home);
    $('live-margin').textContent = spare == null ? '—' : spare >= 0 ? formatDuration(spare) : `${formatDuration(-spare)} short`;
    level('live-margin-box', spare == null ? '' : spare < 0 ? 'bad' : spare < 1800 ? 'warn' : 'ok');
    const cell = cellOf(snap.field.grid, position), seen = cell ? lineOfSight(snap.field.grid, snap.field.base, cell, 10, 2) : null;
    $('live-radio').textContent = seen == null ? '—' : seen ? 'In contact' : 'Behind terrain';
    level('live-radio-box', seen == null ? '' : seen ? 'ok' : 'warn');
  }
  function setSpeed(value) {
    speed = value;
    document.querySelectorAll('[data-live-speed]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.liveSpeed) === value)));
  }
  function banner(tag, title, lvl) {
    $('live-banner').hidden = !title; $('live-banner').dataset.level = lvl ?? '';
    $('live-banner-tag').textContent = tag ?? ''; $('live-banner-title').textContent = title ?? '';
  }
  function directive({ tag = 'FLIGHT · ON BOARD', title, text, count = '', cover = '', time = '', lvl = 'warn' }) {
    $('live-directive').hidden = false; $('live-directive').dataset.level = lvl;
    $('live-directive-tag').textContent = tag; $('live-directive-title').textContent = title; $('live-directive-text').textContent = text;
    $('live-directive-count').textContent = count; $('live-directive-count').hidden = !count;
    $('live-directive-cover').textContent = cover; $('live-directive-cover').hidden = !cover;
    $('live-directive-time').textContent = time; $('live-directive-time').hidden = !time;
  }
  const drillButtons = on => document.querySelectorAll('[data-drill]').forEach(b => { b.disabled = !on; });

  function phaseText(phase) {
    const move = snap.travel === 'rover' ? 'Driving' : 'Walking', st = phase.station;
    if (phase.kind === 'science') return `Station ${st.n} · ${st.name}: ${st.task.toLowerCase()}`;
    if (phase.kind === 'back') return `${move} home`;
    return st ? `${move} to station ${st.n} · ${st.name}` : `${move} out`;
  }
  function stepWalk(dt) {
    simT += dt * speed;
    const st = stateAt(timeline, snap.plan, simT), position = pointAt(samples, st.d);
    moveCrew(position);
    const home = snap.toBase(position), left = snap.plan.usable - st.elapsed;
    gauges(position, st.elapsed, home, left, home == null ? null : left - home);
    $('live-phase').textContent = st.done ? 'Back at base.' : phaseText(st.phase);
    $('live-track-fill').style.width = `${(100 * st.elapsed / timeline.total).toFixed(1)}%`;
    if (st.done) {
      mode = 'done'; drillButtons(false); $('live-again').hidden = false;
      directive({ title: 'WALK COMPLETE', text: `Back inside after ${formatDuration(timeline.total)}, with ${formatDuration(snap.plan.margin)} of suit time unused and the reserve untouched.`, lvl: 'ok' });
      banner('BACK AT BASE', 'WALK COMPLETE', 'ok');
    }
  }

  function throwProblem(kind) {
    if (mode !== 'walk') return;
    const st = stateAt(timeline, snap.plan, simT), position = pointAt(samples, st.d);
    if (st.d < 25) { notify('The crew is at the airlock. Let the walk get going first.', 4000); return; }
    const t0 = performance.now();
    const { grid, time } = snap.field, cell = cellOf(grid, position);
    const path = cell ? homePath({ ...grid, time }, cell.i, snap.params) : null;
    if (!path) { notify('No walkable way home is mapped from this spot.', 5000); return; }
    const rideHome = snap.travel === 'rover' ? st.d / ROVER_SPEED : null;
    const decision = decide(kind, { elapsed: st.elapsed, usable: snap.plan.usable, walkHome: path.seconds, rideHome, travel: snap.travel });
    const cover = kind === 'storm' ? shield?.bestCover(position, 300) : null;
    const ms = performance.now() - t0;

    const riding = decision.means === 'ride';
    const cells = path.cells.map(i => ({ ...pointOf(grid, i % grid.width, (i / grid.width) | 0), t: time[i] }));
    const way = riding ? samples.filter(s => s.d <= st.d).reverse() : cells;
    line(way.filter((_, i) => i % Math.ceil(way.length / 400) === 0 || i === way.length - 1), decision.level === 'bad' ? '#ff5a48' : '#7fffd4');
    let coverText = '';
    if (cover) {
      if (cover.value >= .12 && cover.metres > 15) { marker(cover, `COVER · ${Math.round(cover.value * 100)}% OF SKY HIDDEN`, '#7ad3ff'); coverText = decision.spare < 0
        ? `You cannot beat the storm home. Cover ${Math.round(cover.metres)} m away hides ${Math.round(cover.value * 100)}% of the sky: it trims the dose, it does not stop it. Keep moving home.`
        : `Closest cover: ${Math.round(cover.metres)} m away the ground hides ${Math.round(cover.value * 100)}% of the sky. Use it only if you cannot make it inside.`; }
      else coverText = `No cover within 300 m: the ground here hides at most ${Math.round(cover.value * 100)}% of the sky. Base is the shelter.`;
    }
    drill = { kind, decision, elapsed0: st.elapsed, tau: 0, total: decision.home, riding, cells, k: 0, d0: st.d, slow: decision.slow, coverText,
      time: `Decided on board in ${ms < 1 ? 'under 1' : Math.round(ms)} ms. A question to Houston and its answer: ${formatDelay(2 * lightTimeSeconds())}.` };
    mode = 'drill'; drillButtons(false); if (speed > 60 || !speed) setSpeed(60);
    $('live-phase').textContent = `${DRILLS[kind].label}. ${riding ? 'Driving' : 'Walking'} home: ${metres(riding ? st.d : path.metres)}.`;
    banner(DRILLS[kind].label.toUpperCase(), decision.title, decision.level);
    stepDrill(0);
  }
  function drillPosition() {
    if (drill.riding) return pointAt(samples, Math.max(0, drill.d0 - drill.tau * ROVER_SPEED));
    const c = drill.cells, target = c[0].t - drill.tau / drill.slow;
    while (drill.k < c.length - 2 && c[drill.k + 1].t > target) drill.k++;
    const a = c[drill.k], b = c[Math.min(drill.k + 1, c.length - 1)], f = Math.max(0, Math.min(1, (a.t - target) / (a.t - b.t || 1)));
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
  }
  function stepDrill(dt) {
    drill.tau = Math.min(drill.total, drill.tau + dt * speed);
    const { kind, decision: d, tau } = drill, fmt = formatDuration, position = drillPosition(), remaining = drill.total - tau;
    moveCrew(position);
    const left = kind === 'leak' ? DRILLS.leak.air - tau : snap.plan.usable - drill.elapsed0 - tau;
    gauges(position, drill.elapsed0 + tau, remaining, left, d.spare);
    $('live-suit').textContent = kind === 'leak' ? `${fmt(Math.max(0, left))} of air` : fmt(Math.max(0, left));
    const arrived = tau >= drill.total;
    let count = `Home in ${clock(remaining)}`;
    if (kind === 'storm') { const until = DRILLS.storm.warn - tau; count += until >= 0 ? ` · particles in ${clock(until)}` : ` · in the storm for ${clock(-until)}`; }
    if (kind === 'leak') count += left >= 0 ? ` · air for ${clock(left)}` : ` · on shared air for ${clock(-left)}`;
    if (!arrived) { directive({ title: d.title, text: d.text, count, cover: drill.coverText, time: drill.time, lvl: d.level }); return; }

    const reserve = snap.params.reserveMinutes * 60;
    let title = 'HOME SAFE', lvl = 'ok', text;
    if (d.spare >= 0) text = kind === 'storm' ? `Inside ${fmt(d.spare)} before the particles arrive.` : kind === 'leak' ? `Inside with ${fmt(d.spare)} of air left.` : `Inside with ${fmt(d.spare)} of suit time to spare.`;
    else if (kind === 'storm') { title = 'HOME'; lvl = 'bad'; text = `Inside after ${fmt(-d.spare)} in the storm. The dose goes to the flight surgeon. Next time, turn back sooner or plan a route past cover.`; }
    else if (kind === 'leak') { title = 'HOME ON SHARED AIR'; lvl = 'bad'; text = `The leaking suit ran dry ${fmt(-d.spare)} from base. The crewmate's supply covered it.`; }
    else if (-d.spare <= reserve) { title = 'HOME ON RESERVE'; lvl = 'warn'; text = `Used ${fmt(-d.spare)} of the ${snap.params.reserveMinutes} min reserve. This is what the reserve is for.`; }
    else { title = 'PICKUP NEEDED'; lvl = 'bad'; text = `Suit time ran out ${fmt(-d.spare - reserve)} from base, even with the reserve. This walk needs a second crew on standby.`; }
    mode = 'done'; $('live-again').hidden = false; $('live-phase').textContent = 'Back at base.';
    directive({ title, text, time: drill.time, lvl }); banner(DRILLS[kind].label.toUpperCase(), title, lvl);
  }

  function tick(now) {
    const dt = Math.min(.1, (now - lastNow) / 1000); lastNow = now;
    if (mode === 'walk') stepWalk(dt); else if (mode === 'drill') stepDrill(dt);
    frame = mode === 'walk' || mode === 'drill' ? requestAnimationFrame(tick) : 0;
  }
  function run() {
    clearMap(); simT = 0; drill = null; mode = 'walk'; setSpeed(300);
    $('live-directive').hidden = true; $('live-again').hidden = true; banner(); drillButtons(true);
    stepWalk(0); lastNow = performance.now(); cancelAnimationFrame(frame); frame = requestAnimationFrame(tick);
  }
  function start() {
    snap = marswalk.live();
    if (!snap || snap.state.profile.samples.length < 2) { notify('The walk is still being checked. Try again in a moment.'); return; }
    samples = snap.state.profile.samples;
    timeline = buildTimeline(snap.plan, snap.stations, snap.params.stopMinutes * 60);
    document.body.dataset.live = 'on'; $('live-panel').hidden = false;
    document.querySelector('[data-drill=rover]').hidden = snap.travel !== 'rover';
    $('live-earth-delay').textContent = formatDelay(2 * lightTimeSeconds());
    shield?.ensure().catch(() => {});
    routes.fit?.();
    run();
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0; mode = 'idle'; clearMap(); banner();
    delete document.body.dataset.live; $('live-panel').hidden = true;
  }

  $('live-start').addEventListener('click', start);
  $('live-close').addEventListener('click', stop);
  $('live-again').addEventListener('click', run);
  document.querySelectorAll('[data-live-speed]').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.liveSpeed))));
  document.querySelectorAll('[data-drill]').forEach(b => b.addEventListener('click', () => throwProblem(b.dataset.drill)));

  return { start, stop, throwProblem, get active() { return mode !== 'idle'; }, get state() { return { mode, simT, here, drill: drill && { kind: drill.kind, title: drill.decision.title, spare: drill.decision.spare, home: drill.decision.home } }; } };
}
