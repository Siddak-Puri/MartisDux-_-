import test from 'node:test';
import assert from 'node:assert/strict';
import { lightTimeSeconds } from './earth-link.js';
import { emptyLog, observationStatus, parseLog, saveObservation } from './log-book.js';

const start = Date.parse('2026-11-14T17:30:00Z');
const observation = { title: '  Layered outcrop  ', note: ' A possible volcanic bed. ', point: { lat: 18.44, lon: 77.45 } };

test('a draft is editable and a send uses one-way light time and survives reload', () => {
  const draft = saveObservation(emptyLog(), observation, { id: 'sample', now: start });
  assert.equal(draft.entry.title, 'Layered outcrop');
  assert.equal(observationStatus(draft.entry, start).state, 'draft');

  const sent = saveObservation(draft.book, { ...observation, id: draft.entry.id, note: 'A weathered bed.' },
    { ship: true, id: 'ignore', now: start + 1000 });
  const reloaded = parseLog(JSON.stringify(sent.book));
  const entry = reloaded.entries[0];
  assert.equal(reloaded.entries.length, 1);
  assert.equal(entry.id, 'sample');
  assert.equal(entry.note, 'A weathered bed.');
  assert.deepEqual(entry.point, observation.point);
  const elapsed = Math.ceil(lightTimeSeconds(new Date(start + 1000)));
  assert.equal(entry.arrivesAt, entry.sentAt + 1000 * elapsed);
  assert.equal(observationStatus(entry, entry.sentAt + 2000).seconds, elapsed - 2);
  assert.equal(observationStatus(entry, entry.arrivesAt - 1).seconds, 1);
  assert.equal(observationStatus(entry, entry.arrivesAt).state, 'delivered');
});

test('retries for an already-shipped draft preserve its arrival time', () => {
  const sent = saveObservation(emptyLog(), observation, { ship: true, id: 'sample', now: start });
  const retry = saveObservation(sent.book, { ...observation, id: 'sample' }, { ship: true, id: 'other', now: start + 12000 });
  assert.equal(retry.entry.arrivesAt, sent.entry.arrivesAt);
  assert.throws(() => saveObservation(sent.book, { ...observation, id: 'sample' }, { now: start + 12000 }), /already/);
});

test('the model rejects whitespace-only notes and malformed saved books', () => {
  assert.throws(() => saveObservation(emptyLog(), { ...observation, note: '  ' }, { id: 'sample', now: start }), /observation/);
  assert.throws(() => parseLog('{"entries":[{}]}'), /could not be read/);
});

