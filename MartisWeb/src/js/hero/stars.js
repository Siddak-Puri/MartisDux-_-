import { mulberry32 } from '../util/random.js';

// A static, restrained starfield painted once per size change on a 2D canvas.
export function initStars(canvas, { seed = 7, density = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let lastW = 0;
  let lastH = 0;

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Ignore small height changes (mobile URL bar) to avoid needless repaints.
    if (w === lastW && Math.abs(h - lastH) < 120) return;
    lastW = w;
    lastH = h;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const rand = mulberry32(seed);
    const count = Math.round(((w * h) / 2300) * density);
    for (let i = 0; i < count; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const size = Math.pow(rand(), 3.2) * 1.15 + 0.22;
      const alpha = 0.12 + Math.pow(rand(), 1.6) * 0.62;
      const warm = rand() < 0.16;
      ctx.fillStyle = warm ? `rgba(255, 196, 150, ${alpha})` : `rgba(254, 243, 226, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // A handful of brighter stars with a soft halo.
    const bright = Math.max(3, Math.round(count / 220));
    for (let i = 0; i < bright; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 5 + rand() * 6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(254, 243, 226, 0.75)');
      g.addColorStop(0.15, 'rgba(254, 243, 226, 0.22)');
      g.addColorStop(1, 'rgba(254, 243, 226, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  draw();
  if ('ResizeObserver' in window) {
    let t;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(draw, 150);
    }).observe(canvas);
  }
}
