// The only bridge between the game page and the desktop app: quit, full-screen control and the phone wheel.
// The page checks for `window.gridlineApp`; in a normal browser it simply isn't there.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gridlineApp', {
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('app:is-fullscreen'),
  onFullscreen: fn => ipcRenderer.on('app:fullscreen', (_e, on) => fn(on)),
  // phone wheel server in the app (desktop/phone-link.cjs): start({ link, port, renewCode }) → status
  phone: {
    start: opts => ipcRenderer.invoke('phone:start', opts),
    stop: () => ipcRenderer.invoke('phone:stop'),
    status: () => ipcRenderer.invoke('phone:status'),
    onInput: fn => ipcRenderer.on('phone:input', (_e, input) => fn(input)),
    onStatus: fn => ipcRenderer.on('phone:status', (_e, s) => fn(s)),
  },
});
