import { formatDuration } from './eva.js';
import { headingDelta } from './surface-navigation.js';

const $ = id => document.getElementById(id);
const km = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const deg = d => `${String(Math.round(d) % 360).padStart(3, '0')}°`;
const STORE = 'martisdux-hud';

export function createHud({ marswalk, hazards }) {
  const root = $('hud'), toggle = $('journey-hud-toggle');
  let on = true;
  try { on = localStorage.getItem(STORE) !== 'off'; } catch { }

  const tape = $('hud-tape');
  const marks = [];
  for (let rep = 0; rep < 3; rep++) for (let d = 0; d < 360; d += 15) {
    const label = d % 90 === 0 ? ['N', 'E', 'S', 'W'][d / 90] : d % 45 === 0 ? ['NE', 'SE', 'SW', 'NW'][(d - 45) / 90] : String(d);
    marks.push(`<span class="${d % 45 === 0 ? 'major' : ''}" style="left:${(rep * 360 + d) * 4}px">${label}</span>`);
  }
  tape.innerHTML = marks.join('');

  function set(value) {
    on = value; root.hidden = !on; toggle.setAttribute('aria-pressed', String(on));
    document.body.toggleAttribute('data-hud', on);
    try { localStorage.setItem(STORE, on ? 'on' : 'off'); } catch { }
  }
  toggle.addEventListener('click', () => set(!on));
  document.addEventListener('keydown', e => { if (document.body.dataset.journey && (e.key === 'h' || e.key === 'H') && !e.target.matches('input,select,textarea')) set(!on); });

  function marker(id, bearing, heading) {
    const el = $(id), delta = headingDelta(bearing, heading);
    el.hidden = Math.abs(delta) > 60;
    el.style.transform = `translateX(${delta * 4}px)`;
  }

  function update({ position, heading, along, remaining }) {
    if (!on) return;
    tape.style.transform = `translateX(${-(360 + heading) * 4}px)`;
    $('hud-heading').textContent = deg(heading);
    const r = marswalk?.hud(position, along);
    root.dataset.plan = r ? 'yes' : 'no';
    const here = hazards?.at(position);
    $('hud-slope').textContent = here ? `${here.slope.toFixed(0)}°` : '—';
    $('hud-slope-class').textContent = here ? here.cls.label.toUpperCase() : 'NOT MAPPED';
    $('hud-slope-box').dataset.level = here?.cls.id ?? '';
    $('hud-dest').textContent = remaining <= 1 ? 'AT DESTINATION' : `${km(remaining)} TO B`;
    if (!r) { $('hud-plan-note').hidden = false; return; }
    $('hud-plan-note').hidden = true;
    $('hud-suit').textContent = formatDuration(Math.max(0, r.budgetLeft)).toUpperCase();
    $('hud-suit-bar').style.width = `${Math.max(0, Math.min(100, 100 * r.budgetLeft / (r.usable + r.reserve)))}%`;
    $('hud-o2').textContent = `${Math.round(r.oxygen)} g O₂ · ${Math.round(r.kcal)} kcal`;
    $('hud-elapsed').textContent = `EVA ${formatDuration(r.elapsed).toUpperCase()}`;
    const level = r.margin == null ? 'unknown' : r.margin < 0 ? 'bad' : r.margin < 1800 ? 'warn' : 'ok';
    $('hud-walkback').dataset.level = level;
    const turnIn = r.noReturn ? r.noReturn.d - along : null;
    $('hud-margin').textContent = r.margin == null ? '—' : r.margin < 0 ? 'NO · TURN BACK NOW'
      : turnIn != null && turnIn > 0 ? `YES · TURN BACK IN ${km(turnIn)}` : `YES · ${formatDuration(r.margin).toUpperCase()} SPARE`;
    $('hud-home').textContent = r.home == null ? 'BASE —' : `BASE ${km(r.base.distance)} · ${deg(r.base.bearing)} · ${formatDuration(r.home)} WALK`;
    marker('hud-base-mark', r.base.bearing, heading);
    if (r.next) {
      $('hud-sci').hidden = false;
      $('hud-sci-name').textContent = r.next.name.toUpperCase();
      $('hud-sci-info').textContent = `${(r.next.rock ?? '').toUpperCase()} · ${km(r.next.distance)} · ${deg(r.next.bearing)}`;
      marker('hud-sci-mark', r.next.bearing, heading);
    } else { $('hud-sci').hidden = true; $('hud-sci-mark').hidden = true; }
    $('hud-sun').textContent = `SUN ${r.sun.toFixed(0)}°`;
    $('hud-space').textContent = { clear: 'SPACE WX CLEAR', caution: 'SPACE WX CAUTION', nogo: 'CME INBOUND', unknown: 'SPACE WX —' }[r.space];
    $('hud-space').dataset.level = r.space;
    $('hud-verdict').textContent = r.margin != null && r.margin < 0 ? 'NO-GO' : r.ok ? 'GO' : 'CHECK PLAN';
    $('hud-verdict').dataset.level = r.margin != null && r.margin < 0 ? 'bad' : r.ok ? 'ok' : 'warn';
  }

  set(on);
  return { update, set, get on() { return on; } };
}
