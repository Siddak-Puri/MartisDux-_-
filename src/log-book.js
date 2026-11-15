import { lightTimeSeconds } from './earth-link.js';

export const emptyLog = () => ({ entries: [] });

function coordinates(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return null;
  return { lat: point.lat, lon: point.lon };
}

export function saveObservation(book, observation, { ship, id, now = Date.now() }) {
  const previous = observation.id == null ? null : book.entries.find(entry => entry.id === observation.id);
  if (observation.id != null && !previous) throw new Error('This log entry could not be found.');
  if (previous?.sentAt != null) {
    if (ship) return { book, entry: previous };
    throw new Error('This entry is already in the downlink history.');
  }

  const title = String(observation.title ?? '').trim();
  const note = String(observation.note ?? '').trim();
  if (!title || !note || title.length > 100 || note.length > 4000) {
    throw new Error('Enter a title and an observation.');
  }
  const flightSeconds = ship ? Math.ceil(lightTimeSeconds(new Date(now))) : 0;
  const entry = {
    id: previous?.id ?? id,
    title,
    note,
    point: coordinates(observation.point),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    sentAt: ship ? now : null,
    arrivesAt: ship ? now + flightSeconds * 1000 : null,
  };
  const entries = [entry, ...book.entries.filter(item => item.id !== entry.id)];
  return { book: { entries }, entry };
}

export function observationStatus(entry, now = Date.now()) {
  if (entry.arrivesAt === null) return { label: 'Draft', seconds: null, state: 'draft' };
  const seconds = Math.max(0, Math.ceil((entry.arrivesAt - now) / 1000));
  if (seconds > 0) return { label: 'In flight', seconds, state: 'in-flight' };
  return { label: 'Delivered', seconds: 0, state: 'delivered' };
}

export function parseLog(text) {
  const book = JSON.parse(text);
  if (!Array.isArray(book.entries) || book.entries.some(entry =>
    !entry || typeof entry.id !== 'string' || typeof entry.title !== 'string' || typeof entry.note !== 'string' ||
    !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt) ||
    (entry.sentAt !== null && !Number.isFinite(entry.sentAt)) ||
    (entry.arrivesAt !== null && !Number.isFinite(entry.arrivesAt)) ||
    (entry.point !== null && !coordinates(entry.point))
  )) throw new Error('The local log could not be read.');
  return book;
}
