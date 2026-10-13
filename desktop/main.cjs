// Gridline GP desktop app: the game in its own frameless window with no browser UI at all.
// Start with `npm start` (builds first), ./gridline.sh, or the "Gridline GP" applications-menu entry.
// Loads the built game (dist/index.html); `npm run dev:app` loads the Vite dev server instead (GRIDLINE_DEV_URL).
//   --windowed            start as a maximised window instead of full screen
//   --smoke-test=out.png  (development) load hidden, screenshot the menu and a running race, print info, quit
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const arg = name => { const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`)); return a && (a.split('=')[1] ?? true); };
const smokeOut = arg('smoke-test');
const DEV_URL = process.env.GRIDLINE_DEV_URL || '';

app.setName('Gridline GP');
// GPU: Chromium's default path renders correctly on the current PC (Radeon RX 9060 XT, Mesa). The old Intel HD 520
// laptop needed hardware WebGL through ANGLE on Vulkan, which corrupts the picture on the Radeon, so that setup is
// opt-in: GRIDLINE_GPU=vulkan (./gridline.sh --vulkan).
if (process.env.GRIDLINE_GPU === 'vulkan') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('use-angle', 'vulkan');
  app.commandLine.appendSwitch('enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE');
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Gridline GP', icon: path.join(ROOT, 'public/icons/icon-512.png'),
    frame: false, fullscreen: !arg('windowed') && !smokeOut, width: 1280, height: 720,
    backgroundColor: '#0b0e12', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: !!smokeOut },
  });
  win.removeMenu();
  if (arg('windowed')) win.maximize();
  if (!smokeOut) win.once('ready-to-show', () => win.show());

  // The game never navigates away; links (none today) would open in the system browser, not in the game.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault(); });
  // Development keys (no menu bar, so no defaults): F5 / Ctrl+R reload, Ctrl+Shift+I developer tools.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { win.webContents.reload(); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  const sendFullscreen = () => win.webContents.send('app:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFullscreen);
  win.on('leave-full-screen', () => { if (!win.isMaximized()) win.maximize(); sendFullscreen(); });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(ROOT, 'dist/index.html'));
  return win;
}

ipcMain.on('app:quit', () => app.quit());
ipcMain.handle('app:toggle-fullscreen', e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});
ipcMain.handle('app:is-fullscreen', e => BrowserWindow.fromWebContents(e.sender).isFullScreen());

async function smokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await new Promise(r => setTimeout(r, 6000));
  const info = await win.webContents.executeJavaScript(`({ booted: document.getElementById('loading').hidden, appApi: !!window.gridlineApp,
    gpu: document.getElementById('gfxNote').textContent, startScreen: !document.getElementById('startOv').hidden,
    quitButtons: [...document.querySelectorAll('[data-quit]')].filter(b => !b.hidden).length })`);
  fs.writeFileSync(smokeOut, (await win.webContents.capturePage()).toPNG());
  // start a race: lights take about 5-7 s, so after 9 s the race clock must be running; second screenshot in-race
  await win.webContents.executeJavaScript(`document.getElementById('startBtn').click()`);
  await new Promise(r => setTimeout(r, 9000));
  info.race = await win.webContents.executeJavaScript(`({ hud: !document.getElementById('hud').hidden,
    lapTime: document.getElementById('tCur').textContent, position: document.getElementById('pos').textContent })`);
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-race.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('pauseBtn').click()`);
  // exercise the bridge the way a player would: full-screen button, then the quit button (which must end the app)
  await win.webContents.executeJavaScript(`document.getElementById('fullStartBtn').click()`);
  await new Promise(r => setTimeout(r, 1500));
  info.fullscreenAfterClick = win.isFullScreen();
  info.fullLabel = await win.webContents.executeJavaScript(`document.getElementById('fullStartBtn').textContent`);
  console.log(JSON.stringify({ ...info, gpu2d: app.getGPUFeatureStatus().gpu_compositing, webgl: app.getGPUFeatureStatus().webgl2, errors }));
  app.on('will-quit', () => console.log('quit via in-game button'));
  await win.webContents.executeJavaScript(`document.querySelector('#pauseOv [data-quit]').click()`);
  setTimeout(() => { console.log('quit button did NOT close the app'); app.exit(1); }, 4000);
}

if (!app.requestSingleInstanceLock()) app.quit();         // a second launch focuses the running game
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => { const win = createWindow(); if (smokeOut) smokeTest(win); });
  app.on('window-all-closed', () => app.quit());
}
