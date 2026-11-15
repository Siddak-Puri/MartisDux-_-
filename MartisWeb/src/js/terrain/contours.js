// Marching squares → smoothed SVG path data, one path per contour level.

/**
 * @param {{data: Float32Array, cols: number, rows: number}} grid normalised heights
 * @param {number} level 0…1
 * @param {number} width  output width in SVG units
 * @param {number} height output height in SVG units
 * @returns {string} path `d`
 */
export function contourPath(grid, level, width, height, offsetX = 0, offsetY = 0) {
  const { data, cols, rows } = grid;
  const sx = width / (cols - 1);
  const sy = height / (rows - 1);
  const at = (i, j) => data[j * cols + i];

  // Interpolated crossing point for an edge, keyed so neighbouring cells share it.
  const points = new Map();
  const point = (key, i0, j0, i1, j1) => {
    if (!points.has(key)) {
      const a = at(i0, j0);
      const b = at(i1, j1);
      const t = (level - a) / (b - a);
      points.set(key, [offsetX + (i0 + (i1 - i0) * t) * sx, offsetY + (j0 + (j1 - j0) * t) * sy]);
    }
    return key;
  };

  const links = new Map(); // edge key → connected edge keys
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b);
    links.get(b).push(a);
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const top = () => point(`h${i},${j}`, i, j, i + 1, j);
      const right = () => point(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1);
      const bottom = () => point(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1);
      const left = () => point(`v${i},${j}`, i, j, i, j + 1);

      switch (code) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5:
        case 10: {
          // Saddle: resolve with the cell centre.
          const centre = (tl + tr + br + bl) / 4 > level;
          if ((code === 5) === centre) {
            link(left(), top());
            link(bottom(), right());
          } else {
            link(left(), bottom());
            link(top(), right());
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // Walk the links into polylines.
  const visited = new Set();
  const chains = [];
  const walk = (start) => {
    const chain = [start];
    visited.add(start);
    let current = start;
    for (;;) {
      const next = (links.get(current) || []).find((k) => !visited.has(k));
      if (!next) break;
      visited.add(next);
      chain.push(next);
      current = next;
    }
    return chain;
  };
  // Open chains first (start from endpoints), then closed loops.
  for (const [key, nbrs] of links) if (nbrs.length === 1 && !visited.has(key)) chains.push(walk(key));
  for (const key of links.keys()) if (!visited.has(key)) chains.push([...walk(key), key]);

  const f = (n) => Math.round(n * 10) / 10;
  let d = '';
  for (const chain of chains) {
    if (chain.length < 3) continue;
    const pts = chain.map((k) => points.get(k));
    // Quadratic smoothing through segment midpoints.
    d += `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k][0] + pts[k + 1][0]) / 2;
      const my = (pts[k][1] + pts[k + 1][1]) / 2;
      d += `Q${f(pts[k][0])} ${f(pts[k][1])} ${f(mx)} ${f(my)}`;
    }
    const last = pts[pts.length - 1];
    d += `L${f(last[0])} ${f(last[1])}`;
  }
  return d;
}

/** Contours for evenly spaced levels. Every `indexEvery`-th level is flagged as an index contour. */
export function contourSet(grid, { count = 14, width, height, offsetX = 0, offsetY = 0, indexEvery = 5, min = 0.03, max = 0.97 }) {
  const out = [];
  for (let n = 0; n < count; n++) {
    const level = min + ((max - min) * n) / (count - 1);
    const d = contourPath(grid, level, width, height, offsetX, offsetY);
    if (d) out.push({ level, d, index: n % indexEvery === 0 });
  }
  return out;
}

export const svgNS = 'http://www.w3.org/2000/svg';

export function svgEl(name, attrs = {}, parent) {
  const el = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
