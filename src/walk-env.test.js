import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { lodStep, edgeDistanceM, MARS_R, RAD } from './walk/env-math.js';

const PUB = new URL('../public/', import.meta.url);
const m = JSON.parse(fs.readFileSync(new URL('ar/walk-env/terrain.json', PUB)));
const L = Object.fromEntries(m.layers.map(l => [l.id, l]));

test('walkable ground is the unchanged native 1 m HiRISE DTM with ~0.32 m/px HiRISE pages', () => {
  const g = L.landing;
  assert.equal(g.walkable, true);
  assert.equal(g.dem.width, 2049); assert.equal(g.dem.spacingM, 1);
  assert.ok(Math.abs(g.dem.dlat * RAD * MARS_R - 1) < 1e-9);
  const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.equal(hash(new URL('ar/walk-env/landing.u16.gz', PUB)), hash(new URL('terrain/jezero-landing.u16.gz', PUB)));
  assert.ok(g.imagery.mpp < 0.35 && g.imagery.coverage > 0.99);
  assert.equal(g.imagery.pages.length, 256);
  for (const p of g.imagery.pages) {
    const [w, s, e, n] = p.bounds, mpp = (n - s) / p.size[1] * RAD * MARS_R;
    assert.ok(mpp < 0.33, `${p.key} is native resolution (${mpp.toFixed(3)} m/px)`);
    assert.ok(fs.existsSync(new URL(`ar/${p.url}`, PUB)));
  }
});

test('start point is inside the 1 m area; layers nest so the view never reaches a raster edge', () => {
  const { lat, lon } = m.start;
  assert.ok(edgeDistanceM(L.landing.bounds, lat, lon) > 900);
  const order = ['landing', 'crater', 'region', 'global'];
  for (let i = 0; i < 3; i++) {
    const [w, s, e, n] = L[order[i]].bounds, [pw, ps, pe, pn] = L[order[i + 1]].bounds;
    assert.ok(w > pw && e < pe && s > ps && n < pn, `${order[i]} inside ${order[i + 1]}`);
    assert.equal(L[order[i]].parent, order[i + 1]);
  }
  assert.ok(edgeDistanceM(L.region.bounds, lat, lon) > 100000);
  assert.deepEqual(L.global.bounds, [-180, -90, 180, 90]);
});

test('every DEM decodes to its declared size', () => {
  for (const l of m.layers) {
    const raw = zlib.gunzipSync(fs.readFileSync(new URL(`ar/${l.dem.url}`, PUB)));
    assert.equal(raw.length, l.dem.width * l.dem.height * 2, l.id);
  }
});

test('eye-level LOD keeps every 1 m sample near the walker', () => {
  assert.equal(lodStep(1, 1, 5, 1100, 32, 4), 1);
  assert.equal(lodStep(1, 1, 200, 1100, 32, 4), 1);
  assert.ok(lodStep(1, 1, 1500, 1100, 32, 4) > 1);
});

test('illustrative ground detail is limited to 30 m and never touches the measured surface', async () => {
  const { DRESSING_RADIUS } = await import('./walk/env-dressing.js');
  assert.equal(DRESSING_RADIUS, 30);
  const shader = fs.readFileSync(new URL('./walk/env-terrain.js', import.meta.url), 'utf8');
  assert.match(shader, /detailOn > 0\.5 && d < 30\.0/);
  assert.match(shader, /smoothstep\(12\.0, 30\.0, d\)/);
  assert.ok(!/position \+|position\s*\*=/.test(shader.split('const FRAG')[0]), 'vertex positions are the DEM, unmodified');
  const walk = fs.readFileSync(new URL('./walk/env-walk.js', import.meta.url), 'utf8');
  assert.match(walk, /function groundY[\s\S]*?landing\.heightAt/);
  const html = fs.readFileSync(new URL('../ar/walk.html', import.meta.url), 'utf8');
  assert.match(html, /not a NASA observation, may not be to\s+scale/);
});

test('relief exaggeration is display-only, labelled, and has a true-scale option', () => {
  const walk = fs.readFileSync(new URL('./walk/env-walk.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../ar/walk.html', import.meta.url), 'utf8');
  assert.match(walk, /exag: \{ value: 2 \}/);
  assert.match(html, /Relief ×2[\s\S]*not to scale[\s\S]*true scale/);
  const dress = fs.readFileSync(new URL('./walk/env-dressing.js', import.meta.url), 'utf8');
  assert.match(dress, /slopeAt\(cx, cz\)[\s\S]*brightAt\(cx, cz\)/);
});
