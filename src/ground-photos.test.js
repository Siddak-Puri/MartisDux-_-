import test from 'node:test';
import assert from 'node:assert/strict';
import { placesNear, pickPhotos, photoUrl } from './ground-photos.js';

const metre = 1 / (3396190 * Math.PI / 180);
const place = (rmc, lat, cams = ['Navcam', 'Mastcam-Z']) => ({ rmc, lon: 77.45, lat, photos: cams.map((cam, i) => ({ id: `${rmc}-${i}`, cam, p: `x/${rmc}-${i}` })) });

test('places within the radius are found and ordered along the route', () => {
  const path = Array.from({ length: 101 }, (_, i) => ({ lon: 77.45, lat: 18.44 + i * 10 * metre, d: i * 10 }));
  const places = [place('far', 18.44 + 500 * metre), place('b', 18.44 + 700 * metre), place('a', 18.44 + 100 * metre)];
  places[0].lon = 77.45 + 500 * metre / Math.cos(18.44 * Math.PI / 180);
  const near = placesNear(places, path, 60);
  assert.deepEqual(near.map(n => n.place.rmc), ['a', 'b']);
  assert.ok(Math.abs(near[0].d - 100) < 1 && near[0].offset < 1);
});

test('picks colour first and spreads picks along the route', () => {
  const near = Array.from({ length: 30 }, (_, i) => ({ place: place(`p${i}`, 18 + i * metre), d: i * 10, offset: 0 }));
  const picked = pickPhotos(near, 9);
  assert.equal(picked.length, 9);
  assert.equal(picked[0].photo.cam, 'Mastcam-Z');
  assert.ok(picked.at(-1).d >= 200, 'reaches the far end of the route');
  const navOnly = pickPhotos([{ place: place('n', 18, ['Front Hazcam', 'Navcam']), d: 0 }]);
  assert.equal(navOnly[0].photo.cam, 'Navcam');
});

test('photo URLs are rebuilt from the compact index', () => {
  const index = { urlPrefix: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/', urlSuffix: { small: '_320.jpg', large: '_1200.jpg' } };
  assert.equal(photoUrl(index, { p: '00100/ids/edr/browse/ncam/NLF_X' }, 'small'), 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00100/ids/edr/browse/ncam/NLF_X_320.jpg');
});
