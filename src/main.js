import {
  Viewer, Ellipsoid, Globe, GeographicProjection, GeographicTilingScheme,
  EllipsoidTerrainProvider, SingleTileImageryProvider, UrlTemplateImageryProvider,
  Cartesian2, Cartesian3, Rectangle, Color, Credit, Math as CMath,
  LabelStyle, VerticalOrigin, DistanceDisplayCondition,
  ScreenSpaceEventHandler, ScreenSpaceEventType, EllipsoidGeodesic, HeightReference, EllipsoidalOccluder,
} from 'cesium';
import { MARS_RADIUS, DATASETS, PLACES, parseCoordinates, containsPoint, formatCoordinate } from './data.js';
import { renderPlan, minimumCameraHeight, detailDatasetId } from './quality.js';
import { createGlobePresentation } from './globe-presentation.js';
import { boot } from './launch.js';
import { showPage } from './home.js';
import { createMissionLog } from './mission-log.js';
import { createSurfaceRoutes } from './surface-routes.js';
import { createGroundViews } from './surface-view.js';
import { GROUND_SITES } from './ground-sites.js';
import { createJourney } from './journey-view.js';
import { createMarsTerrain } from './mars-terrain.js';
import { createHazardLayer } from './hazard-layer.js';
import { createGroundTruth } from './ground-truth.js';
import { createMarswalk } from './marswalk.js';
import { registerOffline } from './offline.js';
import { createMarsNow } from './mars-now.js';
import { createHud } from './hud.js';
import { createLandingSites } from './landing-sites.js';
import { createWorkspace } from './workspace.js';
import { initializeTileAccess, tileTemplate, hasDeviceCache } from './tile-access.js';
import { createGroundImagery } from './ground-imagery.js';
import { createTerrainPlanner } from './terrain-planner.js';
import { bearingTo } from './surface-navigation.js';
import { loadGeology, unitAt, describeAge, loadLocalGeology, localUnitAt } from './geology.js';
import { createGroundPhotos } from './ground-photos.js';
import { createTraverseSheet } from './traverse-sheet.js';
import { createShield } from './shield.js';
import { createLiveEva } from './live-eva.js';
import { createBriefing } from './briefing.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mars = new Ellipsoid(MARS_RADIUS, MARS_RADIUS, MARS_RADIUS);
Ellipsoid.default = mars;
const tilingScheme = new GeographicTilingScheme({ ellipsoid: mars, numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 });
let viewer, mode = 'viking', activeId = 'viking', pendingTiles = 0, rotationFrame = 0, lastTime = 0;
let noticeTimer, lastMetrics = 0, previousSource = '', selectedId = '', pointerPosition = null;
let ultraQuality = false, zoomLimit = 300, detailId = 'ctx', correctingZoom = false;
let surfaceRoutes, surfaceView, journey, terrain, hazards, groundTruth, marswalk, landingSites, workspace;
let terrainMode = false, terrainRequest = 0, groundImagery, groundPhotos, shield, liveEva, briefing;
let globePresentation, presentationLighting = true, startupFailed = false, geology = null, lastGeologyCode = '';
let photoReturnPage = 'places';
let missionLog, lastMapPosition, terrainEnabled = false;
let pointerUpdate;
const layers = {}, entities = [], failures = new Set();

function groundHeightAt(c) { return terrain?.heightAt({lon:CMath.toDegrees(c.longitude),lat:CMath.toDegrees(c.latitude)})??0; }
function pickSurface(position) {const ray=viewer.camera.getPickRay(position);return (ray&&viewer.scene.globe.pick(ray,viewer.scene))||viewer.camera.pickEllipsoid(position,mars);}
function viewCenter() {
  if (journey?.active) return viewer.camera.positionCartographic;
  const point = pickSurface(new Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
  return point ? mars.cartesianToCartographic(point) : viewer.camera.positionCartographic;
}

function updateZoomLimit() {
  if (!viewer) return;
  if (journey?.active) { viewer.scene.screenSpaceCameraController.minimumZoomDistance = .2; return; }
  if (terrainMode) { const c = viewCenter(); viewer.scene.screenSpaceCameraController.minimumZoomDistance = containsPoint(DATASETS.hirise.bounds, CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)) ? 50 : 1000; return; }
  const center = viewCenter();
  detailId = detailDatasetId(mode, CMath.toDegrees(center.longitude), CMath.toDegrees(center.latitude));
  zoomLimit = minimumCameraHeight(DATASETS[detailId], viewer.canvas.clientHeight, viewer.camera.frustum.fovy);
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = zoomLimit;
  const c = viewer.camera.positionCartographic;
  const ground=groundHeightAt(c),height=c.height-ground;
  const atLimit = height <= zoomLimit * 1.04;
  $('zoom-in').title = atLimit ? `${DATASETS[detailId].title}: available image detail limit` : 'Zoom in';
  document.body.dataset.zoomLimit = String(Math.round(zoomLimit));
  if (!correctingZoom && height < zoomLimit * .98) {
    correctingZoom = true;
    const camera = viewer.camera;
    camera.setView({
      destination: Cartesian3.fromRadians(c.longitude, c.latitude, zoomLimit+ground, mars),
      orientation: { heading: camera.heading, pitch: camera.pitch, roll: camera.roll },
    });
    correctingZoom = false;
    viewer.scene.requestRender();
  }
}

