const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  const argument = process.argv.find(value => value.startsWith('--martisdux-theme='));
  contextBridge.exposeInMainWorld('martisDuxLog', {
    read: () => ipcRenderer.invoke('martisdux:read-log'),
    save: (observation, ship) => ipcRenderer.invoke('martisdux:save-log', observation, ship),
  });
  contextBridge.exposeInMainWorld('martisDuxAppearance', {
    mac: process.platform === 'darwin',
    initialTheme: argument?.split('=')[1],
    setTheme: value => ipcRenderer.send('martisdux:set-theme', value),
  });
}
