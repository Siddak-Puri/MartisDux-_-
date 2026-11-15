// Environment & capability detection shared by every module.

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
const params = new URLSearchParams(window.location.search);

export const motion = {
  get reduced() {
    return reducedQuery.matches;
  },
  onChange(callback) {
    reducedQuery.addEventListener('change', () => callback(reducedQuery.matches));
  },
};

export const hasFinePointer = () => finePointerQuery.matches;

/** `?nowebgl` forces the non-WebGL fallbacks, for testing. */
export function webglAvailable() {
  if (params.has('nowebgl')) return false;
  return Boolean(window.WebGL2RenderingContext || window.WebGLRenderingContext);
}

/**
 * Testing aids for the loading screen. `?loader=demo` runs it on a simulated
 * four-second load (`?loader=7` for seven seconds, up to eight), and
 * `?loader=hold` keeps the helmet up until a click or a key press.
 */
export function loaderTest() {
  const value = params.get('loader');
  if (value === null) return null;
  if (value === 'hold') return { hold: true };
  const seconds = Number(value);
  return { seconds: seconds > 0 ? Math.min(Math.max(seconds, 1), 8) : 4 };
}

/** Coarse device tier used to pick texture size, pixel ratio and mesh detail. */
export function deviceTier() {
  const saveData = navigator.connection && navigator.connection.saveData;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const wide = window.innerWidth >= 1200;
  if (saveData || (coarse && cores <= 4)) return 'low';
  if (wide && !coarse) return 'high';
  return 'mid';
}

export const assetUrl = (path) => `${import.meta.env.BASE_URL}${path}`;

/** Run `callback` once `el` comes within `margin` of the viewport. */
export function whenNear(el, callback, margin = '50% 0px') {
  if (!('IntersectionObserver' in window)) {
    callback();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        callback();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
}

export const idle = (fn, timeout = 1200) =>
  'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout }) : window.setTimeout(fn, 1);