function applyQuality() {
  const plan = renderPlan(viewer.canvas.clientWidth, viewer.canvas.clientHeight, window.devicePixelRatio || 1, ultraQuality || 'auto');
  viewer.resolutionScale = plan.resolutionScale;
  viewer.scene.globe.maximumScreenSpaceError = ultraQuality ? .35 : 1.15;
  viewer.scene.globe.tileCacheSize = ultraQuality ? 768 : 240;
  viewer.targetFrameRate = ultraQuality ? 60 : 45;
  viewer.resize();
  $('quality-button').textContent = ultraQuality ? 'Ultra' : 'Auto';
  $('quality-button').setAttribute('aria-pressed', String(ultraQuality));
  $('quality-button').title = ultraQuality ? 'Ultra: up to 4K rendering. Switch to Auto for less system use.' : 'Auto: lower GPU load. Switch to Ultra for maximum detail.';
  document.body.dataset.quality = ultraQuality ? 'ultra' : 'auto';
  document.body.dataset.renderWidth = String(viewer.canvas.width);
  document.body.dataset.renderHeight = String(viewer.canvas.height);
  updateZoomLimit();
  viewer.scene.requestRender();
}

function notify(message, duration = 5000) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, duration);
}

function setPanel(collapsed) {
  if (!collapsed) surfaceRoutes?.close();
  $('discovery-panel').classList.toggle('is-collapsed', collapsed);
  $('discovery-panel').inert = collapsed;
  $('explore-panel-toggle').classList.toggle('is-active', !collapsed);
  $('explore-panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  const name = collapsed ? 'Expand explorer panel' : 'Collapse explorer panel';
  $('panel-toggle').title = name;
  $('panel-toggle').setAttribute('aria-label', name);
}

function stopRotation() {
  cancelAnimationFrame(rotationFrame);
  rotationFrame = 0;
  lastTime = 0;
  $('rotate-button').setAttribute('aria-pressed', 'false');
}

function setSource(id) {
  activeId = id;
  updateTileStatus();
  const dataset = DATASETS[id];
  const overviewActive = id === 'viking' && !layers.viking?.show;
  const sourceKey = `${id}:${overviewActive ? 'overview' : 'tiles'}`;
  if (previousSource === sourceKey) return;
  previousSource = sourceKey;
  $('source-title').textContent = overviewActive ? 'Viking · 8K global color' : dataset.title;
  $('source-resolution').textContent = overviewActive ? '8K overview' : dataset.sourceMpp < 1 ? '25 cm/px source' : `${dataset.sourceMpp} m/px source`;
  $('source-description').textContent = `${failures.has(id) ? 'Some detail is unavailable; coarser imagery may appear. ' : ''}${overviewActive ? 'An 8,192 × 4,096 NASA/USGS color map. Closer views load finer original mission imagery.' : dataset.description}`;
  $('source-credit').textContent = dataset.credit;
  $('source-credit').title = dataset.credit;
  document.body.dataset.source = id;
}

let occluder, labelsOn = true;
function hideFarSideLabels() {
  occluder ??= new EllipsoidalOccluder(mars, viewer.camera.positionWC);
  occluder.cameraPosition = viewer.camera.positionWC;
  for (const entity of entities) {
    const position = entity.position?.getValue(viewer.clock.currentTime);
    if (position) entity.show = labelsOn && occluder.isPointVisible(position);
  }
}

function updateLayers() {
  if (!viewer) return;
  hideFarSideLabels();
  const camera = viewer.camera.positionCartographic;
  const height = camera.height;
  const center = viewCenter();
  const lat = CMath.toDegrees(center.latitude), lon = CMath.toDegrees(center.longitude);
  const onHome = document.body.dataset.page === 'home';
  const display = onHome ? 'viking' : mode;
  const surface = display === 'viking' || display === 'geology';
  layers.viking.show = height < 5_000_000;
  const ctxAlpha = surface ? CMath.clamp((2_000_000 - height) / 1_200_000, 0, 1) : 0;
  layers.ctx.show = surface && ctxAlpha > 0;
  layers.ctx.alpha = ctxAlpha;
  const nearJezero = Math.abs(lon - 77.45) < 2 && Math.abs(lat - 18.45) < 2;
  const hiAlpha = surface && nearJezero ? CMath.clamp((65_000 - height) / 40_000, 0, 1) : 0;
  layers.hirise.show = hiAlpha > 0;
  layers.hirise.alpha = hiAlpha;
  layers.themis.show = display === 'themis';
  layers.mola.show = display === 'mola';
  layers.geology.show = display === 'geology';
  layers.geology.alpha = .62;
  if (localGeologyLayer) localGeologyLayer.show = display === 'geology';
  if (display === 'mola') setSource('mola');
  else if (display === 'geology') setSource('geology');
  else if (display === 'themis') setSource(containsPoint(DATASETS.themis.bounds, lon, lat) ? 'themis' : 'viking');
  else if (hiAlpha > .9 && containsPoint(DATASETS.hirise.bounds, lon, lat)) setSource('hirise');
  else if (ctxAlpha > .9 && containsPoint(DATASETS.ctx.bounds, lon, lat)) setSource('ctx');
  else setSource('viking');
  globePresentation?.update({ mode: display, height, enabled: onHome || presentationLighting });
  $('lighting-button').disabled = mode !== 'viking';
  $('lighting-button').setAttribute('aria-pressed', String(presentationLighting && mode === 'viking'));
  updateZoomLimit();
  viewer.scene.requestRender();
}

let localGeology = null, localGeologyLayer = null;
function showLocalGeology() {
  loadLocalGeology(import.meta.env.BASE_URL).then(async g => {
    localGeology = g; lastGeologyCode = '';
    if (!localGeologyLayer) {
      const b = g.bounds;
      const provider = await SingleTileImageryProvider.fromUrl(g.overlayUrl, { rectangle: Rectangle.fromDegrees(b.west, b.south, b.east, b.north), ellipsoid: mars,
        credit: new Credit('Jezero geology: USGS SIM 3464 (Sun & Stack 2020), 1:75,000') });
      localGeologyLayer = viewer.imageryLayers.addImageryProvider(provider);
    }
    localGeologyLayer.show = mode === 'geology' && document.body.dataset.page !== 'home'; viewer.scene.requestRender();
  }).catch(error => console.warn('[MartisDux] Jezero geology overlay unavailable.', error));
}

function changeMode(next) {
  mode = next;
  if (next !== 'viking') groundImagery?.close();
  document.querySelectorAll('[data-layer]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layer === mode)));
  updateLayers();
  if (mode === 'themis') notify('Infrared view from Mars Odyssey.');
  if (mode === 'mola') notify('Height map: blue is low, red is high.');
  $('geology-readout').hidden = mode !== 'geology';
  if (mode === 'geology') {
    notify('Geology map. Point at the map to see the rock type.', 5000);
    showLocalGeology();
    loadGeology(import.meta.env.BASE_URL).then(g => { geology = g; lastGeologyCode = ''; viewer.scene.requestRender(); })
      .catch(() => { $('geology-unit').textContent = 'Unit lookup unavailable'; });
  }
}

function updateGeologyReadout(cartographic) {
  if (mode !== 'geology' || !geology) return;
  const p = { lon: CMath.toDegrees(cartographic.longitude), lat: CMath.toDegrees(cartographic.latitude) };
  const local = localUnitAt(localGeology, p);
  if (local) {
    if (lastGeologyCode === `L${local.code}`) return;
    lastGeologyCode = `L${local.code}`;
    $('geology-source').textContent = 'UNDER THE POINTER · USGS JEZERO MAP 1:75,000';
    $('geology-unit').textContent = `${local.name} (${local.code})`;
    $('geology-age').textContent = `${local.notes} ${local.age}.`;
    return;
  }
  const unit = unitAt(geology, p);
  const code = unit?.code ?? '';
  if (code === lastGeologyCode) return;
  lastGeologyCode = code;
  $('geology-source').textContent = 'UNDER THE POINTER · USGS MAP OF MARS 1:20M';
  $('geology-unit').textContent = unit ? `${unit.description} (${unit.code})` : 'No mapped unit';
  $('geology-age').textContent = unit ? describeAge(unit) : '';
}

function navigate(page) {
  const previous = document.body.dataset.page;
  if (previous === page) return false;
  if (page === 'log') {
    const surfacePosition = journey?.active ? journey.position : null;
    const point = pointerPosition ? pickSurface(pointerPosition) : null;
    const cartographic = point ? mars.cartesianToCartographic(point) : viewCenter();
    lastMapPosition = surfacePosition ?? { lat: CMath.toDegrees(cartographic.latitude), lon: CMath.toDegrees(cartographic.longitude) };
    journey?.close({ restorePanels: false });
    stopRotation();
    viewer.camera.cancelFlight();
  }
  if (previous === 'log') {
    missionLog.close();
    viewer.useDefaultRenderLoop = true;
  }
  if (page !== 'photos') surfaceView?.close({ restorePanels: false });
  if (previous === 'terrain') topDown(page !== 'home');
  if (page === 'terrain' || page === 'log') setPanel(true);
  showPage(page);
  if (page !== 'home' && page !== 'log') activateTerrain();
  viewer.entities.show = page !== 'home';
  landingSites.setVisible(page !== 'home');

  if (page === 'log') {
    viewer.useDefaultRenderLoop = false;
    missionLog.open();
  } else if (page === 'home') {
    surfaceRoutes.close();
    setPanel(true);
    briefing.hide();
    home(false);
  } else {
    updateLayers();
  }
  return true;
}

function openPlaces() {
  navigate('places');
  setPanel(false);
}

function home(animate = true) {
  journey?.close({restorePanels:false});
  surfaceView?.close({restorePanels:false});
  topDown(false);
  stopRotation();
  selectedId = '';
  document.querySelectorAll('[data-place]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  const fovy = viewer.camera.frustum.fovy || CMath.toRadians(40);
  const aspect = viewer.canvas.clientWidth / viewer.canvas.clientHeight;
  const halfAngle = Math.min(fovy / 2, Math.atan(Math.tan(fovy / 2) * aspect));
  const distance = MARS_RADIUS / Math.sin(halfAngle * .82);
  const settings = {
    destination: Cartesian3.fromDegrees(-70, 12, distance - MARS_RADIUS, mars),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  };
  viewer.camera.cancelFlight();
  if (animate && !reducedMotion) viewer.camera.flyTo({ ...settings, duration: 1.8 });
  else viewer.camera.setView(settings);
  updateLayers();
}

function flyTo(place) {
  const page = document.body.dataset.page;
  if (page === 'home' || page === 'log') openPlaces();
  else if (page === 'terrain' || page === 'photos') navigate('places');
  topDown(false);
  journey?.close({restorePanels:false});
  surfaceView?.close({restorePanels:false});
  stopRotation();
  selectedId = place.id || '';
  document.querySelectorAll('[data-place]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.place === selectedId)));
  $('search-results').hidden = true;
  $('search-input').setAttribute('aria-expanded', 'false');
  const settings = {
    destination: Cartesian3.fromDegrees(place.lon, place.lat, place.height || 150_000, mars),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    complete: updateLayers,
  };
  viewer.camera.cancelFlight();
  if (reducedMotion) viewer.camera.setView(settings);
  else viewer.camera.flyTo({ ...settings, duration: 2.6 });
  if (window.innerWidth < 761) setPanel(true);
  notify(`${place.name || 'Coordinates'} · ${formatCoordinate(place.lat, true)}, ${formatCoordinate(place.lon, false)}`, 3500);
}

function topDown(reframe = true) {
  ++terrainRequest;
  if (!viewer) return;
  const wasTerrain = terrainMode;
  terrainMode = false; groundImagery?.close();
  viewer.scene.backgroundColor = Color.fromCssColorString('#120b07');
  $('terrain-angle').hidden = true; $('terrain-travel').hidden = true; $('map-view-button').hidden = true;
  $('terrain-button').removeAttribute('aria-busy'); $('terrain-button').setAttribute('aria-pressed', 'false'); $('terrain-button').classList.remove('is-active');
  $('view-mode-label').textContent = 'ORBITAL VIEW';
  viewer.scene.screenSpaceCameraController.enableTilt = false;
  if (reframe && wasTerrain) {
    const c = viewCenter(), ground = groundHeightAt(c);
    viewer.camera.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, Math.max(zoomLimit * 2, viewer.camera.positionCartographic.height - ground) + ground, mars), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }, duration: reducedMotion ? 0 : 1.1 });
  }
  updateZoomLimit();
}

