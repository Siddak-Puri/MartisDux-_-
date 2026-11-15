import { SingleTileImageryProvider, GeographicTilingScheme, Rectangle, Credit, Event as CesiumEvent } from 'cesium';
import { computeSlope, slopeImage, bounds, slopeAt, slopeClass, gridFor, cellOf, SLOPE_CLASSES } from './hazards.js';
import { routeWindow, demGrid, tileGrid, tileSpan, sampleSpacing } from './global-dem.js';

const $ = id => document.getElementById(id);
const fmtSpacing = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

export function createHazardLayer({ viewer, mars, terrain }) {
  let display = null, routing = null, localLayers = [], globalLayer = null, visible = false, building = null;
  let lastGlobal = null;

  async function ensure() {
    if (routing) return true;
    if (!building) building = (async () => {
      await terrain.ready;
      const grids = [...terrain.grids].sort((a, b) => a.step - b.step);
      const tag = (s, g) => Object.assign(s, { site: g.site });
      display = grids.map(g => tag(computeSlope(g, g.step === 1 ? 2 : 1), g));
      routing = grids.map(g => tag(computeSlope(g, g.step === 1 ? 4 : 2), g));
      return true;
    })();
    return building;
  }

  const coveredLocally = (point, finerThan = Infinity) => display?.some(s => s.step < finerThan && (() => { const c = cellOf(s, point); return c && Number.isFinite(s.elevation[c.i]); })());

  function paint(s, width = s.width, height = s.height, mask) {
    const rgba = slopeImage(s), out = new Uint8ClampedArray(width * height * 4);
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
      const from = (r * s.width + c) * 4;
      if (!rgba[from + 3]) continue;
      if (mask && mask(r, c)) continue;
      out.set(rgba.subarray(from, from + 4), (r * width + c) * 4);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(out, width, height), 0, 0);
    return canvas;
  }

  function globalProvider() {
    const tilingScheme = new GeographicTilingScheme({ ellipsoid: mars });
    const blank = document.createElement('canvas'); blank.width = blank.height = 1;
    return {
      tilingScheme, rectangle: tilingScheme.rectangle, tileWidth: 512, tileHeight: 512, minimumLevel: 0, maximumLevel: 7,
      tileDiscardPolicy: undefined, errorEvent: new CesiumEvent(), hasAlphaChannel: true, proxy: undefined, ready: true,
      credit: new Credit('Slope: MartisDux analysis of the NASA/ESA/USGS HRSC/MOLA 200 m DEM'),
      getTileCredits: () => undefined, pickFeatures: () => undefined,
      async requestImage(x, y, level) {
        if (level < 2) return blank;
        const tile = await terrain.tile(x, y, level);
        const s = computeSlope(tileGrid(tile, x, y, level));
        const span = tileSpan(level), west = -180 + x * span, north = 90 - y * span, k = span / 512;
        const local = display?.map(bounds) ?? [];
        const touches = local.some(b => b.west < west + span && b.east > west && b.south < north && b.north > north - span);
        return paint(s, 512, 512, touches ? (r, c) => coveredLocally({ lat: north - r * k, lon: west + c * k }) : null);
      },
    };
  }

  async function addOverlays() {
    globalLayer = viewer.imageryLayers.addImageryProvider(globalProvider());
    globalLayer.alpha = .8;
    for (const s of [...display].reverse()) {
      const finer = display.filter(o => o.step < s.step);
      const canvas = paint(s, s.width, s.height, finer.length ? (r, c) => {
        const point = { lon: (s.x0 + c * s.step) / mars.maximumRadius * 180 / Math.PI, lat: (s.y0 - r * s.step) / mars.maximumRadius * 180 / Math.PI };
        return coveredLocally(point, s.step);
      } : null);
      const b = bounds(s);
      const provider = await SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
        rectangle: Rectangle.fromDegrees(b.west, b.south, b.east, b.north), ellipsoid: mars,
        credit: new Credit(`Slope: MartisDux analysis of the NASA/USGS ${s.site} HiRISE DTM`),
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = .85;
      localLayers.push(layer);
    }
  }

  async function setVisible(value) {
    visible = value;
    $('hazard-toggle').setAttribute('aria-pressed', String(value));
    document.querySelectorAll('[data-hazard-toggle]').forEach(b => b.setAttribute('aria-pressed', String(value)));
    $('hazard-legend').hidden = !value;
    if (value && !globalLayer) {
      await ensure();
      if (!globalLayer) await addOverlays();
    }
    [globalLayer, ...localLayers].forEach(layer => { if (layer) layer.show = visible; });
    viewer.scene.requestRender();
  }

  async function analysisFor(start, destination) {
    await ensure();
    const local = gridFor(routing, start, destination);
    if (local) return { grid: local, label: `${local.site} HiRISE DTM · ${local.step} m cells`, local: true };
    const w = routeWindow(start, destination);
    if (!w) throw new Error('This route is too long for slope analysis. Shorter legs (under ~1,500 km) are analysed.');
    const key = JSON.stringify([w.level, ...Object.values(w.box).map(v => v.toFixed(3))]);
    if (lastGlobal?.key !== key) lastGlobal = { key, promise: demGrid(terrain.tile, w.box, w.level).then(computeSlope) };
    try {
      const grid = await lastGlobal.promise;
      return { grid, label: `HRSC/MOLA DEM · ${fmtSpacing(sampleSpacing(w.level, (start.lat + destination.lat) / 2))} cells`, local: false };
    } catch (error) { lastGlobal = null; throw new Error('Elevation tiles for this area could not load. Check the connection and try again.'); }
  }

  function at(point) {
    const s = (display && gridFor(display, point)) || (lastGlobal?.grid && gridFor([lastGlobal.grid], point));
    if (!s) return null;
    const v = slopeAt(s, point);
    return Number.isFinite(v) ? { slope: v, cls: slopeClass(v), spacing: s.step } : null;
  }
  const remember = a => { if (lastGlobal && !a.local) lastGlobal.grid = a.grid; return a; };

  $('hazard-legend-items').replaceChildren(...SLOPE_CLASSES.map((c, i) => {
    const li = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'hazard-swatch';
    swatch.style.background = c.color[3] ? `rgb(${c.color.slice(0, 3).join(' ')})` : 'transparent';
    const lower = i ? SLOPE_CLASSES[i - 1].max : 0;
    li.append(swatch, `${c.label} `, Object.assign(document.createElement('small'), { textContent: c.max === Infinity ? `> ${lower}°` : `${lower}–${c.max}°` }));
    return li;
  }));

  return {
    ensure, setVisible, at, analysisFor: (a, b) => analysisFor(a, b).then(remember),
    get visible() { return visible; }, get routingGrids() { return routing; },
  };
}
