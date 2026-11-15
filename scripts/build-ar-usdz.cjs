const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODELS = ['jezero-marswalk-x1', 'jezero-marswalk-x3'];

app.whenReady().then(async () => {
  ipcMain.on('usdz', (_e, name, bytes) => {
    const out = path.join(ROOT, 'public', 'ar', `${name}.usdz`);
    fs.writeFileSync(out, Buffer.from(bytes));
    console.log(`wrote ${path.relative(ROOT, out)} (${(bytes.byteLength / 1e6).toFixed(2)} MB)`);
  });
  ipcMain.on('done', (_e, error) => { if (error) { console.error(error); process.exitCode = 1; } app.quit(); });
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
  await win.loadFile(path.join(__dirname, 'usdz', 'export.html'), { query: { root: ROOT, models: MODELS.join(',') } });
});
