import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASETS, PLACES, parseCoordinates, containsPoint, tileMpp } from './data.js';

test('Mars east-longitude coordinates navigate to the western hemisphere correctly', () => {
  assert.deepEqual(parseCoordinates('18.65, 226.2'), { lat: 18.65, lon: -133.8 });
  assert.deepEqual(parseCoordinates('18.65 N, 133.8 W'), { lat: 18.65, lon: -133.8 });
  assert.deepEqual(parseCoordinates('-13.81, -58.59'), { lat: -13.81, lon: -58.59000000000003 });
});
test('Invalid or ambiguous location input does not fly to a false location', () => {
  for (const text of ['91, 0', 'hello', '0, 361', '0, -190', '18.6 77.4', 'NaN, 10']) assert.equal(parseCoordinates(text), null);
});
test('Jezero landing-area bookmark is inside actual HiRISE coverage', () => {
  const jezero = PLACES.find(p => p.id === 'jezero');
  assert.equal(containsPoint(DATASETS.hirise.bounds, jezero.lon, jezero.lat), true);
  assert.equal(containsPoint(DATASETS.hirise.bounds, -133.8, 18.65), false);
  assert.equal(containsPoint(DATASETS.ctx.bounds, 0, 89), false);
});
test('Tile limits preserve source-scale claims across distinct camera products', () => {
  assert.ok(tileMpp(DATASETS.viking) > 325 && tileMpp(DATASETS.viking) < 327);
  assert.ok(tileMpp(DATASETS.ctx) > 5 && tileMpp(DATASETS.ctx) < 5.2);
  assert.ok(tileMpp(DATASETS.hirise, 18.4446) > .30 && tileMpp(DATASETS.hirise, 18.4446) < .31);
});
