import { sunAt, missionSol, formatLocalTime, MISSIONS } from './mars-time.js';
import { loadSpaceWeather, walkRisk } from './space-weather.js';

const $ = id => document.getElementById(id);
const fmtDate = ms => new Date(ms).toUTCString().slice(5, 22) + ' UTC';

export function createMarsNow() {
  const el = $('mars-now'), site = MISSIONS.perseverance;
  let weather = null;
  function render() {
    const now = new Date(), sun = sunAt(site, now), sol = missionSol('perseverance', now);
    const phase = sun.elevation > 10 ? 'DAY' : sun.elevation > -6 ? (sun.ltst < 12 ? 'DAWN' : 'DUSK') : 'NIGHT';
    let sw = '', swTitle = 'Space weather loading from NASA DONKI…', level = 'pending';
    if (weather?.arrivals) {
      const r = walkRisk(weather.arrivals, now.getTime(), now.getTime() + 3 * 86400000);
      level = r.level;
      sw = r.level === 'clear' ? 'SUN QUIET' : `CME ${r.next ? new Date(r.next.arrival).toUTCString().slice(5, 11).toUpperCase() : ''}`;
      swTitle = (r.next ? `Next forecast CME arrival at Mars: ${fmtDate(r.next.arrival)}${r.next.glancing ? ' (glancing blow)' : ' (direct)'}. ` : 'No CME forecast to reach Mars in the next 3 days. ')
        + `NASA DONKI, ${weather.live ? 'checked' : 'saved copy from'} ${new Date(weather.fetched).toLocaleString()}.`;
    } else if (weather?.error) { sw = 'SPACE WX —'; swTitle = `Space weather unavailable: ${weather.error}`; level = 'unknown'; }
    el.dataset.level = level;
    el.innerHTML = `<span class="mars-now-site">JEZERO NOW</span><span>SOL ${sol}</span><span>${formatLocalTime(sun.ltst)} LTST</span><span class="mars-now-phase" data-phase="${phase}">${phase}</span>${sw ? `<span class="mars-now-sw" title="">${sw}</span>` : ''}`;
    el.title = `Perseverance mission sol ${sol} at Jezero. Local true solar time ${formatLocalTime(sun.ltst)}, Sun ${sun.elevation.toFixed(0)}° ${sun.elevation >= 0 ? 'above' : 'below'} the horizon, Ls ${sun.ls.toFixed(0)}°. ${swTitle}`;
  }
  const refresh = () => loadSpaceWeather().then(w => { weather = w; render(); });
  render(); refresh();
  setInterval(render, 10000); setInterval(refresh, 3600000);
  window.addEventListener('online', refresh);
  return { refresh };
}
