import { PLACES, sampleGrid } from '../terrain/region.js';
import { contourSet, svgEl } from '../terrain/contours.js';

/** Small contour tiles used in the "How it would work" stations: real contours around the Jezero delta front. */
export function initJourneyTiles(root = document) {
  const groups = root.querySelectorAll('[data-terrain="tile"]');
  if (!groups.length) return;
  const [cx, cy] = PLACES.delta.at;
  const grid = sampleGrid(44, 44, { x0: cx - 0.3, y0: cy - 0.3, x1: cx + 0.3, y1: cy + 0.3 });
  const sets = new Map();
  groups.forEach((g) => {
    const x = Number(g.dataset.x);
    const y = Number(g.dataset.y);
    const size = Number(g.dataset.size);
    const key = `${x},${y},${size}`;
    if (!sets.has(key)) sets.set(key, contourSet(grid, { count: 10, width: size, height: size, offsetX: x, offsetY: y, indexEvery: 99 }));
    sets.get(key).forEach((c) => svgEl('path', { d: c.d }, g));
  });
}
