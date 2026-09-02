const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the sandboxed renderer and the main process: quitting
// the whole app. contextIsolation is on and nodeIntegration is off (see
// main.cjs), so without this the renderer has no way to reach app.quit() at all.
contextBridge.exposeInMainWorld('electronApp', {
  exit: () => ipcRenderer.send('app:exit'),
});
