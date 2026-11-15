import test from 'node:test';
import assert from 'node:assert/strict';
import { marsArrivals, walkRisk } from './space-weather.js';
import { missionSol } from './mars-time.js';

const cme = (id, analyses) => ({ activityID: id, sourceLocation: 'N10W20', link: `https://webtools.ccmc.gsfc.nasa.gov/DONKI/view/CME/${id}`, cmeAnalyses: analyses });
const run = (when, impacts) => ({ modelCompletionTime: when, impactList: impacts });
const data = [
  cme('A', [
    { isMostAccurate: false, speed: 400, enlilList: [run('2026-11-01T00:00Z', [{ location: 'Mars', arrivalTime: '2026-11-05T00:00Z', isGlancingBlow: false }])] },
    { isMostAccurate: true, speed: 450, enlilList: [run('2026-11-02T00:00Z', [{ location: 'Mars', arrivalTime: '2026-11-06T12:00Z', isGlancingBlow: false }, { location: 'Earth', arrivalTime: '2026-11-03T00:00Z' }])] },
  ]),
  cme('B', [{ isMostAccurate: true, speed: 700, enlilList: [run('2026-11-09T00:00Z', [{ location: 'Mars', arrivalTime: '2026-11-13T12:00Z', isGlancingBlow: true }])] }]),
  cme('C', [{ isMostAccurate: true, speed: 300, enlilList: [run('2026-11-09T00:00Z', [{ location: 'STEREO A', arrivalTime: '2026-11-12T00:00Z' }])] }]),
  cme('D', null),
];

test('Mars arrivals use the most accurate analysis and ignore other targets', () => {
  const a = marsArrivals(data);
  assert.deepEqual(a.map(x => x.id), ['A', 'B']);
  assert.equal(new Date(a[0].arrival).toISOString(), '2026-11-06T12:00:00.000Z');
  assert.equal(a[0].speed, 450);
  assert.equal(a[1].glancing, true);
});

test('walk risk: direct hit is NO-GO, glancing is caution, quiet is clear', () => {
  const a = marsArrivals(data), h = 3600000;
  assert.equal(walkRisk(a, Date.parse('2026-11-06T08:00Z'), Date.parse('2026-11-06T10:00Z')).level, 'nogo');
  assert.equal(walkRisk(a, Date.parse('2026-11-13T02:00Z'), Date.parse('2026-11-13T04:00Z')).level, 'caution', 'within ±12 h');
  const quiet = walkRisk(a, Date.parse('2026-11-09T00:00Z'), Date.parse('2026-11-09T00:00Z') + 4 * h);
  assert.equal(quiet.level, 'clear');
  assert.equal(quiet.next.id, 'B', 'reports the next forecast arrival');
});

test('mission sol numbering matches NASA for both rovers', () => {
  assert.equal(missionSol('perseverance', new Date('2024-04-27T12:00:00Z')), 1133);
  assert.equal(missionSol('curiosity', new Date('2026-08-25T12:00:00Z')), 4995);
  assert.equal(missionSol('curiosity', new Date('2012-08-06T06:00:00Z')), 0);
});

test('live rover data: latest waypoint and compact traverse from MMGIS GeoJSON', async () => {
  const { latestWaypoint, compactTraverse } = await import('./rover-live.js');
  const wp = (sol, d, lat, lon) => ({ properties: { sol, dist_total_m: d, lat, lon, RMC: `${sol}_${d}` } });
  const latest = latestWaypoint([wp(10, 100, 18.4, 77.4), wp(12, 300, 18.5, 77.3), wp(12, 250, 18.45, 77.35), { properties: { sol: 99 } }]);
  assert.deepEqual([latest.sol, latest.dist], [12, 300]);
  const t = compactTraverse([{ properties: { sol: 5, length: 20 }, geometry: { coordinates: [[77.4, 18.4, -2500], [77.4, 18.4, -2500], [77.41, 18.41, -2501]] } },
    { properties: { sol: 6, length: 0 }, geometry: { coordinates: [[77.41, 18.41, 0]] } }]);
  assert.equal(t.drives.length, 1);
  assert.deepEqual(t.drives[0].c, [[77.4, 18.4], [77.41, 18.41]]);
  assert.equal(t.totalMetres, 20);
});

test('candidate human landing sites are sourced and within 3° of each proposal', async () => {
  const { readFileSync } = await import('node:fs');
  const d = JSON.parse(readFileSync(new URL('../public/data/landing-sites.json', import.meta.url)));
  assert.ok(d.sites.length >= 25, `${d.sites.length} sites`);
  for (const s of d.sites) {
    assert.ok(Math.abs(s.lat - s.proposalLat) <= 3, s.name);
    assert.ok(s.lon >= -180 && s.lon <= 180 && s.gazetteer.startsWith('https://planetarynames'), s.name);
  }
  const jezero = d.sites.find(s => s.name === 'Jezero Crater');
  assert.ok(jezero && Math.abs(jezero.lat - 18.4) < 0.2 && Math.abs(jezero.lon - 77.6) < 0.3);
  assert.equal(d.sites.length + d.omitted.length, 44);
});
