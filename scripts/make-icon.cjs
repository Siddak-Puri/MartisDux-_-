const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8').replace('<svg ', '<svg width="512" height="512" ');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise(r => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, '..', 'electron', 'icon.png'), image.resize({ width: 512, height: 512 }).toPNG());
  console.log('icon written', image.getSize());
  app.quit();
});
