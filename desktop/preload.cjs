// The only bridge between the game page and the desktop app: quit, full-screen control and the phone wheel.
// The page checks for `window.gridlineApp`; in a normal browser it simply isn't there.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gridlineApp', {
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('app:is-fullscreen'),
  onFullscreen: fn => ipcRenderer.on('app:fullscreen', (_e, on) => fn(on)),
  onAskQuit: fn => ipcRenderer.on('app:ask-quit', () => fn()),   // Alt+F4 / window close: the page asks "Quit?" first
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),      // → { version, url, name } | null (update-check.cjs)
  openRelease: url => ipcRenderer.send('app:open-release', url),  // only this game's GitHub releases pages
  openLogs: () => ipcRenderer.invoke('app:open-logs'),            // shows gridline.log (desktop/log.cjs) in the file manager
  debug: ipcRenderer.sendSync('app:debug'),                       // test runs only: the page installs window.gridlineDebug
  // phone wheel server in the app (desktop/phone-link.cjs): start({ link, port, renewCode }) → status
  phone: {
    start: opts => ipcRenderer.invoke('phone:start', opts),
    stop: () => ipcRenderer.invoke('phone:stop'),
    status: () => ipcRenderer.invoke('phone:status'),
    onInput: fn => ipcRenderer.on('phone:input', (_e, input) => fn(input)),
    feedback: fx => ipcRenderer.send('phone:feedback', fx),      // force feedback → the phone's vibration
    dash: d => ipcRenderer.send('phone:dash', d),                // gear, revs, speed → the phone's rev strip
    onStatus: fn => ipcRenderer.on('phone:status', (_e, s) => fn(s)),
  },
});
