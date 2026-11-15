import { Cartesian2, Cartesian3, Color, LabelCollection, LabelStyle, VerticalOrigin, DistanceDisplayCondition, NearFarScalar, PointPrimitiveCollection } from 'cesium';

const $ = id => document.getElementById(id);

export function createLandingSites({ viewer, mars, flyTo }) {
  const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  const labels = viewer.scene.primitives.add(new LabelCollection());
  let sites = [];
  fetch('data/landing-sites.json').then(r => r.json()).then(data => {
    const byPlace = new Map();
    for (const s of data.sites) { const k = `${s.lat},${s.lon}`; byPlace.has(k) ? byPlace.get(k).ez.push(s.ez) : byPlace.set(k, { ...s, ez: [s.ez] }); }
    sites = [...byPlace.values()].sort((a, b) => a.name.localeCompare(b.name));
    const colour = Color.fromCssColorString('#d7b8ff'), far = new DistanceDisplayCondition(0, 2.6e7), labelRange = new DistanceDisplayCondition(0, 4.5e6);
    for (const s of sites) {
      const position = Cartesian3.fromDegrees(s.lon, s.lat, 1000, mars);
      points.add({ id: `ez:${s.ez[0]}`, position, pixelSize: 6, color: colour, outlineColor: Color.fromCssColorString('#1a1024'), outlineWidth: 2, distanceDisplayCondition: far, scaleByDistance: new NearFarScalar(2e5, 1.4, 2e7, .8) });
      labels.add({ id: `ez:${s.ez[0]}`, position, text: `${s.name.toUpperCase()} · EZ`, font: '9px "Martian Mono Variable"', fillColor: Color.fromCssColorString('#ecdcff'),
        outlineColor: Color.fromCssColorString('#120b07'), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -9), distanceDisplayCondition: labelRange });
    }
    $('ez-count').textContent = `${String(sites.length).padStart(2, '0')} SITES`;
    $('ez-list').replaceChildren(...sites.map(s => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ez-site';
      b.innerHTML = '<strong></strong><small></small>';
      b.querySelector('strong').textContent = s.name;
      b.querySelector('small').textContent = `${Math.abs(s.lat).toFixed(1)}°${s.lat < 0 ? 'S' : 'N'} ${Math.abs(s.lon).toFixed(1)}°${s.lon < 0 ? 'W' : 'E'} · ${s.type.split(',')[0].toLowerCase()} · EZ ${s.ez.join(', ')}`;
      b.addEventListener('click', () => flyTo({ id: `ez:${s.ez[0]}`, lat: s.lat, lon: s.lon, height: s.type === 'Crater' ? 220000 : 600000 }));
      return b;
    }));
    viewer.scene.requestRender();
  }).catch(error => console.warn('[MartisDux] Landing sites unavailable.', error));

  const occluded = () => {
    const cam = viewer.camera.positionWC, r = mars.maximumRadius;
    const visible = p => Cartesian3.dot(Cartesian3.subtract(p, cam, new Cartesian3()), p) < 0 || Cartesian3.magnitude(cam) < r * 1.0001;
    for (let i = 0; i < points.length; i++) { const v = visible(points.get(i).position); points.get(i).show = v; labels.get(i).show = v; }
  };
  viewer.camera.changed.addEventListener(occluded);
  viewer.camera.percentageChanged = .02;

  return {
    setVisible(visible) { points.show = visible; labels.show = visible; },
    handlePick(id) {
      if (typeof id !== 'string' || !id.startsWith('ez:')) return false;
      const s = sites.find(x => `ez:${x.ez[0]}` === id); if (!s) return false;
      flyTo({ id, lat: s.lat, lon: s.lon, height: s.type === 'Crater' ? 220000 : 600000 });
      return true;
    },
  };
}