async function openTerrain(point) {
  if (terrainMode && !point) { navigate('places'); return; }
  navigate('terrain');
  journey?.close({restorePanels:false}); surfaceView?.close({restorePanels:false}); stopRotation(); viewer.camera.cancelFlight();
  if (!point) { const c = viewCenter(); point = surfaceRoutes?.getState().start || { lon: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude) }; }
  const token = ++terrainRequest; $('terrain-button').setAttribute('aria-busy', 'true');
  notify('Loading elevation…', 10000);
  try {
    await Promise.all([terrain.prepare(point), groundImagery.load(point, (done, total) => { if (token === terrainRequest) notify(`Loading surface · ${done}/${total}`, 10000); }).catch(() => null)]);
    if (token !== terrainRequest) return;
    const ground = terrain.heightAt(point); if (!Number.isFinite(ground)) throw new Error('Elevation unavailable.');
    terrainMode = true; changeMode('viking'); viewer.scene.screenSpaceCameraController.enableTilt = true;
    $('terrain-button').setAttribute('aria-pressed', 'true'); $('terrain-button').classList.add('is-active'); $('map-view-button').hidden = false;
    $('view-mode-label').textContent = '3D TERRAIN';
    const local = terrain.infoAt(point).detail;
    const destination = surfaceRoutes?.getState().destination;
    const heading = destination ? bearingTo(point, destination) * Math.PI / 180 : Math.PI / 4;
    viewer.scene.backgroundColor = Color.fromCssColorString('#80644e');
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(point.lon, point.lat, ground + (local ? 150 : 1800), mars), orientation: { heading, pitch: CMath.toRadians(-22), roll: 0 }, duration: reducedMotion ? 0 : 1.2 });
    $('terrain-angle').hidden = false; $('terrain-angle').value = '-22';
    $('terrain-travel').hidden = !surfaceRoutes?.getState().distance; surfaceRoutes?.travelTo(-Infinity);
    notify(`${terrain.infoAt(point).title}${groundImagery.info?.partial ? ' · partial imagery' : ''}`, 3500);
    if (innerWidth < 761) setPanel(true);
  } catch { if (token === terrainRequest) notify('Elevation unavailable. Try another location.'); }
  finally { if (token === terrainRequest) $('terrain-button').removeAttribute('aria-busy'); }
}

