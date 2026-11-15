const MMGIS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/';

async function getLive(name, timeout = 25000) {
  const r = await fetch(MMGIS + name, { signal: AbortSignal.timeout(timeout), cache: 'no-cache' });
  if (!r.ok) throw new Error(`MMGIS ${r.status}`);
  return { json: await r.json(), updated: r.headers.get('Last-Modified'), saved: r.headers.get('X-MartisDux-Offline') === '1' };
}

export function latestWaypoint(features) {
  let best = null;
  for (const f of features ?? []) {
    const p = f.properties;
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    if (!best || p.sol > best.sol || (p.sol === best.sol && p.dist_total_m > best.dist)) best = { sol: p.sol, lat: p.lat, lon: p.lon, dist: p.dist_total_m, rmc: p.RMC };
  }
  return best;
}

export function compactTraverse(features) {
  const drives = [];
  for (const f of features ?? []) {
    const c = (f.geometry?.coordinates ?? []).map(([lon, lat]) => [lon, lat]).filter((q, i, all) => i === 0 || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1]);
    if (c.length > 1) drives.push({ sol: f.properties?.sol, m: f.properties?.length ?? 0, c });
  }
  return { drives, totalMetres: drives.reduce((s, d) => s + d.m, 0) };
}

export async function loadRoverPosition(bundled) {
  if (navigator.onLine !== false) {
    try {
      const { json, updated, saved } = await getLive('M20_waypoints.json');
      const latest = latestWaypoint(json.features);
      if (latest) return { ...latest, live: !saved, updated };
    } catch { }
  }
  return bundled ? { ...bundled, live: false } : null;
}

export async function loadTraverse(bundledUrl) {
  if (navigator.onLine !== false) {
    try {
      const { json, updated, saved } = await getLive('M20_traverse.json', 40000);
      const t = compactTraverse(json.features);
      if (t.drives.length) return { ...t, live: !saved, updated };
    } catch { }
  }
  const t = await fetch(bundledUrl).then(r => r.json());
  return { ...t, live: false, updated: null };
}
