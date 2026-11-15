import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLandingMap, routeForLanding } from './walk/env-hud-data.js';
import { MARS_R, RAD } from './walk/env-math.js';

const assets = new URL('../public/ar/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, assets), 'utf8'));
const { start, layers } = read('walk-env/terrain.json');
const landing = layers.find(l => l.id === 'landing');
const map = createLandingMap(landing.imagery.overview.bounds, start);
const { demos } = read('walk-demos.json');
const [w, s, e, n] = landing.bounds, pad = 25 / (RAD * MARS_R), k = Math.cos(start.lat * RAD);
const walkBox = [w + pad / k, s + pad, e - pad / k, n - pad];

test('every demo walk fits the walkable area and ends at a real sampling site', () => {
  const samples = JSON.parse(readFileSync(new URL('../public/data/perseverance/samples.json', import.meta.url), 'utf8')).samples;
  assert.ok(demos.length >= 4);
  assert.equal(new Set(demos.map(d => d.id)).size, demos.length);
  for (const demo of demos) {
    const fitted = routeForLanding({ ...demo, demo: true }, map, walkBox);
    assert.ok(fitted, `${demo.id} is inside the walk area`);
    assert.equal(fitted.label, 'Demo walk');
    assert.ok(Math.abs(fitted.route.length - demo.distance) < 3, `${demo.id} length`);
    assert.ok(demo.maxSlope < 15, `${demo.id} stays under the HUD's steep threshold`);
    assert.ok(samples.some(x => x.feature === demo.rock && x.sol === demo.sol && x.lat === demo.dest.lat && x.lon === demo.dest.lon), `${demo.id} destination is a sampled outcrop`);
  }
});

test('the walk page offers the demo walks and an auto-walk control', () => {
  const html = readFileSync(new URL('../ar/walk.html', import.meta.url), 'utf8');
  const walk = readFileSync(new URL('./walk/env-walk.js', import.meta.url), 'utf8');
  assert.match(html, /id="demo-list"/);
  assert.match(html, /id="auto-btn"/);
  assert.match(html, /not safety-certified/);
  assert.match(walk, /walkSpeed\(rise \/ d\) \* auto \* dt/);
  assert.match(walk, /if \(auto\) setAuto\(0\);/);
});
