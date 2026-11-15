import { initStars } from '../hero/stars.js';
import { assetUrl, whenNear } from '../env.js';

// Section 08: the rising limb's orbital ring, with circular typography that
// echoes the hero.
const PHRASE = 'MartisDux · Make Mars feel navigable · Layered surface mapping · Built in the simulator ·Open source · ';

export function initClosing(section) {
  if (!section) return;
  initStars(section.querySelector('[data-stars]'), { seed: 29, density: 0.75 });

  // The horizon planet is far wider than the screen, so it gets its own sharp
  // strip texture, loaded only as the section approaches. The strip is drawn at
  // twice the disc's width (max(150vw, 1500px)), so pick the size that keeps
  // it at or above one texture pixel per device pixel.
  const planet = section.querySelector('[data-horizon-planet]');
  if (planet) {
    whenNear(planet, () => {
      const drawn = Math.max(window.innerWidth * 1.5, 1500) * 2 * Math.min(window.devicePixelRatio || 1, 2);
      const conn = navigator.connection;
      const big = drawn > 6144 && !(conn && conn.saveData);
      const src = assetUrl(`textures/mars-horizon-${big ? '12k' : '6k'}.webp`);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { planet.style.backgroundImage = `url('${src}')`; };
      img.src = src;
    }, '100% 0px');
  }

  const ring = section.querySelector('[data-horizon-ring]');
  if (!ring) return;
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 2) {
    const major = deg % 30 === 0;
    ticks.push(
      `<line class="horizon-tick${major ? ' horizon-tick--major' : ''}" x1="0" y1="-${major ? 48 : 48.35}" x2="0" y2="-48.8" transform="rotate(${deg})" />`,
    );
  }
  const words = PHRASE.repeat(5)
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part} <tspan class="dot">·</tspan> `)
    .join('');
  ring.innerHTML = `
    <svg viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
      <defs><path id="horizon-arc" d="M -46.4 0 A 46.4 46.4 0 1 1 46.4 0 A 46.4 46.4 0 1 1 -46.4 0" /></defs>
      <circle class="horizon-circle" r="48.8" />
      <circle class="horizon-circle horizon-circle--faint" r="45.4" />
      ${ticks.join('')}
      <text class="horizon-text"><textPath href="#horizon-arc">${words}</textPath></text>
    </svg>`;
}
