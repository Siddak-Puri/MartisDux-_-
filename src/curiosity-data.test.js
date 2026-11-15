import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const v = JSON.parse(readFileSync(new URL('../public/data/curiosity/validation.json', import.meta.url)));
const photos = JSON.parse(readFileSync(new URL('../public/data/perseverance/ground-photos.json', import.meta.url)));

test('Curiosity replication: orbital slope beats the no-skill guess at Gale', () => {
  assert.ok(v.compared > 1000);
  const f = v.footprints.dtm16;
  assert.equal(f.n, v.compared);
  assert.ok(f.mae < v.baseline.mae, 'map beats the median-tilt guess');
  assert.ok(f.pearson > .5);
  assert.ok(v.footprints.dtm9.mae < f.mae, 'finer footprint agrees better on Mount Sharp');
});

test('Perseverance photo index: every place has photos with a known camera', () => {
  assert.ok(photos.locations.length > 600);
  for (const place of photos.locations) {
    assert.ok(place.photos.length > 0 && place.photos.length <= 13);
    for (const p of place.photos) assert.ok(['Navcam', 'Mastcam-Z', 'Front Hazcam'].includes(p.cam));
  }
});