function makeSearchResults() {
  const query = $('search-input').value.trim().toLowerCase();
  const container = $('search-results');
  container.replaceChildren();
  const coordinates = parseCoordinates(query);
  const matches = coordinates ? [{ ...coordinates, name: 'Fly to coordinates', type: `${formatCoordinate(coordinates.lat, true)}, ${formatCoordinate(coordinates.lon, false)}` }] : PLACES.filter(p => !query || `${p.name} ${p.type}`.toLowerCase().includes(query));
  matches.forEach(place => {
    const button = document.createElement('button');
    button.type = 'button';
    const title = document.createElement('strong'); title.textContent = place.name;
    const subtitle = document.createElement('small'); subtitle.textContent = place.type;
    button.append(title, subtitle);
    button.addEventListener('click', () => { $('search-input').value = coordinates ? query : place.name; flyTo(place); });
    container.append(button);
  });
  if (!matches.length) {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Search Olympus, Valles, Jezero or Gale, or enter latitude, longitude (for example 18.44, 77.45).';
    container.append(paragraph);
  }
  container.hidden = false;
  $('search-input').setAttribute('aria-expanded', 'true');
}

function showData() {
  const active = DATASETS[activeId];
  const ordered = [active, ...Object.values(DATASETS).filter(dataset => dataset !== active)];
  $('data-dialog-content').innerHTML = `<p>The surface is assembled from recorded spacecraft observations. Closer views load finer image tiles; source pixels and map-tile pixels have different sizes.</p>
    <dl><div><dt>Reference body</dt><dd>Mars · 3,396.190 km sphere</dd></div><div><dt>Coordinates</dt><dd>Planetocentric latitude · east-positive longitude</dd></div><div><dt>Surface geometry</dt><dd>NASA/ESA/USGS elevation terrain · Jezero &amp; Gale HiRISE DTMs</dd></div><div><dt>Rendering</dt><dd>${viewer.canvas.width.toLocaleString()} × ${viewer.canvas.height.toLocaleString()} · ${ultraQuality ? 'Ultra' : 'Balanced'}</dd></div></dl><p>Globe lighting adds a fixed, viewer-relative light and warm rim for depth. It is a display treatment, rather than the Sun’s current position. It fades away in regional views. Use the sun button for neutral map colors. Infrared and relief always retain their neutral display.</p>
    ${ordered.map((dataset, index) => `<section><h3>${index === 0 ? 'Currently selected: ' : ''}${dataset.title}</h3><p>${dataset.detail}</p><p><strong>${dataset.sourceLabel}</strong><br>Coverage: ${dataset.coverage}<br>Credit: ${dataset.credit}</p><p><a href="${dataset.source}" target="_blank" rel="noopener">Dataset / mission information ↗</a> · <a href="${dataset.capabilities}" target="_blank" rel="noopener">Service metadata ↗</a>${dataset.nasaSource ? ` · <a href="${dataset.nasaSource}" target="_blank" rel="noopener">NASA mission context ↗</a>` : ''}</p></section>`).join('<hr>')}
    <hr><h3>8K global overview</h3><p>The resident 8,192 × 4,096 color map is downsampled from the official NASA/USGS 21,339 × 10,670 Viking browse product. Its sampling is ~2.60 km/px; closer views stream finer original tiles. No artificial sharpening, invented detail or AI upscaling is applied. Zoom stops at the selected dataset’s available detail.</p><p><a href="https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/5ea881c6-01b3-41fa-a7af-42d2131b54f1/download/mars_viking_mdim21_clrmosaic_1km.jpg" target="_blank" rel="noopener">Original NASA/USGS map ↗</a></p><p>Independent project using public mission data. No NASA endorsement is implied.</p>`;
  $('data-dialog-content').insertAdjacentHTML('beforeend',
    '<p><a href="./credits/helmet.html" target="_blank" rel="noopener">Loading and Home artwork credits</a></p>');
  $('data-dialog').showModal();
}

