import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Lerc from 'lerc';

const WORK = path.join(process.env.MARTISDUX_WORK || path.join(os.tmpdir(), 'martisdux-work'), 'mars-terrain');
const SERVICE = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer';
fs.mkdirSync(path.join(WORK, 'mdem'), { recursive: true });

async function tile(z, y, x) {
  const file = path.join(WORK, 'mdem', `${z}_${y}_${x}.lerc`);
  if (!fs.existsSync(file)) {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(`${SERVICE}/tile/${z}/${y}/${x}`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        break;
      } catch (e) { if (attempt >= 4) throw new Error(`MDEM tile ${z}/${y}/${x}: ${e.message}`); }
    }
  }
  const d = Lerc.decode(new Uint8Array(fs.readFileSync(file)).buffer);
  if (d.width !== 513 || d.height !== 513) throw new Error('unexpected MDEM tile shape');
  const nodata = d.statistics?.[0]?.noDataValue;
  const v = d.pixels[0];
  for (let i = 0; i < v.length; i++) if (v[i] === nodata || v[i] < -1e10) throw new Error(`nodata in MDEM tile ${z}/${y}/${x}`);
  return v;
}

async function mosaic(z, x0, x1, y0, y1) {
  const n = 512, W = (x1 - x0 + 1) * n + 1, H = (y1 - y0 + 1) * n + 1, out = new Float32Array(W * H);
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([y, x]);
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(async ([y, x]) => {
      const v = await tile(z, y, x), oc = (x - x0) * n, or = (y - y0) * n;
      for (let r = 0; r <= n; r++) out.set(v.subarray(r * 513, r * 513 + 513), (or + r) * W + oc);
    }));
  }
  const span = 180 / 2 ** z;
  return { values: out, width: W, height: H, lon0: -180 + x0 * span, lat0: 90 - y0 * span, d: span / n };
}

function save(name, g, extra) {
  fs.writeFileSync(path.join(WORK, `${name}.f32`), Buffer.from(g.values.buffer, g.values.byteOffset, g.values.byteLength));
  let min = Infinity, max = -Infinity; for (const v of g.values) { if (v < min) min = v; if (v > max) max = v; }
  const meta = { width: g.width, height: g.height, lon0: g.lon0, lat0: g.lat0, dlon: g.d, dlat: g.d, min, max, ...extra };
  fs.writeFileSync(path.join(WORK, `${name}.json`), JSON.stringify(meta, null, 1));
  console.log(name, `${g.width}×${g.height}`, `${(g.d * Math.PI / 180 * 3396190 / 1000).toFixed(2)} km/sample`, `h ${min.toFixed(0)}…${max.toFixed(0)} m`);
}

const g2 = await mosaic(2, 0, 7, 0, 3);
const W = (g2.width - 1) / 2 + 1, H = (g2.height - 1) / 2 + 1, gl = new Float32Array(W * H);
const at = (r, c) => g2.values[Math.max(0, Math.min(g2.height - 1, r)) * g2.width + ((c + g2.width - 1) % (g2.width - 1))];
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const R = 2 * r, C = 2 * c; let s = 0;
  for (const [dr, wr] of [[-1, 1], [0, 2], [1, 1]]) for (const [dc, wc] of [[-1, 1], [0, 2], [1, 1]]) s += at(R + dr, C + dc) * wr * wc;
  gl[r * W + c] = s / 16;
}
save('global-dem', { values: gl, width: W, height: H, lon0: -180, lat0: 90, d: g2.d * 2 }, { level: 2, decimation: 2, filter: '1-2-1 separable anti-alias' });

const span9 = 180 / 2 ** 9, region = { west: -180 + 727 * span9, east: -180 + 738 * span9, north: 90 - 198 * span9, south: 90 - 209 * span9 };
const span7 = 180 / 2 ** 7;
const tx0 = Math.floor((region.west + 180) / span7), tx1 = Math.floor((region.east + 180 - 1e-9) / span7);
const ty0 = Math.floor((90 - region.north) / span7), ty1 = Math.floor((90 - region.south - 1e-9) / span7);
const m7 = await mosaic(7, tx0, tx1, ty0, ty1);
const c0 = Math.round((region.west - m7.lon0) / m7.d), r0 = Math.round((m7.lat0 - region.north) / m7.d);
const RW = Math.round((region.east - region.west) / m7.d) + 1, RH = Math.round((region.north - region.south) / m7.d) + 1;
const rv = new Float32Array(RW * RH);
for (let r = 0; r < RH; r++) rv.set(m7.values.subarray((r0 + r) * m7.width + c0, (r0 + r) * m7.width + c0 + RW), r * RW);
save('region-dem', { values: rv, width: RW, height: RH, lon0: region.west, lat0: region.north, d: m7.d }, { level: 7, region });
