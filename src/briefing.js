import { lightTimeSeconds, earthMarsDistanceAU, formatDelay, AU_KM } from './earth-link.js';

const $ = id => document.getElementById(id);

export function createBriefing({ onRun }) {
  const box = $('briefing');
  const tick = () => {
    const now = new Date(), s = lightTimeSeconds(now), million = (earthMarsDistanceAU(now) * AU_KM / 1e6).toFixed(1);
    $('earth-link-delay').textContent = formatDelay(s);
    $('briefing-delay').textContent = formatDelay(s);
    $('briefing-round').textContent = formatDelay(2 * s);
    box.querySelector('.briefing-eyebrow').textContent = `EARTH ⇄ MARS · ${million} MILLION KM · RADIO DELAY RIGHT NOW`;
    $('earth-link').title = `One-way radio delay between Earth and Mars right now (${million} million km), computed on this device from JPL orbital elements.`;
  };
  tick(); setInterval(tick, 15000);
  const show = () => { tick(); box.hidden = false; $('briefing-run').focus({ preventScroll: true }); };
  const hide = () => { box.hidden = true; };
  $('briefing-run').addEventListener('click', () => { hide(); onRun(); });
  $('briefing-skip').addEventListener('click', hide);
  $('earth-link').addEventListener('click', show);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !box.hidden) hide(); });
  return { show, hide };
}