function updateMetrics() {
  if (document.body.dataset.page === 'home' || document.body.dataset.page === 'log') return;
  const now = performance.now();
  if (now - lastMetrics < 100) return;
  lastMetrics = now;
  const camera = viewer.camera.positionCartographic;
  const width = viewer.canvas.clientWidth, height = viewer.canvas.clientHeight;
  const position = pointerPosition && pickSurface(pointerPosition);
  const cartographic = position ? mars.cartesianToCartographic(position) : camera;
  updateGeologyReadout(cartographic);
  shield?.readout(position ? { lon: CMath.toDegrees(cartographic.longitude), lat: CMath.toDegrees(cartographic.latitude) } : null);
  $('latitude').textContent = formatCoordinate(CMath.toDegrees(cartographic.latitude), true);
  $('longitude').textContent = formatCoordinate(CMath.toDegrees(cartographic.longitude), false);
  $('latitude').parentElement.title = position ? 'Surface coordinates under the pointer' : 'Camera subpoint coordinates';
  const km = (camera.height-groundHeightAt(camera)) / 1000;
  $('altitude').textContent = km >= 100 ? `${Math.round(km).toLocaleString()} km` : `${km.toFixed(1)} km`;
  $('altitude').title = 'Camera clearance above the available terrain model';
  $('north-button').querySelector('svg').style.transform = `rotate(${-CMath.toDegrees(viewer.camera.heading)}deg)`;
  const center = new Cartesian2(width / 2, height / 2);
  const a = pickSurface(center);
  const b = pickSurface(new Cartesian2(center.x + 100, center.y));
  if (a && b) {
    const distance = new EllipsoidGeodesic(mars.cartesianToCartographic(a), mars.cartesianToCartographic(b), mars).surfaceDistance;
    const step = 10 ** Math.floor(Math.log10(distance));
    const unit = distance / step >= 5 ? 5 : distance / step >= 2 ? 2 : 1;
    const nice = unit * step;
    $('scale-label').textContent = nice >= 1000 ? `${(nice / 1000).toLocaleString()} km` : `${Math.round(nice)} m`;
    $('scale-line').style.width = `${Math.round(100 * nice / distance)}px`;
    $('scale-label').parentElement.title = 'Approximate scale at the center of the globe';
  }
}

