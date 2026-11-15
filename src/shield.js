import { SingleTileImageryProvider, Rectangle, Credit } from 'cesium';
import { cellOf, pointOf, bounds } from './hazards.js';

const $ = id => document.getElementById(id);
const NODATA = 255, SCALE = 400;
const pct = v => `${(v * 100).toFixed(v < .1 ? 1 : 0)}%`;

async function pixels(url, width, height) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data, out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}

function overlay(grid) {
  const { width, height, values } = grid, rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < values.length; i++) {
    if (values[i] === NODATA) continue;
    const v = values[i] / SCALE; if (v < .08) continue;
    const t = Math.min(1, (v - .08) / .22);
    rgba.set([70 + 185 * t, 150 + 105 * t, 255, 35 + 205 * t], i * 4);
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

export function createShield({ viewer, mars, notify, flyTo, setPlacesCollapsed }) {
  let grids = null, loading = null, visible = false, validation = null, lastKey = '';
  const layers = [];

  function ensure() {
    loading ??= (async () => {
      const [meta, check] = await Promise.all(['shield', 'validation'].map(n => fetch(`data/shield/${n}.json`).then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
      const loaded = await Promise.all(meta.grids.map(async g => ({ ...g, values: await pixels(`data/shield/${g.file}`, g.width, g.height) })));
      validation = check; grids = loaded.sort((a, b) => a.step - b.step);
      return grids;
    })().catch(error => { loading = null; throw error; });
    return loading;
  }

  function at(p) {
    if (!grids) return null;
    for (const g of grids) { const c = cellOf(g, p); if (c && g.values[c.i] !== NODATA) return { value: g.values[c.i] / SCALE, grid: g, cell: c }; }
    return null;
  }
  const valueAt = p => at(p)?.value ?? null;

  function bestCover(p, radius = 300) {
    const here = at(p); if (!here) return null;
    const g = here.grid, dx = g.step * Math.cos(p.lat * Math.PI / 180), dy = g.step;
    const rc = Math.ceil(radius / dx), rr = Math.ceil(radius / dy);
    let best = null;
    for (let r = Math.max(0, here.cell.row - rr); r <= Math.min(g.height - 1, here.cell.row + rr); r++)
      for (let c = Math.max(0, here.cell.col - rc); c <= Math.min(g.width - 1, here.cell.col + rc); c++) {
        const v = g.values[r * g.width + c]; if (v === NODATA) continue;
        const metres = Math.hypot((c - here.cell.col) * dx, (r - here.cell.row) * dy);
        if (metres <= radius && (!best || v > best.raw)) best = { raw: v, metres, col: c, row: r };
      }
    return best && { ...pointOf(g, best.col, best.row), value: best.raw / SCALE, metres: best.metres, here: here.value };
  }

  function renderPanel() {
    const c = validation.computed, m = validation.measured;
    const landing = grids.find(g => g.id === 'jezero-landing');
    const valid = landing ? Array.from(landing.values).filter(v => v !== NODATA).sort((a, b) => a - b) : [];
    const median = valid.length ? valid[valid.length >> 1] / SCALE : null, max = valid.length ? valid.at(-1) / SCALE : null;
    $('shield-stats').innerHTML = `
      <div><strong>${(c.skyBlocked * 100).toFixed(1)}%</strong><span>sky hidden, from orbit<br><small>Curiosity team measured ${Math.round(m.skyBlocked * 100)}%</small></span></div>
      <div><strong>−${Math.round(m.doseDrop * 100)}%</strong><span>dose Curiosity measured there<br><small>RAD, sols ${validation.site.sols}</small></span></div>
      <div><strong>${(c.referenceMean * 100).toFixed(1)}%</strong><span>typical on Curiosity's path<br><small>RAD team reference ${Math.round(m.referenceSkyBlocked * 100)}%</small></span></div>
      <div><strong>${median == null ? '—' : pct(median)}</strong><span>typical near Jezero base<br><small>${max == null ? '' : `best spot ${pct(max)}`}</small></span></div>`;
    $('shield-note').textContent = `Check: at the Quela drill site under a Murray Buttes cliff, Curiosity's radiation team mapped the sky from rover panoramas and found ${Math.round(m.skyBlocked * 100)}% of it hidden. `
      + `Our map, made only from orbital elevation data with no tuning, gives ${(c.skyBlocked * 100).toFixed(1)}% (${(c.within2m[0] * 100).toFixed(1)}–${(c.within2m[1] * 100).toFixed(1)}% within 2 m of the spot). `
      + `Terrain is partial cover, never a storm cellar: it trims the dose by a few percent. The open plain around Jezero base offers almost none, so the first answer in a storm is the way home.`;
  }

  async function setVisible(value) {
    if (value && !grids) {
      $('shield-toggle').setAttribute('aria-busy', 'true');
      try { await ensure(); }
      catch { notify('Storm shelter map could not load.'); return false; }
      finally { $('shield-toggle').removeAttribute('aria-busy'); }
    }
    if (value && !layers.length) {
      renderPanel();
      for (const g of [...grids].reverse()) {
        const b = bounds(g);
        const provider = await SingleTileImageryProvider.fromUrl(overlay(g), { rectangle: Rectangle.fromDegrees(b.west, b.south, b.east, b.north), ellipsoid: mars,
          credit: new Credit('Sky hidden by terrain: MartisDux horizon analysis of NASA/USGS elevation data') });
        const layer = viewer.imageryLayers.addImageryProvider(provider); layer.alpha = .85; layers.push(layer);
      }
    }
    visible = value;
    layers.forEach(l => { l.show = value; });
    $('shield-toggle').setAttribute('aria-pressed', String(value));
    $('shield-panel').hidden = !value;
    if (value && $('eva-range').getAttribute('aria-pressed') === 'true') $('eva-range').click();
    if (value) { setPlacesCollapsed?.(true); if ($('truth-toggle').getAttribute('aria-pressed') === 'true') $('truth-toggle').click(); }
    viewer.scene.requestRender();
    return true;
  }

  function readout(p) {
    if (!visible) return;
    const v = p ? valueAt(p) : null, key = v == null ? '' : v.toFixed(3);
    if (key === lastKey) return; lastKey = key;
    $('shield-value').textContent = v == null ? 'No map here' : `${pct(v)} of the sky hidden`;
  }

  $('shield-toggle').addEventListener('click', async () => {
    const show = !visible;
    if (await setVisible(show) && show) {
      const c = viewer.camera.positionCartographic, lon = c.longitude * 180 / Math.PI, lat = c.latitude * 180 / Math.PI;
      const near = grids.some(g => { const b = bounds(g); return lon > b.west - .3 && lon < b.east + .3 && lat > b.south - .3 && lat < b.north + .3; });
      if (!near || c.height > 120000) flyTo({ name: 'Jezero delta and crater rim', lat: 18.47, lon: 77.40, height: 30000 });
      else notify('Brighter ground hides more of the sky. Point at the map to read it.', 5000);
    }
  });
  $('shield-close').addEventListener('click', () => setVisible(false));
  $('shield-fly').addEventListener('click', () => {
    const s = validation?.site; if (!s) return;
    flyTo({ name: 'Quela drill site, Murray Buttes (Curiosity)', lat: s.lat, lon: s.lon, height: 1500 });
  });

  return { ensure, setVisible, valueAt, bestCover, readout, get visible() { return visible; } };
}
