import { initStars } from './stars.js';
import { initOrbit } from './orbit-text.js';
import { assetUrl, deviceTier, hasFinePointer, motion, webglAvailable } from '../env.js';

export function initHero() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const stage = hero.querySelector('[data-planet]');
  const meridianEl = hero.querySelector('[data-meridian]');

  initStars(hero.querySelector('[data-stars]'), { seed: 11 });
  initOrbit(stage, { onBuilt: () => hero.setAttribute('data-wrap', 'ready') });
  const wrap = stage.querySelector('[data-wrap]');

  const fallback = () => {
    hero.dataset.gl = 'off';
    if (meridianEl) meridianEl.textContent = '—';
  };
  if (!webglAvailable()) {
    fallback();
    return;
  }

  const tier = deviceTier();
  const [back, front] = stage.querySelectorAll('.orbit');
  const onParallax = (x, y) => {
    front.style.translate = `${(-x * 7).toFixed(2)}px ${(-y * 4).toFixed(2)}px`;
    back.style.translate = `${(x * 5).toFixed(2)}px ${(y * 3).toFixed(2)}px`;
    // The wrapped headline turns a few degrees with the globe.
    wrap?.style.setProperty('--turn', `${(x * 7).toFixed(2)}deg`);
  };

  import('./planet.js')
    .then(({ createPlanet }) => {
      const planet = createPlanet({
        canvas: stage.querySelector('[data-planet-canvas]'),
        host: stage,
        tier,
        textures: {
          base: assetUrl('textures/mars-2k.jpg'),
          hd: tier === 'high' ? assetUrl('textures/mars-4k.jpg') : undefined,
        },
        isReduced: () => motion.reduced,
        onReady: () => {
          hero.dataset.gl = 'ready';
        },
        onMeridian: (lon) => {
          if (meridianEl) meridianEl.textContent = `${lon}° E`;
        },
        onParallax: hasFinePointer() ? onParallax : undefined,
      });

      if (hasFinePointer()) {
        window.addEventListener(
          'pointermove',
          (e) => planet.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1),
          { passive: true },
        );
      }
      motion.onChange(() => planet.refresh());
    })
    .catch((error) => {
      console.warn('[MartisDux] WebGL planet unavailable, using the CSS fallback.', error);
      fallback();
    });
}