function wireInterface() {
  setPanel(window.innerWidth < 761);
  hazards = createHazardLayer({ viewer, mars, terrain });
  createMarsNow();
  document.querySelectorAll('[data-open-ar]').forEach(button => button.addEventListener('click', () => {
    if (!$('ar-frame').src) $('ar-frame').src = 'ar/walk.html';
    $('ar-dialog').showModal();
  }));
  $('ar-close').addEventListener('click', () => $('ar-dialog').close());
  landingSites = createLandingSites({ viewer, mars, flyTo });
  landingSites.setVisible(false);
  groundTruth = createGroundTruth({ viewer, mars, terrain, notify, stopRotation, setPlacesCollapsed: setPanel, reducedMotion });
  const finePlanner = createTerrainPlanner(terrain);
  surfaceRoutes = createSurfaceRoutes({ viewer, mars, stopRotation, setPlacesCollapsed: setPanel, reducedMotion, hazards,
    planFine: finePlanner.plan, cancelFine: finePlanner.cancel, groundHeightAt: point => terrain.heightAt(point) ?? 0, onMapView: () => topDown(false),
    minimumHeightAt: point => minimumCameraHeight(DATASETS[detailDatasetId(mode, point.lon, point.lat)], viewer.canvas.clientHeight, viewer.camera.frustum.fovy),
    onOpen: () => navigate('walk'),
    onChange: () => { surfaceView?.routeChanged(); journey?.routeChanged(); marswalk?.routeChanged(); workspace?.changed(); if (terrainMode) $('terrain-travel').hidden = !surfaceRoutes?.getState().distance; },
  });
  groundPhotos = createGroundPhotos({ viewer, mars, terrain, base: import.meta.env.BASE_URL });
  marswalk = createMarswalk({ viewer, mars, routes: surfaceRoutes, terrain, hazards, notify, photos: groundPhotos });
  createTraverseSheet({ marswalk, routes: surfaceRoutes, notify });
  shield = createShield({ viewer, mars, notify, flyTo, setPlacesCollapsed: setPanel });
  liveEva = createLiveEva({ viewer, mars, marswalk, routes: surfaceRoutes, terrain, notify, shield });
  briefing = createBriefing({ onRun: () => {
    navigate('walk');
    liveEva.stop(); topDown(false); $('eva-demo').click();
    notify('Mission Control is polling the walk. When it reads GO, press “Start the walk”.', 8000);
  } });
  surfaceView = createGroundViews({
    viewer, mars, routes: surfaceRoutes, stopRotation, setPlacesCollapsed: setPanel,
    onOpen: () => {
      const previous = document.body.dataset.page;
      photoReturnPage = previous === 'walk' ? 'walk' : 'places';
      navigate('photos');
    },
    onClose: () => {
      if (document.body.dataset.page === 'photos') {
        showPage(photoReturnPage);
        updateLayers();
      }
    },
  });
  journey = createJourney({ viewer, mars, routes: surfaceRoutes, photos: surfaceView, stopRotation, setPlacesCollapsed: setPanel,
    terrain, hazards, hud: createHud({ marswalk, hazards }), getMode: () => mode, setMode: changeMode, getImageryState: () => ({id: activeId, pending: pendingTiles, partial: failures.has(activeId)}) });
  $('journey-start').addEventListener('click', () => topDown(false), { capture: true });
  workspace = createWorkspace({
    routes: surfaceRoutes, photos: surfaceView, notify, openTerrain, topDown,
    onMapView: () => { navigate('places'); topDown(); },
  });
  function advance(delta) {
    const next = surfaceRoutes.travelTo(delta); if (!next || !terrainMode) return;
    const ground = terrain.heightAt(next.point); if (!Number.isFinite(ground)) return;
    groundImagery.update(next.point);
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(next.point.lon, next.point.lat, ground + (terrain.infoAt(next.point).detail ? 150 : 1800), mars), orientation: { heading: CMath.toRadians(next.heading), pitch: CMath.toRadians(Number($('terrain-angle').value)), roll: 0 }, duration: reducedMotion ? 0 : .8 });
  }
  $('route-step').addEventListener('click', () => advance(50));
  $('route-reset').addEventListener('click', () => advance(-Infinity));
  $('terrain-angle').addEventListener('change', () => { viewer.camera.setView({ orientation: { heading: viewer.camera.heading, pitch: CMath.toRadians(Number($('terrain-angle').value)), roll: 0 } }); viewer.scene.requestRender(); });
  $('retry-tiles').addEventListener('click', () => {
    const ids = new Set([...failures, activeId].filter(id => layers[id]));
    for (const id of ids) { const old = layers[id], index = viewer.imageryLayers.indexOf(old); viewer.imageryLayers.remove(old, true); layers[id] = addDatasetLayer(id, index); }
    failures.clear(); previousSource = ''; updateLayers();
    if (terrainMode) { const c = viewer.camera.positionCartographic; groundImagery.close(); openTerrain({ lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude) }); }
    else notify('Reloading available detail');
  });
  $('panel-toggle').addEventListener('click', () => setPanel(!$('discovery-panel').classList.contains('is-collapsed')));
  $('explore-panel-toggle').addEventListener('click', () => {
    if (document.body.dataset.page !== 'places') openPlaces();
    else setPanel(!$('discovery-panel').classList.contains('is-collapsed'));
  });
  $('home-explore').addEventListener('click', () => {
    openPlaces();
    $('explore-panel-toggle').focus({ preventScroll: true });
  });
  $('home-nav').addEventListener('click', () => navigate('home'));
  missionLog = createMissionLog({ getPosition: () => lastMapPosition });
  function openLog() {
    navigate('log');
    $('log-nav').focus({ preventScroll: true });
  }
  $('log-nav').addEventListener('click', openLog);
  $('journey-log').addEventListener('click', openLog);
  $('search-focus').addEventListener('click', () => { $('search-input').focus(); });
  $('brand-home').addEventListener('click', () => navigate('home'));
  document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => flyTo(PLACES.find(p => p.id === button.dataset.place))));
  document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.layer)));
  $('home-button').addEventListener('click', () => home());
  $('hazard-toggle').addEventListener('click', async () => {
    const show = !hazards.visible;
    try { await hazards.setVisible(show); }
    catch { notify('Elevation data could not load, so slope hazards are unavailable.'); return; }
    if (show) notify('Red is too steep to walk. Zoom in for more detail.', 5000);
  });
  $('quality-button').addEventListener('click', () => { ultraQuality = !ultraQuality; applyQuality(); });
  $('lighting-button').addEventListener('click', () => {
    presentationLighting = !presentationLighting;
    $('lighting-button').querySelector('span').textContent = presentationLighting ? 'Globe light' : 'Map light';
    $('lighting-button').title = presentationLighting ? 'Orbital lighting on. Click for neutral map colors. Lighting fades away in close-up views.' : 'Neutral map colors. Click for warm globe lighting.';
    updateLayers();
  });
  window.addEventListener('resize', applyQuality);
  window.addEventListener('offline', () => notify('Offline. Places you have already viewed still work.', 5000));
  window.addEventListener('online', () => notify('Back online. Live NASA data will refresh.', 4000));
  const zoom = (direction) => {
    stopRotation();
    viewer.camera.cancelFlight();
    const camera = viewer.camera;
    const c = camera.positionCartographic;
    updateZoomLimit();
    if (direction > 0 && c.height-groundHeightAt(c) <= zoomLimit * 1.03) {
      const dataset = DATASETS[detailId];
      notify(`${dataset.title}: available image detail reached.${detailId === 'ctx' ? ' Jezero offers finer HiRISE coverage.' : ''}`, 3500);
      return;
    }
    const ground=groundHeightAt(c);
    const targetHeight = ground+CMath.clamp((c.height-ground) * (1 - direction), zoomLimit, MARS_RADIUS * 20);
    camera.flyTo({
      destination: Cartesian3.fromRadians(c.longitude, c.latitude, targetHeight, mars),
      orientation: { heading: camera.heading, pitch: camera.pitch, roll: camera.roll },
      duration: reducedMotion ? 0 : .3,
      complete: updateLayers,
    });
  };
  $('zoom-in').addEventListener('click', () => zoom(.4));
  $('zoom-out').addEventListener('click', () => zoom(-.65));
  $('north-button').addEventListener('click', () => {
    stopRotation();
    const c = viewer.camera.positionCartographic;
    viewer.camera.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, c.height, mars), orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 }, duration: reducedMotion ? 0 : .6 });
  });
  $('fullscreen-button').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('Use your browser’s full-screen command to expand the map.'); }
  });
  $('labels-toggle').addEventListener('click', () => {
    const show = $('labels-toggle').getAttribute('aria-pressed') !== 'true';
    $('labels-toggle').setAttribute('aria-pressed', String(show));
    labelsOn = show; hideFarSideLabels(); viewer.scene.requestRender();
    viewer.scene.requestRender();
  });
  $('rotate-button').addEventListener('click', () => {
    if (rotationFrame) return stopRotation();
    viewer.camera.cancelFlight();
    $('rotate-button').setAttribute('aria-pressed', 'true');
    const tick = (time) => {
      if (lastTime) viewer.camera.rotateRight(Math.min(time - lastTime, 50) * .000025);
      lastTime = time;
      viewer.scene.requestRender();
      rotationFrame = requestAnimationFrame(tick);
    };
    rotationFrame = requestAnimationFrame(tick);
  });
  $('data-button').addEventListener('click', showData);
  $('sources-button').addEventListener('click', showData);
  $('data-rail-button').addEventListener('click', showData);
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('replay-opening').addEventListener('click', () => {
    $('help-dialog').close();
    navigate('home');
    boot.replay();
  });
  for (const name of ['data', 'help']) {
    $(`${name}-close`).addEventListener('click', () => $(`${name}-dialog`).close());
    $(`${name}-dialog`).addEventListener('click', (event) => {
      if (event.target === $(`${name}-dialog`)) {
        const r = event.target.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close();
      }
    });
  }
  $('search-input').addEventListener('input', makeSearchResults);
  $('search-input').addEventListener('focus', makeSearchResults);
  $('search-form').addEventListener('submit', event => {
    event.preventDefault();
    if ($('search-results').hidden) makeSearchResults();
    $('search-results').querySelector('button')?.click();
  });
  $('search-input').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); $('search-results').querySelector('button')?.focus(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.search-wrap')) { $('search-results').hidden = true; $('search-input').setAttribute('aria-expanded', 'false'); }
  });
  viewer.canvas.addEventListener('pointerdown', stopRotation);
  viewer.canvas.addEventListener('wheel', stopRotation, { passive: true });
  viewer.canvas.addEventListener('pointerleave', () => {
    pointerPosition = null;
    queuePointerMetrics();
  });
  viewer.canvas.tabIndex = 0;
  viewer.canvas.setAttribute('aria-label', 'Mars globe. Drag to rotate. Scroll or use plus and minus to zoom. Arrow keys rotate. Home returns to global view.');
  document.addEventListener('keydown', event => {
    if (surfaceView?.active || journey?.active) return;
    if (event.key === 'Escape') { $('search-results').hidden = true; $('search-input').setAttribute('aria-expanded', 'false'); stopRotation(); }
    if (event.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
    if (event.key === '/') { event.preventDefault(); $('search-input').focus(); }
    if (event.key === 'Home') { event.preventDefault(); navigate('home'); }
    if (event.target !== viewer.canvas && event.target !== $('globe')) return;
    const actions = { ArrowLeft: () => viewer.camera.rotateRight(.04), ArrowRight: () => viewer.camera.rotateLeft(.04), ArrowUp: () => viewer.camera.rotateDown(.04), ArrowDown: () => viewer.camera.rotateUp(.04), '+': () => zoom(.3), '=': () => zoom(.3), '-': () => zoom(-.4) };
    if (actions[event.key]) { event.preventDefault(); stopRotation(); actions[event.key](); viewer.scene.requestRender(); }
  });
}

