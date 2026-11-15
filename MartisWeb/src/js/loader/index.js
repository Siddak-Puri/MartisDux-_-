// Loading screen. Each task is a real piece of work (a promise); the readout
// moves toward the share of finished work and the label names what is still
// pending. While it waits, an astronaut's helmet floats in the dark; when the
// work is done the camera dives through its visor, and the page is what is on
// the other side. It never blocks for long: after `maxWait` it lifts
// regardless, and without WebGL or the model it is a plain screen that fades.

import { assetUrl, deviceTier, webglAvailable } from '../env.js';
import { HELMET_MODEL_PATH, TIMING } from './config.js';

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));

/**
 * Starts the helmet scene alongside everything else. The model and the 3D code
 * download side by side; if either fails, `ready` settles as false and the
 * loading screen carries on without it.
 */
function openHelmet(el, { reduced }) {
  const canvas = el.querySelector('[data-loader-canvas]');
  let scene = null;
  let abandoned = false;
  let shownAt = 0;

  function start() {
    if (!canvas || !webglAvailable()) return Promise.resolve(false);
    const url = assetUrl(HELMET_MODEL_PATH);
    const model = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.arrayBuffer();
    });
    return Promise.all([import('./helmet.js'), model])
      .then(([{ createHelmet }, data]) => {
        if (abandoned) return null;
        return createHelmet({
          canvas,
          stage: el.querySelector('[data-loader-stage]'),
          overlay: el,
          data,
          path: url.slice(0, url.lastIndexOf('/') + 1),
          tier: deviceTier(),
          reduced,
        });
      })
      .then((created) => {
        if (!created) return false;
        if (abandoned) {
          created.dispose();
          return false;
        }
        scene = created;
        shownAt = performance.now();
        el.classList.add('has-helmet');
        return true;
      })
      .catch((error) => {
        console.warn('[MartisDux] Helmet unavailable, using the plain loading screen.', error);
        return false;
      });
  }

  return {
    ready: start(),
    get showing() {
      return Boolean(scene?.alive);
    },
    /** Settles once the helmet has had its moment on screen. */
    hold: () => (scene ? wait(shownAt + TIMING.helmetHold - performance.now()) : Promise.resolve()),
    exit: (options) => scene.exit(options),
    /** Too late, or no longer needed: let go of it. */
    abandon() {
      abandoned = true;
      scene?.dispose();
      scene = null;
    },
  };
}

export function runLoader(el, tasks, { maxWait = TIMING.maxWait, minShow = TIMING.minShow, reduced = false } = {}) {
  const root = document.documentElement;
  if (!el || el.hidden) {
    root.classList.remove('is-loading');
    return Promise.resolve();
  }
  const step = el.querySelector('[data-loader-step]');

  // The helmet is one more piece of work, but one the page will not wait on for long.
  const helmet = openHelmet(el, { reduced });
  const work = [
    ...tasks,
    { label: 'Sealing the helmet', promise: Promise.race([helmet.ready, wait(TIMING.helmetWait)]), weight: 2 },
  ];
  const pending = new Set(work);

  const label = () => {
    const next = work.find((t) => pending.has(t));
    step.textContent = next ? next.label : 'Ready';
  };
  label();

  const settle = work.map((task) =>
    Promise.resolve(task.promise)
      .catch(() => {})
      .then(() => {
        pending.delete(task);
        label();
      }),
  );

  // A short minimum so the screen doesn't just flash on fast connections, then
  // a moment for the helmet to be seen before the camera leaves.
  const ready = Promise.all([Promise.all(settle), wait(reduced ? 0 : minShow)]).then(() =>
    reduced ? undefined : helmet.hold(),
  );
  const limit = Number.isFinite(maxWait) ? wait(maxWait) : new Promise(() => {});

  return Promise.race([ready, limit]).then(
    () =>
      new Promise((resolve) => {
        step.textContent = 'Ready';
        const dive = helmet.showing && !reduced;
        if (!helmet.showing) helmet.abandon();
        const lift = () => {
          root.classList.remove('is-loading');
          resolve();
        };
        // A beat on "Ready" before anything moves.
        window.setTimeout(
          () => {
            if (dive) {
              el.classList.add('is-exiting');
              helmet
                .exit({
                  onReveal: () => {
                    el.classList.add('is-open');
                    lift();
                  },
                })
                .then(() => {
                  el.hidden = true;
                });
            } else {
              el.classList.add('is-done');
              lift();
              window.setTimeout(() => {
                el.hidden = true;
                helmet.abandon();
              }, 950);
            }
          },
          reduced ? 120 : dive ? TIMING.settle : 520,
        );
      }),
  );
}

/**
 * Testing aid: the same labels and weights on a fake clock, so the screen can
 * be watched without a slow network. `seconds` spreads the tasks over that
 * long; `hold` keeps the last one open until a click or a key press.
 */
export function simulateTasks(tasks, { seconds = 4, hold = false } = {}) {
  const total = tasks.reduce((sum, t) => sum + (t.weight ?? 1), 0);
  let passed = 0;
  return tasks.map((task, i) => {
    passed += task.weight ?? 1;
    if (hold && i === tasks.length - 1) {
      const released = new Promise((resolve) => {
        window.addEventListener('pointerdown', resolve, { once: true });
        window.addEventListener('keydown', resolve, { once: true });
      });
      return { ...task, label: 'Click or press a key to dive', promise: released };
    }
    return { ...task, promise: wait(((hold ? 1.2 : seconds) * 1000 * passed) / total) };
  });
}

/** Resolve when an attribute on `el` takes one of `values`. */
export function whenAttr(el, attr, values) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    if (values.includes(el.getAttribute(attr))) return resolve();
    const mo = new MutationObserver(() => {
      if (values.includes(el.getAttribute(attr))) {
        mo.disconnect();
        resolve();
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: [attr] });
  });
}

export function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}
