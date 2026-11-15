const rad = Math.PI / 180;
const R = 3396190;

export function gridIndex(lon, lat, width, height) {
  const ppdX = width / 360, ppdY = height / 180;
  let x = Math.floor((((lon + 180) % 360) + 360) % 360 * ppdX);
  let y = Math.floor((90 - lat) * ppdY);
  x = Math.min(width - 1, Math.max(0, x));
  y = Math.min(height - 1, Math.max(0, y));
  return y * width + x;
}

export function unitAt(geology, point) {
  if (!geology || !point) return null;
  const v = geology.values[gridIndex(point.lon, point.lat, geology.width, geology.height)];
  return v ? geology.units[v - 1] ?? null : null;
}

export function unitsAlong(geology, points) {
  const out = [];
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    if (i) {
      const a = points[i - 1], b = points[i];
      d += Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * rad), b.lat - a.lat) * rad * R;
    }
    const unit = unitAt(geology, points[i]);
    const last = out[out.length - 1];
    if (last && last.unit === unit) last.to = d;
    else { if (last) last.to = d; out.push({ unit, from: d, to: d }); }
  }
  return out.filter(s => s.unit);
}

const ga = v => (v >= 1 ? `${v.toFixed(2)}` : `${v.toFixed(2)}`).replace(/\.?0+$/, '');
export function describeAge(unit) {
  if (!unit || unit.oldGa == null) return 'Age not assigned';
  const name = unit.epoch ?? unit.period;
  if (unit.youngGa === 0) return `${name} · younger than ${ga(unit.oldGa)} billion years`;
  return `${name} · about ${ga(unit.oldGa)}–${ga(unit.youngGa)} billion years old`;
}

let pending = null;
export function loadGeology(base = '') {
  pending ??= (async () => {
    const meta = await (await fetch(`${base}data/geology/units.json`)).json();
    const image = new Image();
    image.decoding = 'async';
    image.src = `${base}data/geology/${meta.grid.file}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const values = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < values.length; i++) values[i] = rgba[i * 4];
    return { ...meta, values, width: canvas.width, height: canvas.height };
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

export function localUnitAt(local, point) {
  if (!local || !point) return null;
  const { west, east, south, north } = local.bounds;
  if (point.lon < west || point.lon >= east || point.lat <= south || point.lat > north) return null;
  const x = Math.min(local.width - 1, Math.floor((point.lon - west) * local.ppd));
  const y = Math.min(local.height - 1, Math.floor((north - point.lat) * local.ppd));
  const v = local.values[y * local.width + x];
  return v ? local.units[v - 1] ?? null : null;
}

export function localUnitsAlong(local, points) {
  const out = [];
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    if (i) {
      const a = points[i - 1], b = points[i];
      d += Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * rad), b.lat - a.lat) * rad * R;
    }
    const unit = localUnitAt(local, points[i]), last = out[out.length - 1];
    if (last && last.unit === unit) last.to = d;
    else { if (last) last.to = d; out.push({ unit, from: d, to: d }); }
  }
  return out.filter(s => s.unit);
}

let pendingLocal = null;
export function loadLocalGeology(base = '') {
  pendingLocal ??= (async () => {
    const dir = `${base}data/geology/jezero/`;
    const meta = await (await fetch(`${dir}units.json`)).json();
    const image = new Image(); image.decoding = 'async'; image.src = `${dir}${meta.grid.file}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const values = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < values.length; i++) values[i] = rgba[i * 4];
    return { ...meta, values, width: canvas.width, height: canvas.height, ppd: meta.grid.ppd, overlayUrl: `${dir}${meta.overlay}` };
  })();
  pendingLocal.catch(() => { pendingLocal = null; });
  return pendingLocal;
}
