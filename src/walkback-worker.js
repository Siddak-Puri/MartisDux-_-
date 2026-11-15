import { walkBackField } from './eva.js';

self.onmessage = ({ data }) => {
  const { id, grid, base, params } = data;
  const t0 = performance.now();
  const time = walkBackField(grid, base, params);
  self.postMessage({ id, time, ms: performance.now() - t0 }, [time.buffer]);
};
