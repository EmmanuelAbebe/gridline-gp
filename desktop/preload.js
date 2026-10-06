// The only bridge between the game page and the desktop app: quit and full-screen control.
// The page checks for `window.gridlineApp`; in a normal browser it simply isn't there.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gridlineApp', {
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('app:is-fullscreen'),
  onFullscreen: fn => ipcRenderer.on('app:fullscreen', (_e, on) => fn(on)),
});
