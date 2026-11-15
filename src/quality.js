import { DATASETS, containsPoint, tileMpp } from './data.js';

export function renderPlan(cssWidth, cssHeight, dpr, quality = true) {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  const ratio = quality === 'auto'
    ? Math.min(dpr, 1.55, Math.sqrt(3_000_000 / (w * h)))
    : quality
    ? Math.max(1, Math.min(3840 / Math.max(w, h), Math.sqrt(9_500_000 / (w * h)), 3))
    : Math.min(dpr, 2);
  return {
    ratio,
    resolutionScale: ratio / dpr,
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}

export function minimumCameraHeight(dataset, pixelHeight, fovy, maxMagnification = 1.5) {
  const effectiveMpp = Math.max(dataset.sourceMpp, tileMpp(dataset, 0));
  return Math.max(300, effectiveMpp * pixelHeight / (2 * Math.tan(fovy / 2) * maxMagnification));
}

export function detailDatasetId(mode, lon, lat) {
  if (mode === 'mola') return 'mola';
  if (mode === 'themis') return containsPoint(DATASETS.themis.bounds, lon, lat) ? 'themis' : 'viking';
  if (containsPoint(DATASETS.hirise.bounds, lon, lat)) return 'hirise';
  if (containsPoint(DATASETS.ctx.bounds, lon, lat)) return 'ctx';
  return 'viking';
}
