import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASETS } from './data.js';
import { renderPlan, minimumCameraHeight, detailDatasetId } from './quality.js';

test('Ultra uses a 4K long edge within the drawing-buffer budget on common laptop viewports', () => {
  for (const [width, height, dpr] of [[1456, 853, 2], [1920, 1080, 1], [900, 1600, 2], [2000, 2000, 2]]) {
    const plan = renderPlan(width, height, dpr);
    assert.ok(Math.max(plan.width, plan.height) <= 3840);
    assert.ok(plan.width * plan.height <= 9_505_000);
    assert.ok(plan.ratio >= 1 && plan.ratio <= 3);
    assert.equal(plan.resolutionScale * dpr, plan.ratio);
  }
  assert.equal(renderPlan(1456, 853, 2).width, 3840);
});

test('Balanced rendering uses native density up to 2x and Ultra keeps a native 4K viewport', () => {
  const balanced = renderPlan(1456, 853, 2, false);
  assert.equal(balanced.width, 2912);
  assert.equal(balanced.height, 1706);
  assert.equal(renderPlan(1456, 853, 3, false).ratio, 2);
  const native4K = renderPlan(3840, 2160, 2);
  assert.equal(native4K.width, 3840);
  assert.equal(native4K.height, 2160);
});

test('CTX does not permit the 400 m view that magnifies five-metre source pixels', () => {
  const ctxLimit = minimumCameraHeight(DATASETS.ctx, 2160, .65);
  const hiRiseLimit = minimumCameraHeight(DATASETS.hirise, 2160, .65);
  assert.ok(ctxLimit > 10_000 && ctxLimit < 12_000);
  assert.ok(400 < ctxLimit);
  assert.ok(hiRiseLimit >= 300 && hiRiseLimit < 1000);
  assert.ok(hiRiseLimit < ctxLimit / 10);
});

test('Oversampling a MOLA tile cannot authorize a closer view than the native source supports', () => {
  const original = minimumCameraHeight(DATASETS.mola, 2160, .65);
  const oversampled = minimumCameraHeight({ ...DATASETS.mola, maximumLevel: 20 }, 2160, .65);
  assert.equal(original, oversampled);
  assert.ok(original > 900_000);
});

test('The close-view source follows real product coverage and the selected scientific layer', () => {
  assert.equal(detailDatasetId('viking', 77.4509, 18.4446), 'hirise');
  assert.equal(detailDatasetId('viking', 137.4417, -4.5895), 'ctx');
  assert.equal(detailDatasetId('viking', 0, 89), 'viking');
  assert.equal(detailDatasetId('themis', 77, 18), 'themis');
  assert.equal(detailDatasetId('themis', 77, 80), 'viking');
  assert.equal(detailDatasetId('mola', 77, 80), 'mola');
});

test('Auto caps the desktop pixel budget while preserving the original viewport ratio', () => {
  const auto = renderPlan(1170, 788, 2, 'auto');
  const ultra = renderPlan(1170, 788, 2);
  assert.ok(auto.width * auto.height < ultra.width * ultra.height * .35);
  assert.ok(Math.abs(auto.width / auto.height - 1170 / 788) < .002);
  const large = renderPlan(3840, 2160, 2, 'auto');
  assert.ok(large.width * large.height <= 3_003_000);
});
