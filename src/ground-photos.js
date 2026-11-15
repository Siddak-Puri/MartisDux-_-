import { Cartesian3, Color, DistanceDisplayCondition, NearFarScalar, PointPrimitiveCollection } from 'cesium';

const $ = id => document.getElementById(id);
const rad = Math.PI / 180;
const distance = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * rad), b.lat - a.lat) * rad * 3396190;
const compass = az => az == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((az % 360) + 360) % 360) / 45) % 8];

export function photoUrl(index, photo, size = 'medium') {
  return `${index.urlPrefix}${photo.p}${index.urlSuffix[size]}`;
}

export function placesNear(locations, path, radius = 60) {
  if (!path?.length) return [];
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const p of path) { west = Math.min(west, p.lon); east = Math.max(east, p.lon); south = Math.min(south, p.lat); north = Math.max(north, p.lat); }
  const pad = radius / 3396190 / rad * 1.5, padLon = pad / Math.max(.1, Math.cos((south + north) / 2 * rad));
  const out = [];
  for (const place of locations) {
    if (place.lon < west - padLon || place.lon > east + padLon || place.lat < south - pad || place.lat > north + pad) continue;
    let best = Infinity, along = 0;
    for (const p of path) { const m = distance(p, place); if (m < best) { best = m; along = p.d ?? 0; } }
    if (best <= radius) out.push({ place, offset: best, d: along });
  }
  return out.sort((a, b) => a.d - b.d);
}

export function pickPhotos(near, limit = 9) {
  const chosen = [];
  const step = Math.max(1, near.length / limit);
  for (let k = 0; k < near.length && chosen.length < limit; k += step) {
    const hit = near[Math.floor(k)];
    const photos = hit.place.photos;
    const first = photos.find(p => p.cam === 'Mastcam-Z') ?? photos.find(p => p.cam === 'Navcam') ?? photos[0];
    chosen.push({ ...hit, photo: first });
  }
  return chosen;
}

export function createGroundPhotos({ viewer, mars, terrain, base = '' }) {
  let index = null, gallery = [], at = 0;
  const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  const ready = fetch(`${base}data/perseverance/ground-photos.json`).then(r => r.json()).then(data => {
    index = data;
    const near = new DistanceDisplayCondition(0, 12000), scale = new NearFarScalar(500, 1, 12000, .55);
    for (const place of data.locations) {
      points.add({ id: `photo:${place.rmc}`, position: Cartesian3.fromDegrees(place.lon, place.lat, (terrain?.heightAt(place) ?? 0) + 1.5, mars),
        pixelSize: 6, color: Color.fromCssColorString('#ffd28a'), outlineColor: Color.fromCssColorString('#2a1606'), outlineWidth: 1.5,
        distanceDisplayCondition: near, scaleByDistance: scale, disableDepthTestDistance: 2e4 });
    }
    viewer.scene.requestRender();
    return data;
  }).catch(error => { console.warn('[MartisDux] Perseverance ground photos unavailable.', error); return null; });

  function show() {
    const item = gallery[at]; if (!item) return;
    const { photo, place } = item;
    const img = $('photo-image');
    img.src = photoUrl(index, photo, 'large');
    img.alt = `${photo.cam} raw image taken by Perseverance on sol ${photo.sol}`;
    const where = item.d != null && item.routeName ? ` · ${Math.round(item.d)} m along your route` : '';
    const heading = photo.az != null ? ` · looking ${compass(photo.az)} (${Math.round(photo.az)}°)` : '';
    $('photo-caption').innerHTML = '<strong></strong><br><span></span><br><small></small>';
    $('photo-caption').querySelector('strong').textContent = `Perseverance ${photo.cam} · sol ${photo.sol}, ${photo.lmst} local Mars time`;
    $('photo-caption').querySelector('span').textContent = `Taken at rover stop ${place.rmc} (${place.lat.toFixed(5)}° N, ${place.lon.toFixed(5)}° E)${heading}${where}. ${new Date(photo.utc).toUTCString().slice(5, 22)} UTC.`;
    $('photo-caption').querySelector('small').textContent = index.credit;
    $('photo-link').href = `https://mars.nasa.gov/mars2020/multimedia/raw-images/${photo.id}`;
    $('photo-count').textContent = `${at + 1} / ${gallery.length}`;
    $('photo-prev').disabled = gallery.length < 2; $('photo-next').disabled = gallery.length < 2;
  }
  function open(items, start = 0) {
    if (!index || !items.length) return;
    gallery = items; at = start; show();
    if (!$('photo-dialog').open) $('photo-dialog').showModal();
  }
  $('photo-prev').addEventListener('click', () => { at = (at - 1 + gallery.length) % gallery.length; show(); });
  $('photo-next').addEventListener('click', () => { at = (at + 1) % gallery.length; show(); });
  $('photo-close').addEventListener('click', () => $('photo-dialog').close());
  $('photo-dialog').addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') $('photo-prev').click();
    if (event.key === 'ArrowRight') $('photo-next').click();
  });
  $('photo-dialog').addEventListener('click', event => { if (event.target === $('photo-dialog')) $('photo-dialog').close(); });

  return {
    ready,
    get index() { return index; },
    near: (path, radius) => index ? placesNear(index.locations, path, radius) : [],
    url: (photo, size) => photoUrl(index, photo, size),
    open,
    openPlace(place) { open(place.photos.map(photo => ({ place, photo }))); },
    handlePick(id) {
      if (typeof id !== 'string' || !id.startsWith('photo:') || !index) return false;
      const place = index.locations.find(l => `photo:${l.rmc}` === id); if (!place) return false;
      this.openPlace(place); return true;
    },
  };
}
