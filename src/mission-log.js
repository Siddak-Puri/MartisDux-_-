import { clockDelay, lightTimeSeconds } from './earth-link.js';
import { formatCoordinate } from './data.js';
import { emptyLog, observationStatus, parseLog, saveObservation } from './log-book.js';

const STORAGE = 'martisdux.log.v1';
const $ = id => document.getElementById(id);
const utc = date => new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const pointLabel = ({ lat, lon }) => formatCoordinate(lat, true) + ' · ' + formatCoordinate(lon, false);

function webStore() {
  const saved = localStorage.getItem(STORAGE);
  return saved ? parseLog(saved) : emptyLog();
}

export function createMissionLog({ getPosition }) {
  const native = window.martisDuxLog;
  const form = $('log-form');
  const title = $('log-title');
  const note = $('log-note');
  const items = $('log-entries');
  const feedback = $('log-feedback');
  const ship = $('log-ship');
  const save = $('log-save');
  let book = emptyLog();
  let activeId;
  let point;
  let timer;
  let visible = false;
  let busy = false;
  let storeError = '';
  let pending;

  function load() {
    pending ??= Promise.resolve().then(() => native ? native.read() : webStore()).then(value => {
      book = value;
      storeError = '';
      renderEntries();
      tick();
    }).catch(error => {
      storeError = 'The log could not be read on this device.';
      feedback.textContent = storeError;
      console.warn('[MartisDux] Observation log unavailable.', error);
    }).finally(() => { pending = null; });
    return pending;
  }

  function updateForm() {
    const entry = book.entries.find(item => item.id === activeId);
    const readOnly = entry?.sentAt != null;
    title.readOnly = Boolean(readOnly);
    note.readOnly = Boolean(readOnly);
    save.hidden = ship.hidden = Boolean(readOnly);
    $('log-position').hidden = Boolean(readOnly);
    $('log-position').textContent = point ? 'Remove' : 'Attach map position';
    $('log-position-label').textContent = point ? pointLabel(point) : 'No coordinates attached';
    const complete = title.value.trim() && note.value.trim();
    save.disabled = ship.disabled = Boolean(!complete || busy || storeError);
  }

  function select(entry) {
    activeId = entry?.id;
    point = entry?.point ?? null;
    $('log-form-title').textContent = entry?.sentAt != null ? 'Transmitted observation' : entry ? 'Edit draft' : 'New observation';
    title.value = entry?.title ?? '';
    note.value = entry?.note ?? '';
    feedback.textContent = storeError;
    for (const button of items.querySelectorAll('[data-entry]')) {
      if (button.dataset.entry === activeId) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    updateForm();
  }

  function renderEntries() {
    items.replaceChildren();
    $('log-empty').hidden = book.entries.length > 0;
    for (const entry of book.entries) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.entry = entry.id;
      if (entry.id === activeId) button.setAttribute('aria-current', 'true');
      const name = document.createElement('strong');
      const when = document.createElement('small');
      const status = document.createElement('span');
      name.textContent = entry.title;
      when.textContent = entry.point ? pointLabel(entry.point) : utc(entry.updatedAt);
      status.className = 'log-entry-status';
      button.append(name, when, status);
      button.addEventListener('click', () => select(entry));
      row.append(button);
      items.append(row);
    }
  }

  function tick() {
    clearTimeout(timer);
    if (!visible || document.hidden) return;
    const now = Date.now();
    const transmitting = [];
    [...items.children].forEach((row, index) => {
      const entry = book.entries[index];
      const status = observationStatus(entry, now);
      if (status.state === 'in-flight') transmitting.push(entry);
      const badge = row.querySelector('.log-entry-status');
      const label = status.seconds > 0 ? status.label + ' · ' + clockDelay(status.seconds) : status.label;
      if (label !== badge.textContent) badge.textContent = label;
      badge.dataset.state = status.state;
    });
    const next = transmitting.sort((a, b) => a.arrivesAt - b.arrivesAt)[0];
    $('log-signal-label').textContent = next ? 'Next simulated arrival' : 'One-way light time';
    $('log-signal-clock').textContent = clockDelay(next
      ? observationStatus(next, now).seconds
      : lightTimeSeconds(new Date(now)));
    $('log-signal-detail').textContent = next ? 'ETA ' + utc(next.arrivesAt) : 'Mars → Earth';
    timer = setTimeout(tick, next ? 1000 - now % 1000 : 15000);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || storeError || !form.reportValidity()) return;
    const sending = event.submitter === ship;
    const observation = { id: activeId, title: title.value, note: note.value, point };
    busy = true;
    updateForm();
    try {
      let result;
      if (native) result = await native.save(observation, sending);
      else {
        result = saveObservation(webStore(), observation, { ship: sending, id: crypto.randomUUID() });
        localStorage.setItem(STORAGE, JSON.stringify(result.book));
      }
      book = result.book;
      renderEntries();
      select(result.entry);
      feedback.textContent = sending ? 'In flight to Houston in this simulation.' : 'Draft saved on this device.';
      tick();
    } catch (error) {
      feedback.textContent = 'Could not save this observation. Try again.';
      console.warn('[MartisDux] Observation could not be saved.', error);
    } finally {
      busy = false;
      updateForm();
    }
  }

  form.addEventListener('submit', submit);
  form.addEventListener('input', updateForm);
  $('log-new').addEventListener('click', () => { select(); title.focus(); });
  $('log-position').addEventListener('click', () => {
    point = point ? null : getPosition();
    updateForm();
  });
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('storage', event => {
    if (!native && visible && event.key === STORAGE) load();
  });

  return {
    open() {
      visible = true;
      load().then(updateForm);
      tick();
    },
    close() {
      visible = false;
      clearTimeout(timer);
    },
  };
}
