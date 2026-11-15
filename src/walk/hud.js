import './hud.css';

const fmtDist = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const fmtTime = s => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const fmtLocal = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`;
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function createHud(root) {
  root.innerHTML = `
    <div class="hud-compass"><div class="hud-tape"></div><b class="hud-heading"></b></div>
    <div class="hud-tl"><span class="hud-k">SOL</span><b data-f="sol"></b><span class="hud-k">LMST</span><b data-f="lmst"></b><span class="hud-k">ELEV</span><b data-f="elev"></b></div>
    <div class="hud-reticle"><i></i><span data-f="ahead"></span></div>
    <div class="hud-bl">
      <div class="hud-row"><span class="hud-k">O₂</span><div class="hud-bar"><i data-f="o2bar"></i></div><b data-f="o2"></b></div>
      <div class="hud-row"><span class="hud-k">EVA</span><b data-f="eva"></b></div>
      <div class="hud-row"><span class="hud-k">DOSE</span><b data-f="dose"></b></div>
      <div class="hud-row"><span class="hud-k">SLOPE</span><b data-f="slope"></b></div>
    </div>
    <div class="hud-br">
      <span class="hud-k">NEXT</span><b class="hud-next" data-f="next"></b>
      <div class="hud-nav"><span class="hud-arrow" data-f="arrow">▲</span><b data-f="nextDist"></b></div>
      <span class="hud-k">ROUTE</span><b data-f="route"></b>
      <span class="hud-k">BASE</span><b data-f="base"></b>
    </div>
    <div class="hud-alert" data-f="alert" hidden></div>`;
  const f = {}; root.querySelectorAll('[data-f]').forEach(el => { f[el.dataset.f] = el; });
  const tape = root.querySelector('.hud-tape'), heading = root.querySelector('.hud-heading');
  tape.innerHTML = Array.from({ length: 72 }, (_, i) => {
    const d = (i * 15) % 360;
    return `<span class="${d % 45 ? '' : 'big'}">${d % 45 ? '' : CARD[d / 45]}</span>`;
  }).join('');
  const set = (k, v) => { if (f[k].textContent !== v) f[k].textContent = v; };

  return {
    update(s) {
      tape.style.transform = `translateX(${-(s.heading + 360) / 15 * 28}px)`;
      heading.textContent = `${String(Math.round(s.heading) % 360).padStart(3, '0')}°`;
      set('sol', String(s.time.sol)); set('lmst', fmtLocal(s.time.lmst)); set('elev', `${Math.round(s.elevation)} m`);
      set('ahead', Math.abs(s.slopeAhead) >= 3 ? `${s.slopeAhead > 0 ? '↗' : '↘'} ${Math.abs(s.slopeAhead).toFixed(0)}°` : '');
      set('o2', `${Math.round(s.suit.o2Percent)}%`); f.o2bar.style.width = `${s.suit.o2Percent}%`;
      set('eva', fmtTime(s.suit.evaSeconds)); set('dose', `${s.suit.doseMicroSv.toFixed(1)} µSv`);
      set('slope', `${s.slope.toFixed(0)}° · ${s.slopeClass.label}`);
      f.slope.dataset.level = s.slopeClass.id;
      if (s.next) {
        set('next', s.next.name); set('nextDist', fmtDist(s.next.distance));
        f.arrow.style.transform = `rotate(${s.next.turn}deg)`;
      }
      set('route', `${fmtDist(s.route.walked)} / ${fmtDist(s.route.length)}${s.route.offRoute > 15 ? ` · ${Math.round(s.route.offRoute)} m off` : ''}`);
      set('base', `${fmtDist(s.base.distance)} · ${CARD[Math.round(s.base.bearing / 45) % 8]}`);
      const alert = s.slopeClass.id === 'nogo' ? 'NO-GO SLOPE — STOP' : s.slopeClass.id === 'steep' ? 'STEEP GROUND' : s.suit.o2Percent < 20 ? 'O₂ LOW — RETURN TO BASE' : '';
      f.alert.hidden = !alert; set('alert', alert);
    },
  };
}
