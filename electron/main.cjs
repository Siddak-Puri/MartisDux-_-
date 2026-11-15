const { app, BrowserWindow, shell, Menu, ipcMain, nativeTheme } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.xml': 'application/xml', '.gz': 'application/octet-stream', '.lerc': 'application/octet-stream',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const PREFERRED_PORT = 47613;

function sendFile(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const PHONE_PORT = 47614;
let phoneServer = null;

function lanAddress() {
  const virtual = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier/i;
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const score = (virtual.test(name) ? 0 : 2) + (/wi-?fi|wlan|wireless/i.test(name) ? 1 : 0)
        + (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address) ? 1 : 0);
      candidates.push({ address: a.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? null;
}

function startPhoneServer() {
  if (phoneServer) return phoneServer;
  phoneServer = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/' || p === '/ar') { res.writeHead(302, { Location: '/ar/' }).end(); return; }
      if (!p.startsWith('/ar/') && !p.startsWith('/assets/')) { res.writeHead(404).end('Not found'); return; }
      sendFile(req, res);
    });
    server.once('error', error => {
      if (error.code !== 'EADDRINUSE') { phoneServer = null; return reject(error); }
      server.listen(0, '0.0.0.0', () => resolve(server.address().port));
    });
    server.listen(PHONE_PORT, '0.0.0.0', () => resolve(server.address().port));
  });
  return phoneServer;
}

async function phoneLink(res) {
  const json = body => res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  const address = lanAddress();
  if (!address) return json({ error: 'no-network' });
  try { json({ url: `http://${address}:${await startPhoneServer()}/ar/` }); }
  catch (error) { json({ error: error.code ?? 'failed' }); }
}

let tileCache = null;
function getTileCache() {
  tileCache ??= import('../server/tile-cache.mjs').then(({ createTileCache, tileRequest }) => ({
    tileRequest, cache: createTileCache({ root: path.join(app.getPath('userData'), 'tiles-v1'), bundled: ROOT }),
  }));
  return tileCache;
}
async function serveTile(req, res, pathname) {
  try {
    const { cache, tileRequest } = await getTileCache();
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ service: 'MartisDux', cache: 'device', ...cache.stats }));
      return;
    }
    const tile = tileRequest(pathname);
    if (!tile) { res.writeHead(400).end(); return; }
    const { data, source } = await cache.get(tile);
    res.writeHead(200, { 'Content-Type': tile.id === 'elevation' ? tile.type : data[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Mars-Cache': source });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error.status === 404 ? 404 : 502, { 'Cache-Control': 'no-store' }).end('Tile unavailable');
  }
}

let mainWindow = null;

const appearancePath = () => path.join(app.getPath('userData'), 'appearance.json');
let themeChoice;
const logPath = () => path.join(app.getPath('userData'), 'observations.json');

function readLog(model) {
  try { return model.parseLog(fs.readFileSync(logPath(), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return model.emptyLog();
    throw error;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

function fromAppFrame(event) {
  const contents = mainWindow?.webContents;
  return contents && event.sender === contents && event.senderFrame === contents.mainFrame;
}

function loadAppearance() {
  try {
    const { theme } = JSON.parse(fs.readFileSync(appearancePath(), 'utf8'));
    if (theme === 'light' || theme === 'dark') {
      themeChoice = theme;
      nativeTheme.themeSource = theme;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[MartisDux] Could not read appearance preferences.', error.message);
  }
}
async function saveSheet(req, res) {
  const json = (code, body) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  if (req.method !== 'POST' || !mainWindow) return json(405, { error: 'unavailable' });
  try {
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', scale: 0.82, margins: { top: 0.35, bottom: 0.35, left: 0.4, right: 0.4 } });
    const now = new Date(), two = n => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}`;
    const dir = app.getPath('desktop');
    let file = path.join(dir, `MartisDux traverse sheet ${stamp}.pdf`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `MartisDux traverse sheet ${stamp} (${n}).pdf`);
    fs.writeFileSync(file, pdf);
    json(200, { file: path.basename(file) });
  } catch (error) { json(500, { error: error.message }); }
}

function serve() {
  const server = http.createServer((req, res) => {
    if (req.url === '/__phone-link') { phoneLink(res); return; }
    if (req.url === '/__save-sheet') { saveSheet(req, res); return; }
    const pathname = req.url.split('?')[0];
    if (pathname === '/api/status' || pathname.startsWith('/tiles/')) { serveTile(req, res, pathname); return; }
    sendFile(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', error => {
      if (error.code !== 'EADDRINUSE') return reject(error);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    server.listen(PREFERRED_PORT, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await serve();
  const origin = `http://127.0.0.1:${port}`;
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640, backgroundColor: '#000000', show: false,
    title: 'MartisDux — Mars Explorer', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    ...(isMac && { titleBarStyle: 'hidden', trafficLightPosition: { x: 34, y: 37 } }),
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'appearance.cjs'),
      additionalArguments: themeChoice ? ['--martisdux-theme=' + themeChoice] : [],
    },
  });
  mainWindow = win; win.on('closed', () => { mainWindow = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.once('ready-to-show', () => {
    if (!isMac) win.maximize();
    win.show();
  });
  if (process.env.MARTISDUX_DEBUG) win.webContents.on('console-message', (event) => console.log(`[page:${event.level}] ${event.message}`));
  win.webContents.on('render-process-gone', (_e, details) => console.error('[MartisDux] renderer stopped:', details.reason));
  win.loadURL(`${origin}/${process.env.MARTISDUX_SNAPSHOT ? (process.env.MARTISDUX_PATH ?? "") : ""}`);
  if (process.env.MARTISDUX_SNAPSHOT) win.webContents.once('did-finish-load', async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(Number(process.env.MARTISDUX_WAIT ?? 20000));
    if (process.env.MARTISDUX_SCRIPT) { try { console.log('[test]', JSON.stringify(await win.webContents.executeJavaScript(fs.readFileSync(process.env.MARTISDUX_SCRIPT, 'utf8')))); } catch (e) { console.log('[test] script failed', e.message); } await wait(Number(process.env.MARTISDUX_AFTER ?? 15000)); }
    fs.writeFileSync(process.env.MARTISDUX_SNAPSHOT, (await win.webContents.capturePage()).toPNG());
    console.log('[test] snapshot saved'); app.quit();
  });
}

Menu.setApplicationMenu(process.platform === 'darwin'
  ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  : null);
ipcMain.handle('martisdux:read-log', async event => {
  if (!fromAppFrame(event)) throw new Error('Log access unavailable.');
  const model = await import('../src/log-book.js');
  return readLog(model);
});
ipcMain.handle('martisdux:save-log', async (event, observation, ship) => {
  if (!fromAppFrame(event)) throw new Error('Log access unavailable.');
  if (!observation || typeof observation.title !== 'string' || typeof observation.note !== 'string') {
    throw new Error('Invalid observation.');
  }
  const model = await import('../src/log-book.js');
  const result = model.saveObservation(readLog(model), observation, { ship: ship === true, id: randomUUID() });
  writeJson(logPath(), result.book);
  return result;
});
ipcMain.on('martisdux:set-theme', (event, theme) => {
  if (!fromAppFrame(event)) return;
  if (theme !== 'light' && theme !== 'dark') return;
  themeChoice = theme;
  nativeTheme.themeSource = theme;
  try {
    writeJson(appearancePath(), { theme });
  } catch (error) {
    console.warn('[MartisDux] Could not save appearance preferences.', error.message);
  }
});
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    loadAppearance();
    return createWindow();
  });
  app.on('window-all-closed', () => app.quit());
} else app.quit();