function queuePointerMetrics() {
  if (pointerUpdate) return;
  pointerUpdate = setTimeout(() => {
    pointerUpdate = null;
    updateMetrics();
  }, Math.max(0, 101 - (performance.now() - lastMetrics)));
}

function activateTerrain() {
  if (terrainEnabled) return;
  terrainEnabled = true;
  terrain.ready.then(() => {
    viewer.terrainProvider = terrain.provider;
    viewer.scene.requestRender();
  }).catch(error => {
    terrainEnabled = false;
    console.warn('[MartisDux] Could not start the elevation provider.', error);
  });
}

function addDatasetLayer(id, index) {
  const dataset = DATASETS[id];
  const provider = new UrlTemplateImageryProvider({
    url: tileTemplate(id, dataset.url), tilingScheme,
    rectangle: dataset.bounds ? Rectangle.fromDegrees(...dataset.bounds) : Rectangle.MAX_VALUE,
    tileWidth: dataset.tileSize, tileHeight: dataset.tileSize, maximumLevel: dataset.maximumLevel,
    credit: new Credit(dataset.credit), enablePickFeatures: false,
  });
  provider.errorEvent.addEventListener(error => {
    error.retry = false;
    if (!failures.has(id)) {
      failures.add(id);
      if (id === activeId) { previousSource = ''; setSource(id); }
      console.warn(`[MartisDux] ${id} tile unavailable; retaining parent imagery.`);
      if (id === activeId) notify('Some image tiles are unavailable. The available overview stays visible.');
    }
    updateTileStatus();
  });
  const layer = viewer.imageryLayers.addImageryProvider(provider, index);
  layer.maximumAnisotropy = 16;
  return layer;
}

