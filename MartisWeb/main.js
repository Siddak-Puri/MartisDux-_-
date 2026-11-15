// MartisDux — entry point.
// Styles and fonts are bundled locally; behaviour is split into small modules,
// and the heavier visualisations load only when their section approaches.

import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource/julius-sans-one/400.css';
import '@fontsource-variable/martian-mono/standard.css';

import './src/styles/tokens.css';
import './src/styles/base.css';
import './src/styles/layout.css';
import './src/styles/sections/hero.css';
import './src/styles/sections/mission.css';
import './src/styles/sections/layers.css';
import './src/styles/sections/journey.css';
import './src/styles/sections/explore.css';
import './src/styles/sections/simulator.css';
import './src/styles/sections/open.css';
import './src/styles/sections/roadmap.css';
import './src/styles/sections/closing.css';

import { assetUrl, idle, loaderTest, motion, whenNear } from './src/js/env.js';
import { loadImage, runLoader, simulateTasks, whenAttr } from './src/js/loader/index.js';
import { initNav } from './src/js/nav.js';
import { initReveal } from './src/js/reveal.js';
import { initScrollEffects } from './src/js/scroll.js';
import { initHero } from './src/js/hero/index.js';
import { initJourney } from './src/js/sections/journey.js';
import { initClosing } from './src/js/sections/closing.js';

window.__martisdux = true;

const reduced = motion.reduced;
const $ = (selector) => document.querySelector(selector);

initNav();
initHero();

initReveal({ reduced });
initScrollEffects({ reduced });

// Small SVG contour tiles from the Jezero data, generated off the critical path.
idle(() => import('./src/js/sections/journey-tiles.js').then(({ initJourneyTiles }) => initJourneyTiles()), 500);

initJourney($('[data-journey]'), { reduced });
initClosing($('.closing'));

// Heavier, interactive pieces load as their sections approach.
const layers = $('[data-layers]');
whenNear(layers, () => import('./src/js/sections/layers.js').then(({ initLayers }) => initLayers(layers)), '80% 0px');

const map = $('[data-map]');
whenNear(map, () =>
  idle(() => import('./src/js/sections/explorer.js').then(({ initExplorer }) => initExplorer(map))),
  '90% 0px',
);

// Loading screen: tracks the work the first screen depends on while a helmet
// floats in the dark, then dives through its visor as the hero entrance plays.
const pageLoaded = new Promise((resolve) => {
  if (document.readyState === 'complete') resolve();
  else window.addEventListener('load', resolve, { once: true });
});
const firstScreen = [
  { label: 'Setting the type', promise: document.fonts?.ready, weight: 1 },
  { label: 'Fetching the Viking surface mosaic', promise: loadImage(assetUrl('textures/mars-2k.jpg')), weight: 2 },
  { label: 'Lighting the planet', promise: whenAttr($('.hero'), 'data-gl', ['ready', 'off', 'lost']), weight: 2 },
  { label: 'Laying out the orbit', promise: whenAttr($('.hero'), 'data-wrap', ['ready']), weight: 1 },
  { label: 'Settling the dust', promise: pageLoaded, weight: 1 },
];
// `?loader=demo` and `?loader=hold` swap the real work for a fake clock (see env.js).
const test = loaderTest();
runLoader($('[data-loader]'), test ? simulateTasks(firstScreen, test) : firstScreen, {
  reduced,
  ...(test && { maxWait: test.hold ? Infinity : test.seconds * 1000 + 2500 }),
}).then(() => document.documentElement.classList.add('is-ready'));
