import { HELMET_MODEL_PATH, TIMING } from './config.js';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));

export function createLaunch() {
  const root = document.documentElement;
  const app = document.querySelector('.explorer');
  const overlay = document.querySelector('[data-loader]');
  const step = overlay.querySelector('[data-loader-step]');
  const portrait = document.getElementById('home-astronaut');
  const sweep = document.getElementById('launch-sweep');
  const theme = document.getElementById('theme-toggle');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let run = 0;
  let helmet;
  let model;
  let abort;
  let began;
  let shown;
  let trail = 0;

  const imageReady = portrait.decode().catch(error => {
    console.warn('[MartisDux] The Home artwork could not be decoded.', error);
    portrait.hidden = true;
  });

  async function loadHelmet(canvas, token) {
    if (!window.WebGL2RenderingContext) return;
    const url = new URL(HELMET_MODEL_PATH, document.baseURI);
    try {
      const [{ createHelmet }, data] = await Promise.all([
        import('./helmet.js'),
        fetch(url, { signal: abort.signal }).then(response => {
          if (!response.ok) throw new Error('Helmet asset: HTTP ' + response.status);
          return response.arrayBuffer();
        }),
      ]);
      if (token !== run) return;
      const scene = await createHelmet({
        canvas, stage: overlay.querySelector('[data-loader-stage]'), overlay, data,
        path: new URL('.', url).href, tier: innerWidth >= 1200 ? 'high' : 'mid',
        reduced: motion.matches,
      });
      if (token !== run || overlay.hidden || root.dataset.launch !== 'loading') {
        scene.dispose();
        return;
      }
      helmet = scene;
      shown = performance.now();
      overlay.classList.add('has-helmet');
    } catch (error) {
      if (token === run && error.name !== 'AbortError') {
        console.warn('[MartisDux] The loading helmet could not render.', error);
      }
    }
  }

  function begin() {
    cancelAnimationFrame(trail);
    sweep.hidden = true;
    abort?.abort();
    helmet?.dispose();
    helmet = null;
    shown = 0;
    const token = ++run;
    abort = new AbortController();
    const oldCanvas = overlay.querySelector('[data-loader-canvas]');
    const canvas = oldCanvas.cloneNode(false);
    oldCanvas.replaceWith(canvas);
    overlay.className = 'loader';
    overlay.style.opacity = '';
    overlay.hidden = false;
    app.inert = true;
    theme.inert = true;
    root.dataset.launch = 'loading';
    step.textContent = 'Preparing the map';
    began = performance.now();
    model = loadHelmet(canvas, token);
  }

  function drawSweep(origin) {
    const ctx = sweep.getContext('2d');
    if (!ctx || portrait.hidden || document.body.dataset.page !== 'home') return;
    sweep.hidden = false;
    const start = performance.now();
    const duration = 1120;
    const count = 120;
    const arms = 5;
    const tau = Math.PI * 2;

    function draw(now) {
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      if (t === 1 || motion.matches || document.body.dataset.page !== 'home') {
        sweep.hidden = true;
        return;
      }
      const width = sweep.clientWidth;
      const height = sweep.clientHeight;
      const ratio = Math.min(devicePixelRatio, 1.8);
      if (sweep.width !== Math.round(width * ratio) || sweep.height !== Math.round(height * ratio)) {
        sweep.width = Math.round(width * ratio);
        sweep.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const box = document.querySelector('.home-figure').getBoundingClientRect();
      const blend = Math.min(1, t * 1.35);
      const x = (1 - blend) * origin.x * width + blend * (box.left + box.width / 2);
      const y = (1 - blend) * origin.y * height + blend * (box.top + box.height * .29);
      const radius = Math.min(width, height);
      const brightness = Math.sin(Math.PI * t) ** 1.3;
      const palettes = ['248, 157, 102', '255, 225, 192', '168, 194, 240'];
      for (let i = 0; i < count; i++) {
        const phase = i / count;
        const angle = (i % arms) * tau / arms + phase * 1.8 + t * 3.1;
        const spread = 1 - t;
        const distance = radius * (0.04 + spread * (.16 + .78 * phase));
        const tail = distance * (.23 + .17 * spread);
        const color = palettes[i % palettes.length];
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance * .78;
        const gradient = ctx.createLinearGradient(px, py, px + Math.cos(angle - 1) * tail, py + Math.sin(angle - 1) * tail);
        gradient.addColorStop(0, 'rgba(' + color + ', ' + brightness * (.22 + .58 * phase) + ')');
        gradient.addColorStop(1, 'rgba(' + color + ', 0)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = .45 + phase * 1.1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(
          x + Math.cos(angle + .20) * distance * 1.05,
          y + Math.sin(angle + .20) * distance * .82,
          x + Math.cos(angle + .46) * (distance + tail),
          y + Math.sin(angle + .46) * (distance + tail) * .78,
        );
        ctx.stroke();
      }
      trail = requestAnimationFrame(draw);
    }

    trail = requestAnimationFrame(draw);
  }

  function reveal({ animated, origin = { x: .5, y: .45 } }) {
    overlay.classList.add('is-open');
    app.inert = false;
    theme.inert = false;
    root.dataset.launch = animated ? 'reveal' : 'ready';
    if (animated) drawSweep(origin);
  }

  async function complete() {
    const token = run;
    if (root.dataset.launch !== 'loading') return;
    await Promise.all([
      imageReady,
      Promise.race([model, wait(TIMING.helmetWait - (performance.now() - began))]),
      wait(motion.matches ? 0 : TIMING.minShow - (performance.now() - began)),
    ]);
    if (token !== run) return;
    if (helmet?.alive && !motion.matches) {
      await wait(shown + TIMING.arrival - performance.now());
    }
    if (token !== run) return;

    step.textContent = 'Ready';
    const animated = helmet?.alive && !motion.matches;
    if (animated) {
      await wait(TIMING.settle);
      if (token !== run) return;
    }
    if (animated && !motion.matches && helmet.alive) {
      const readyScene = helmet;
      overlay.classList.add('is-exiting');
      await readyScene.exit({
        onReveal: () => {
          if (token === run) reveal({ animated: !motion.matches, origin: readyScene.focus });
        },
      });
    } else {
      reveal({ animated: false });
      overlay.classList.add('is-done');
      if (!motion.matches) await wait(900);
    }
    if (token !== run) return;
    overlay.hidden = true;
    helmet?.dispose();
    helmet = null;
    abort.abort();
    if (root.dataset.launch === 'reveal') {
      await wait(760);
      if (token !== run) return;
    }
    root.dataset.launch = 'ready';
  }

  function fail(error) {
    ++run;
    abort.abort();
    helmet?.dispose();
    helmet = null;
    cancelAnimationFrame(trail);
    sweep.hidden = true;
    overlay.hidden = true;
    app.inert = false;
    theme.inert = false;
    root.dataset.launch = 'ready';
    const failed = document.getElementById('fatal-error');
    failed.hidden = false;
    failed.textContent = 'The map could not load. Reopen the app to try again. MartisDux needs WebGL 2 and its bundled map files.';
    console.error('[MartisDux] The globe could not start.', error);
  }

  begin();
  return {
    stage: label => { step.textContent = label; },
    complete,
    replay: () => { begin(); return complete(); },
    fail,
  };
}
