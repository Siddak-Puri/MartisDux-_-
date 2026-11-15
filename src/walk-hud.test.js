import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createLandingMap,measuredLandingField,routeForLanding} from './walk/env-hud-data.js';
import {routeState,scanTerrain} from './walk/visor/analysis.js';
import {helmetReadout} from './walk/visor/helmet-profile.js';

const assets=new URL('../public/ar/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,assets),'utf8'));
const {start,layers}=read('walk-env/terrain.json');
const landing=layers.find(l=>l.id==='landing');
const map=createLandingMap(landing.imagery.overview.bounds,start);
const reference=read('jezero-marswalk.route.json');

test('the walk map places the landing image and reference route in the same coordinates',()=>{
  const [west,south,east,north]=landing.imagery.overview.bounds;
  assert.deepEqual(map.toMap({lat:north,lon:west}),{x:0,z:0});
  assert.deepEqual(map.toMap({lat:south,lon:east}),{x:map.width,z:map.depth});
  const p=map.toMap(start),geo=map.toGeo(p.x,p.z);
  assert.ok(Math.abs(geo.lat-start.lat)<1e-11&&Math.abs(geo.lon-start.lon)<1e-11);
  const fitted=routeForLanding(reference,map,landing.bounds);
  assert.equal(fitted.dest.name,'Rochette');
  assert.ok(Math.abs(fitted.route.length-reference.distance)<1);
  const near=routeState(fitted.route,fitted.route.at(20),180);
  assert.ok(near.remaining<fitted.route.length-19);
  assert.equal(routeForLanding({points:[start,{lat:0,lon:0}]},map,landing.bounds),null);
});

test('terrain warnings read the native landing DEM and report unknown outside its coverage',()=>{
  const bytes=gunzipSync(readFileSync(new URL(landing.dem.url,assets)));
  const raw=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);
  const h=Float32Array.from(raw,value=>value===landing.dem.nodata?NaN:value*landing.dem.scale+landing.dem.offset);
  const field=measuredLandingField({...landing.dem,h},map,landing.bounds);
  const p=map.toMap(start),scan=scanTerrain(field,p,290);
  assert.ok(Number.isFinite(field.height(p.x,p.z)));
  assert.equal(scan.level,'low');
  assert.ok(scan.slope>0&&scan.slope<10);
  assert.equal(scanTerrain(field,{x:-150,z:-150},0).level,'unknown');
  assert.equal(scanTerrain({inside:()=>true,slope:()=>NaN},p,0).level,'unknown');
});

test('losing AR tracking clears the previous turn cue, distance, and hazard',()=>{
  const state=helmetReadout({mode:'stale',heading:187,route:{remaining:902,turnToRoute:0},hazard:{level:'steep',slope:26,distance:16}});
  assert.equal(state.headingLabel,'—');assert.equal(state.remaining,'—');assert.equal(state.turn,null);assert.equal(state.warning,'POSE SIGNAL LOST');
});

test('visor theme: tokens, scene tones, compact mode and opt-in trail', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('./walk/visor/theme.css', import.meta.url), 'utf8');
  for (const token of ['--hud-cyan', '--hud-amber', '--glass-tint', '--glass-alpha']) assert.ok(css.includes(token), token);
  for (const scene of ['bright', 'dark', 'unknown']) assert.ok(css.includes(`[data-scene="${scene}"]`), scene);
  assert.match(css, /\.md-visor\.compact/);
  assert.match(css, /backdrop-filter: blur\(var\(--glass-blur\)\)/);
  const walk = fs.readFileSync(new URL('./walk/env-walk.js', import.meta.url), 'utf8');
  assert.match(walk, /trailOn = false/);
  assert.match(walk, /xrMode==='ar'&&!skyOn\)return 'unknown'/);
});

test('telemetry: cues come from route geometry or the DEM scan, elevation arc and suit sim are bounded', async () => {
  const { nextTurn, forwardCue, elevationFraction, stepSuit, spaceWeatherLine } = await import('./walk/visor/telemetry.js');
  const { Route } = await import('./walk/visor/geo.js');
  const bend = new Route([[0, 0], [0, -200], [150, -200]]);
  const t = nextTurn(bend, 50);
  assert.equal(t.direction, 'right'); assert.ok(Math.abs(t.distance - 150) <= 20, `turn at ${t.distance} m`);
  assert.equal(nextTurn(new Route([[0, 0], [0, -500]]), 50), null);
  const base = { mode: 'preview', route: { walked: 50, offRoute: 2 }, hazard: { level: 'low' } };
  assert.match(forwardCue(base, bend).text, /^TURN RIGHT · \d+ m$/);
  assert.equal(forwardCue({ ...base, route: { walked: 50, offRoute: 40 } }, bend), null);
  assert.equal(forwardCue(base, null), null);
  assert.deepEqual([forwardCue({ ...base, hazard: { level: 'steep', distance: 40 } }, bend).tone, forwardCue({ ...base, hazard: { level: 'steep', distance: 40 } }, bend).basis], ['caution', 'dem']);
  assert.equal(forwardCue({ mode: 'stale' }, bend), null);
  assert.equal(elevationFraction(-2570, { min: -2600, max: -2540 }), 0.5);
  assert.equal(elevationFraction(NaN, { min: 0, max: 1 }), null);
  const suit = stepSuit({ seconds: 0, o2Used: 0, doseMicroSv: 0, watts: 0 }, { dt: 0.1, moved: 2.8, rise: 0, speed: 20 });
  assert.ok(Math.abs(suit.seconds - 2) < 1e-9 && suit.watts < 600);
  assert.equal(spaceWeatherLine({ error: 'offline' }).value, 'UNKNOWN');
  assert.match(spaceWeatherLine({ arrivals: [], fetched: Date.now() - 8 * 3600000, live: true }).value, /STALE/);
});
