// Lightweight scroll effects: one passive listener, one rAF per frame at most,
// and work only for elements currently near the viewport.

const parallaxItems = new Set();
const progressItems = new Set();
const active = new Set();
let ticking = false;
let io;

function update() {
  ticking = false;
  const vh = window.innerHeight;
  for (const el of active) {
    const rect = el.getBoundingClientRect();
    if (parallaxItems.has(el)) {
      const factor = parseFloat(el.dataset.parallax) || 0.05;
      const offset = (rect.top + rect.height / 2 - vh / 2) * -factor;
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    }
    if (progressItems.has(el)) {
      // 0 when the element's top reaches 85% of the viewport, 1 when its bottom passes 55%.
      const start = vh * 0.85;
      const end = vh * 0.55;
      const total = rect.height + (start - end);
      const p = Math.min(1, Math.max(0, (start - rect.top) / total));
      el.style.setProperty('--progress', p.toFixed(3));
      el.dispatchEvent(new CustomEvent('progress', { detail: p }));
    }
  }
}

function requestUpdate() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(update);
  }
}

function observe(el) {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) active.add(entry.target);
          else active.delete(entry.target);
        }
        requestUpdate();
      },
      { rootMargin: '20% 0px' },
    );
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate, { passive: true });
  }
  io.observe(el);
}

export function initScrollEffects({ reduced }) {
  if (!('IntersectionObserver' in window)) return;
  if (!reduced) {
    document.querySelectorAll('[data-parallax]').forEach((el) => {
      parallaxItems.add(el);
      observe(el);
    });
  }
  document.querySelectorAll('[data-progress]').forEach((el) => {
    progressItems.add(el);
    observe(el);
  });
}
