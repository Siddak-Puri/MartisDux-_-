const VERSION = 'martisdux-dev';
const SHELL = `${VERSION}-shell`, DATA = `${VERSION}-data`, TILES = `${VERSION}-tiles`;
const TILE_LIMIT = 15000;
const DESKTOP_DATA = 'martisdux-device-data-v1';
const DESKTOP_TILES = 'martisdux-device-tiles-v1';
const DESKTOP = new URL(self.location.href).searchParams.has('desktop');

const CORE = ['./', 'index.html', 'favicon.svg', 'terrain/jezero.json', 'terrain/jezero-context.u16.gz', 'terrain/jezero-landing.u16.gz',
  'data/perseverance/validation.json', 'data/perseverance/routes.json', 'data/perseverance/traverse.json', 'data/perseverance/samples.json', 'data/weather/conditions.json'];
const TILE_HOSTS = ['trek.nasa.gov', 'astro.arcgis.com', 'tiles.arcgis.com', 'services.arcgisonline.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (DESKTOP) { await self.skipWaiting(); return; }
    let files = CORE;
    try { const m = await (await fetch('precache.json', { cache: 'no-store' })).json(); files = ['./', ...m.files]; } catch { }
    const cache = await caches.open(SHELL);
    for (let i = 0; i < files.length; i += 8) await Promise.allSettled(files.slice(i, i + 8).map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => {
    if (!key.startsWith('martisdux-')) return false;
    if (key === DESKTOP_DATA || key === DESKTOP_TILES) return false;
    if (DESKTOP && key === SHELL) return true;
    return !key.startsWith(VERSION);
  }).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName), keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}
const storable = r => r && (r.ok || r.type === 'opaque');

async function cacheFirst(request, cacheName, limit) {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (storable(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (limit) trim(cacheName, limit);
  }
  return response;
}
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await caches.match(request, { ignoreSearch: request.mode === 'navigate', ignoreVary: true });
    if (hit) {
      const headers = new Headers(hit.headers); headers.set('X-MartisDux-Offline', '1');
      return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
    }
    if (request.mode === 'navigate') { const shell = await caches.match('index.html', { ignoreVary: true }) ?? await caches.match('./', { ignoreVary: true }); if (shell) return shell; }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (DESKTOP || url.pathname.startsWith('/api/')) return;
    if (url.pathname.startsWith('/tiles/')) { event.respondWith(cacheFirst(request, DESKTOP ? DESKTOP_TILES : TILES, TILE_LIMIT)); return; }
    if (request.mode === 'navigate' || url.pathname.endsWith('/index.html')) event.respondWith(networkFirst(request, SHELL));
    else event.respondWith(cacheFirst(request, url.pathname.includes('/assets/') || url.pathname.includes('/cesium/') ? SHELL : DATA));
    return;
  }
  if (url.hostname === 'mars.nasa.gov' && (url.pathname.startsWith('/rss/api/') || url.pathname.startsWith('/mmgis-maps/'))) { event.respondWith(networkFirst(request, DESKTOP ? DESKTOP_DATA : DATA)); return; }
  if (url.hostname === 'mars.nasa.gov' && url.pathname.startsWith('/mars2020-raw-images/')) { event.respondWith(cacheFirst(request, DESKTOP ? DESKTOP_TILES : TILES, TILE_LIMIT)); return; }
  if (TILE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request, DESKTOP ? DESKTOP_TILES : TILES, TILE_LIMIT));
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'pack') return;
  const urls = event.data.urls ?? [], port = event.ports[0];
  event.waitUntil((async () => {
    const cache = await caches.open(DESKTOP ? DESKTOP_TILES : TILES); let done = 0, failed = 0;
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(urls.slice(i, i + 6).map(async url => {
        try {
          if (!(await cache.match(url, { ignoreVary: true }))) { const r = await fetch(url, { mode: url.includes('/mars2020-raw-images/') ? 'no-cors' : 'cors' }); if (storable(r)) await cache.put(url, r); else failed++; }
        } catch { failed++; }
        done++;
      }));
      port?.postMessage({ done, failed, total: urls.length });
    }
    port?.postMessage({ done, failed, total: urls.length, finished: true });
  })());
});