async function initialize() {
  const typeReady = document.fonts.load('400 48px "Julius Sans One"').catch(() => []);
  boot.stage('Preparing the Mars globe');
  await initializeTileAccess();
  terrain = createMarsTerrain(mars);
  viewer = new Viewer('globe', {
    ellipsoid: mars, globe: new Globe(mars), mapProjection: new GeographicProjection(mars),
    terrainProvider: new EllipsoidTerrainProvider({ ellipsoid: mars }),
    baseLayer: false, baseLayerPicker: false, geocoder: false, animation: false,
    timeline: false, sceneModePicker: false, navigationHelpButton: false, homeButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false,
    skyBox: false, skyAtmosphere: false, useBrowserRecommendedResolution: false,
    requestRenderMode: true, maximumRenderTimeChange: Infinity,
    scene3DOnly: true, targetFrameRate: 45,
    contextOptions: { webgl: { alpha: false, antialias: true } },
  });
  viewer.scene.backgroundColor = Color.fromCssColorString('#120b07');
  viewer.scene.globe.baseColor = Color.fromCssColorString('#8c6852');
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.fog.enabled = false;
  if (viewer.scene.sun) viewer.scene.sun.show = false;
  if (viewer.scene.moon) viewer.scene.moon.show = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 300;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = MARS_RADIUS * 20;
  viewer.scene.screenSpaceCameraController.inertiaSpin = .85;
  viewer.scene.screenSpaceCameraController.inertiaZoom = .75;
  viewer.scene.screenSpaceCameraController.enableTilt = false;
  globePresentation = createGlobePresentation(viewer, { radius: MARS_RADIUS });
  viewer.camera.percentageChanged = .015;
  const overview = await SingleTileImageryProvider.fromUrl(`${import.meta.env.BASE_URL}data/viking-overview.jpg?v=8k`, {
    rectangle: Rectangle.MAX_VALUE, ellipsoid: mars,
    credit: new Credit('Viking overview: NASA / JPL / USGS'),
  });
  viewer.imageryLayers.addImageryProvider(overview);
  viewer.entities.show = false;
  for (const id of Object.keys(DATASETS)) { layers[id] = addDatasetLayer(id); layers[id].show = false; }
  PLACES.forEach(place => {
    entities.push(viewer.entities.add({
      id: place.id, position: Cartesian3.fromDegrees(place.lon, place.lat, 150, mars),
      point: { heightReference:HeightReference.CLAMP_TO_GROUND, pixelSize: 5, color: Color.fromCssColorString('#f2d2ad'), outlineColor: Color.fromCssColorString('#282522'), outlineWidth: 2 },
      label: { heightReference:HeightReference.CLAMP_TO_GROUND, text: place.name.toUpperCase() + (GROUND_SITES.some(site=>site.id===place.id) ? ' · 360°' : ''), font: '10px "Martian Mono Variable"', fillColor: Color.fromCssColorString('#fef3e2'), outlineColor: Color.fromCssColorString('#120b07'), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -10), distanceDisplayCondition: new DistanceDisplayCondition(place.id === 'jezero' ? 2500 : 0, 28_000_000), showBackground: false },
    }));
  });
  const handler = new ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(event => {
    pointerPosition = Cartesian2.clone(event.endPosition, pointerPosition ?? new Cartesian2());
    queuePointerMetrics();
  }, ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(event => {
    if (journey?.active) return;
    if (surfaceRoutes?.handleClick(event.position)) return;
    const picked = viewer.scene.pick(event.position);
    if (groundTruth?.handlePick(picked?.id) || marswalk?.handlePick(picked?.id) || groundPhotos?.handlePick(picked?.id) || landingSites?.handlePick(picked?.id)) return;
    const place = PLACES.find(place => place.id === picked?.id?.id);
    if (place && GROUND_SITES.some(site=>site.id===place.id)) surfaceView.open(place.id);
    else if (place) flyTo(place);
  }, ScreenSpaceEventType.LEFT_CLICK);
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  viewer.camera.changed.addEventListener(updateLayers);
  viewer.scene.postRender.addEventListener(updateMetrics);
  viewer.camera.moveStart.addEventListener(() => {
    if (!journey?.active) viewer.scene.globe.maximumScreenSpaceError = Math.max(viewer.scene.globe.maximumScreenSpaceError, 2);
  });
  viewer.camera.moveEnd.addEventListener(() => {
    viewer.scene.globe.maximumScreenSpaceError = ultraQuality ? .35 : 1.15;
    if (terrainMode) { const c = viewer.camera.positionCartographic; groundImagery.update({ lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude) }); }
    viewer.scene.requestRender();
  });
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(count => { pendingTiles = count; updateTileStatus(); });
  viewer.scene.renderError.addEventListener((_scene, error) => fail(error));
  groundImagery = createGroundImagery(viewer, mars);
  wireInterface();
  applyQuality();
  home(false);
  viewer.scene.requestRender();
  boot.stage('Bringing the surface into view');
  await Promise.all([typeReady, new Promise(resolve => {
    const finish = () => { remove(); clearTimeout(timer); resolve(); };
    const remove = viewer.scene.postRender.addEventListener(() => {
      if (viewer.scene.globe.tilesLoaded && Number.isFinite(viewer.scene.globe.getHeight(viewer.camera.positionCartographic))) finish();
      else viewer.scene.requestRender();
    });
    const timer = setTimeout(finish, 15000);
    viewer.scene.requestRender();
  })]);
  if (startupFailed) return;
  document.body.dataset.ready = 'true';
  boot.complete().then(registerOffline);
  window.__MARTISDUX__ = {
    getState: () => ({ mode, source: activeId, selectedId, pendingTiles, failures: [...failures], longitude: CMath.toDegrees(viewer.camera.positionCartographic.longitude), latitude: CMath.toDegrees(viewer.camera.positionCartographic.latitude), height: viewer.camera.positionCartographic.height, radius: mars.maximumRadius, route: surfaceRoutes.getState() }),
    live: () => liveEva.state, drill: kind => liveEva.throwProblem(kind), shield,
  };
}

function updateTileStatus() {
  const partial = failures.has(activeId);
  $('tile-status').textContent = pendingTiles ? 'Refining view' : partial ? 'Partial imagery available' : hasDeviceCache() ? 'Device cache · ready' : 'Imagery ready';
  document.body.dataset.tiles = pendingTiles ? 'loading' : partial ? 'partial' : 'ready';
}

function fail(error) {
  startupFailed = true;
  boot.fail(error);
}

initialize().catch(fail);
