// Hero typography around the planet.
//  1. The descriptor "Decoding the Red Planet.", wrapped onto the globe as in the Figma: each glyph sits on
//     the front of a CSS-3D cylinder, placed by its measured width so the
//     proportional face keeps natural spacing.
//  2. A slowly turning instrument ring of ticks carrying the orbital phrase.
//     It exists twice (behind and in front of the canvas), so the planet
//     hides the far half.

const TITLE = 'Decoding the Red Planet.';
const RING_PHRASE = 'Martian surface mapping · Planetary exploration · Terrain intelligence · Open science · ';
const WRAP_RADIUS = 0.64; // cylinder radius ÷ planet diameter (≈1.3 r)
const WRAP_SPAN = 104; // degrees of the cylinder the descriptor covers (ends stay legible)
const TITLE_FONT = '"Instrument Sans Variable", "Instrument Sans", system-ui, sans-serif';

let ringId = 0;

function ringMarkup() {
  const id = `ring-path-${ringId++}`;
  const r = 50.7;
  const parts = [
    '<svg viewBox="-54 -54 108 108" aria-hidden="true" focusable="false">',
    // Counter-clockwise, so text on the near (lower) half reads upright.
    `<defs><path id="${id}" d="M 0 -${r} A ${r} ${r} 0 1 0 0 ${r} A ${r} ${r} 0 1 0 0 -${r}" /></defs>`,
    '<circle class="ring__circle" r="48" />',
    '<circle class="ring__circle ring__circle--faint" r="44.6" />',
  ];
  for (let deg = 0; deg < 360; deg += 3) {
    const major = deg % 30 === 0;
    parts.push(
      `<line class="ring__tick${major ? ' ring__tick--major' : ''}" x1="0" y1="-${major ? 45.8 : 46.9}" x2="0" y2="-48" transform="rotate(${deg})" />`,
    );
  }
  const phrase = RING_PHRASE.toUpperCase().repeat(2);
  parts.push(`<text class="ring__label"><textPath href="#${id}">${phrase}</textPath></text>`);
  parts.push('</svg>');
  return parts.join('');
}

function measure(chars) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `700 100px ${TITLE_FONT}`;
  // Advance widths in em, with the same slight tightening as the CSS.
  return chars.map((ch) => ctx.measureText(ch).width / 100 - 0.008);
}

export function initOrbit(stage, { onBuilt } = {}) {
  if (!stage) return;
  stage.querySelectorAll('[data-ring]').forEach((el) => {
    el.innerHTML = ringMarkup();
  });

  const wrap = stage.querySelector('[data-wrap]');
  if (!wrap) return;
  const chars = Array.from(TITLE);
  let widths = null;
  const spans = chars.map((ch) => {
    const span = document.createElement('span');
    span.className = 'wrap-title__char';
    span.textContent = ch === ' ' ? ' ' : ch;
    return span;
  });

  function layout() {
    if (!widths) return;
    const d = stage.offsetWidth; // ignores the entrance scale
    if (!d) return;
    const radius = d * WRAP_RADIUS;
    const span = (WRAP_SPAN * Math.PI) / 180;
    const totalEm = widths.reduce((a, b) => a + b, 0);
    const fontSize = (span * radius) / totalEm;
    wrap.style.setProperty('--wrap-R', `${radius.toFixed(1)}px`);
    wrap.style.setProperty('--wrap-fs', `${fontSize.toFixed(2)}px`);

    let cursor = -span / 2;
    spans.forEach((el, i) => {
      const w = widths[i] * fontSize;
      const angle = cursor + w / 2 / radius;
      cursor += w / radius;
      // Letters toward the limb fall into shade, like type printed on a sphere.
      const light = 0.42 + 0.58 * Math.pow(Math.cos(angle), 0.8);
      el.style.setProperty('--a', `${((angle * 180) / Math.PI).toFixed(2)}deg`);
      el.style.setProperty('--cw', `${w.toFixed(2)}px`);
      el.style.setProperty('--light', light.toFixed(3));
    });
  }

  const build = () => {
    widths = measure(chars);
    wrap.replaceChildren(...spans);
    layout();
    onBuilt?.();
  };

  // Measure only once the face is available, or the spacing will be off.
  const fontReady = document.fonts?.load ? document.fonts.load(`700 100px ${TITLE_FONT}`) : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))])
    .catch(() => {})
    .then(build);
  // If the face arrived late, re-measure so the glyph spacing matches it.
  document.fonts?.ready.then(() => {
    if (!widths) return;
    widths = measure(chars);
    layout();
  });

  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(stage);
  else window.addEventListener('resize', layout);
}
