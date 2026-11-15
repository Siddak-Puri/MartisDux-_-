import { lookup } from './region.js';

// Slope for a sampled height grid (central differences), plus a hatched
// raster of the steep ground. Shared by the layer stack and the map so both
// draw the same "steep ground" zones. Grids from region.js carry their real
// elevation range and cell size, so slopes come out in degrees.

export function slopeGrid(grid) {
  const { data, cols, rows } = grid;
  const span = grid.maxM - grid.minM;
  const out = new Float32Array(data.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const il = Math.max(0, i - 1);
      const ir = Math.min(cols - 1, i + 1);
      const ju = Math.max(0, j - 1);
      const jd = Math.min(rows - 1, j + 1);
      const dzdx = ((data[j * cols + ir] - data[j * cols + il]) * span) / ((ir - il) * grid.cellXm);
      const dzdy = ((data[jd * cols + i] - data[ju * cols + i]) * span) / ((jd - ju) * grid.cellYm);
      out[j * cols + i] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return { ...grid, data: out };
}

/**
 * Diagonal hatching wherever the slope (degrees) is at least `threshold`, as a PNG data URL.
 * @param {number} width
 * @param {number} height
 * @param {number} spacing hatch period in px
 */
export function hatchRaster(slopes, threshold, width, height, { spacing = 8, color = [255, 156, 76], alpha = 200 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const line = spacing * 0.2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x + y) % spacing > line) continue;
      if (lookup(slopes, x / (width - 1), y / (height - 1)) < threshold) continue;
      const k = (y * width + x) * 4;
      img.data[k] = color[0];
      img.data[k + 1] = color[1];
      img.data[k + 2] = color[2];
      img.data[k + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
