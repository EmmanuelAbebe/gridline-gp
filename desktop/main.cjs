// Gridline GP desktop app: the game in its own frameless window with no browser UI at all.
// Start with `npm start` (builds first), ./gridline.sh, or the "Gridline GP" applications-menu entry.
// Loads the built game (dist/index.html); `npm run dev:app` loads the Vite dev server instead (GRIDLINE_DEV_URL).
//   --windowed            start as a maximised window instead of full screen
//   --smoke-test=out.png  (development) load hidden in a throwaway profile, screenshot the menu and a running race
//                         (default setup: 10 cars), print info, quit
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const arg = name => { const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`)); return a && (a.split('=')[1] ?? true); };
const smokeOut = arg('smoke-test'), shotsDir = arg('track-shots');
const DEV_URL = process.env.GRIDLINE_DEV_URL || '';

app.setName('Gridline GP');
// the smoke test gets a fresh, throwaway profile: default race setup, and the player's saved settings stay untouched
if (smokeOut || shotsDir) app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gridline-smoke-')));
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
    frame: false, fullscreen: !arg('windowed') && !smokeOut && !shotsDir, width: 1280, height: 720,
    backgroundColor: '#0b0e12', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: !!(smokeOut || shotsDir) },
  });
  win.removeMenu();
  if (arg('windowed')) win.maximize();
  if (!smokeOut && !shotsDir) win.once('ready-to-show', () => win.show());

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

// The phone wheel (phone-link.cjs): Settings → Controller starts / stops it; its input and status go to the page.
// Cert and pairing code live in the app's profile (userData), the phone page in phone-wheel/.
const { createPhoneLink } = require('./phone-link.cjs');
const toPage = (channel, data) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data); };
const phone = createPhoneLink({ dataDir: path.join(app.getPath('userData'), 'phone-wheel'), pagesDir: path.join(ROOT, 'phone-wheel'),
  onInput: input => toPage('phone:input', input), onStatus: s => toPage('phone:status', s) });
ipcMain.handle('phone:start', (_e, opts) => phone.start(opts));
ipcMain.handle('phone:stop', () => phone.stop().then(() => phone.status()));
ipcMain.handle('phone:status', () => phone.status());
ipcMain.on('phone:feedback', (_e, fx) => phone.feedback(fx));
app.on('will-quit', () => { phone.close(); });

async function smokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await new Promise(r => setTimeout(r, 6000));
  const info = await win.webContents.executeJavaScript(`({ booted: document.getElementById('loading').hidden, appApi: !!window.gridlineApp,
    setup: document.getElementById('setupSummary').textContent, startScreen: !document.getElementById('startOv').hidden,
    quitButtons: [...document.querySelectorAll('[data-quit]')].filter(b => !b.hidden).length })`);
  fs.writeFileSync(smokeOut, (await win.webContents.capturePage()).toPNG());
  // the garage: open, drag the view round (a real mouse drag), paint it red, Setup tab with its numbers, an open mod
  // (MODIFIED), mods reset, Done back to the start menu
  const shot = name => win.webContents.capturePage().then(img => fs.writeFileSync(smokeOut.replace(/(\.png)?$/, `-${name}.png`), img.toPNG()));
  await win.webContents.executeJavaScript(`document.getElementById('garageBtn').click()`);
  await new Promise(r => setTimeout(r, 1200));
  await shot('garage');
  for (const [type, x] of [['mouseDown', 300], ['mouseMove', 380], ['mouseMove', 460], ['mouseUp', 460]]) {
    win.webContents.sendInputEvent({ type, x, y: 360, button: 'left', clickCount: 1 }); await new Promise(r => setTimeout(r, 60));
  }
  await win.webContents.executeJavaScript(`document.querySelector('.gar-swatch[data-c="${0xd7261e}"]').click()`);
  await new Promise(r => setTimeout(r, 500));
  await shot('garage-turned');
  info.garage = await win.webContents.executeJavaScript(`(async () => {
    const tab = name => [...document.querySelectorAll('#garTabs button')].find(b => b.textContent === name).click();
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const shown = !document.getElementById('garageOv').hidden;
    tab('Setup'); await wait(300);
    const wing = document.querySelector('#garBody input[type=range]'); wing.value = 10; wing.dispatchEvent(new Event('input'));
    await wait(300);
    const stats = [...document.querySelectorAll('.gar-stat')].map(t => t.textContent);
    return { shown, stats, sliders: document.querySelectorAll('#garBody input[type=range]').length };
  })()`);
  await shot('garage-setup');
  Object.assign(info.garage, await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('#garTabs button')].find(b => b.textContent === 'Open mods').click(); await wait(200);
    const power = document.querySelector('#garBody input[type=range]'); power.value = 150; power.dispatchEvent(new Event('input')); await wait(100);
    const modified = document.getElementById('garCar').textContent;
    [...document.querySelectorAll('#garBody button')].find(b => b.textContent === 'Reset all mods').click(); await wait(100);
    const after = document.getElementById('garCar').textContent;
    document.getElementById('garClose').click(); await wait(200);
    return { modified, after, backToMenu: !document.getElementById('startOv').hidden, summary: document.getElementById('setupSummary').textContent };
  })()`));
  // pick the next circuit (the race below runs there): the menu shows its name, outline and 3D scene
  await win.webContents.executeJavaScript(`document.querySelector('#trackStep [data-d="1"]').click()`);
  await new Promise(r => setTimeout(r, 1500));
  info.circuit = await win.webContents.executeJavaScript(`document.getElementById('eventLine').textContent`);
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-circuit.png'), (await win.webContents.capturePage()).toPNG());
  // start a race: lights take about 5-7 s, so after 9 s the race clock must be running; second screenshot in-race
  await win.webContents.executeJavaScript(`document.getElementById('startBtn').click()`);
  await new Promise(r => setTimeout(r, 9000));
  info.race = await win.webContents.executeJavaScript(`({ hud: !document.getElementById('hud').hidden,
    lapTime: document.getElementById('tCur').textContent, position: document.getElementById('pos').textContent,
    cars: document.querySelectorAll('#towerList > *').length, sound: window.gridlineDebug.soundReady() })`);
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-race.png'), (await win.webContents.capturePage()).toPNG());
  // BOX: the request shows in the HUD and the team answers on the radio
  await win.webContents.executeJavaScript(`document.getElementById('boxBtn').click()`);
  await new Promise(r => setTimeout(r, 300));
  info.box = await win.webContents.executeJavaScript(`({ pit: document.getElementById('pitState').textContent, radio: document.getElementById('radioText').textContent,
       car: document.getElementById('fuel').textContent + ' / ' + document.getElementById('tyres').textContent })`);
  // active aero: full throttle down the straight until the wings open (straight mode chip), screenshot
  await win.webContents.executeJavaScript(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }))`);
  info.aero = { opened: false };
  for (let i = 0; i < 60 && !info.aero.opened; i++) {
    await new Promise(r => setTimeout(r, 200));
    const s = await win.webContents.executeJavaScript(`({ car: window.gridlineDebug.car(), chip: document.getElementById('aeroTag').classList.contains('on') })`);
    info.aero = { opened: s.car.aeroOpen > 0.99 && s.chip, kmh: s.car.kmh, chip: s.chip };
  }
  if (info.aero.opened) fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-aero.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }))`);
  // cockpit camera (C), steering held right for a moment: the driver's arms and the wheel screen
  await win.webContents.executeJavaScript(`document.getElementById('camBtn').click();
    addEventListener('keydown', () => {}); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd' }))`);
  await new Promise(r => setTimeout(r, 700));
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-cockpit.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd' }))`);
  await win.webContents.executeJavaScript(`document.getElementById('pauseBtn').click()`);
  // settings from the pause menu, Controller tab (screenshot), then Done returns to the pause menu
  await win.webContents.executeJavaScript(`document.getElementById('pauseSettingsBtn').click();
    [...document.querySelectorAll('#setTabs button')].find(b => b.textContent === 'Controller').click()`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-settings.png'), (await win.webContents.capturePage()).toPNG());
  info.settings = await win.webContents.executeJavaScript(`(() => { const shown = !document.getElementById('setOv').hidden;
    const smoothing = document.querySelector('#setBody output').textContent; document.getElementById('setClose').click();
    return { shown, smoothing, backToPause: !document.getElementById('pauseOv').hidden }; })()`);
  // Settings → Controller → Connect phone: the QR code shows (screenshot); a phone (a WebSocket client here) joins,
  // steers and presses gas; the game drives from it; then Stop
  await win.webContents.executeJavaScript(`document.getElementById('pauseSettingsBtn').click();
    [...document.querySelectorAll('#setTabs button')].find(b => b.textContent === 'Controller').click();
    [...document.querySelectorAll('#setBody button')].find(b => b.textContent === 'Connect phone').click()`);
  await new Promise(r => setTimeout(r, 2500));
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-phone.png'), (await win.webContents.capturePage()).toPNG());
  info.phone = await (async () => {
    const st = phone.status(), url = new URL(st.url);
    if (!st.running) return { error: st.error || 'not running' };
    const WebSocket = require('ws'), ws = new WebSocket(`wss://127.0.0.1:${st.port}/ws?t=${url.searchParams.get('t')}`, { rejectUnauthorized: false });
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    const feed = setInterval(() => ws.send(JSON.stringify({ s: 0.6, g: 1, b: 0, k: 0 })), 16);
    await new Promise(r => setTimeout(r, 600));
    const seen = await win.webContents.executeJavaScript(`({ ...gridlineDebug.input(), state: document.querySelector('.dev-state').textContent,
      inUse: document.querySelector('.dev-row.active b')?.textContent })`);
    // back to the race for 3 s on full lock and full gas: the phone gets force feedback ({fx}: slides, kerbs, grass)
    const fx = [];
    ws.on('message', m => { const d = JSON.parse(m); if (d.fx) fx.push(d.fx); });
    await win.webContents.executeJavaScript(`document.getElementById('setClose').click(); document.getElementById('resumeBtn').click()`);
    clearInterval(feed);
    const steerHard = setInterval(() => ws.send(JSON.stringify({ s: 1, g: 1, b: 0, k: 0 })), 16);
    await new Promise(r => setTimeout(r, 3000));
    clearInterval(steerHard);
    await win.webContents.executeJavaScript(`document.getElementById('pauseBtn').click(); document.getElementById('pauseSettingsBtn').click();
      [...document.querySelectorAll('#setTabs button')].find(b => b.textContent === 'Controller').click()`);
    await new Promise(r => setTimeout(r, 300));          // paused: the rumble's last message (all 0) arrives
    ws.close();
    await new Promise(r => setTimeout(r, 400));
    const after = await win.webContents.executeJavaScript(`gridlineDebug.input()`);
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('#setBody button')].find(b => b.textContent === 'Stop').click()`);
    await new Promise(r => setTimeout(r, 400));
    return { link: st.link, port: st.port, qr: st.qr.startsWith('<svg'), seen, releasedSteer: after.steer, stopped: !phone.status().running,
      feedback: { messages: fx.length, felt: [...new Set(fx.flatMap(f => Object.keys(f).filter(k => k !== 'kh' && f[k] > 0)))], endsAtZero: !!fx.length && !fx.at(-1).k && !fx.at(-1).o && !fx.at(-1).s } };
  })();
  await win.webContents.executeJavaScript(`document.getElementById('setClose').click()`);
  // Sound studio from Settings → Sound: the bench plays (no errors), screenshot, close
  await win.webContents.executeJavaScript(`document.getElementById('pauseSettingsBtn').click();
    [...document.querySelectorAll('#setTabs button')].find(b => b.textContent === 'Sound').click();
    [...document.querySelectorAll('#setBody button')].find(b => b.textContent.startsWith('Sound studio')).click()`);
  await new Promise(r => setTimeout(r, 1500));
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-studio.png'), (await win.webContents.capturePage()).toPNG());
  info.studio = await win.webContents.executeJavaScript(`(() => { const shown = !document.getElementById('studio').hidden;
    const sliders = document.querySelectorAll('#studio input[type=range]').length;
    [...document.querySelectorAll('#studio button')].find(b => b.textContent === 'CLOSE').click();
    return { shown, sliders, closed: document.getElementById('studio').hidden }; })()`);
  // time trial: back to the menu, pick TIME TRIAL (ghost row shows, cars / rivals hidden), start: you alone, ghost delta row
  await win.webContents.executeJavaScript(`document.getElementById('setClose')?.click(); gridlineDebug.toMenu();
    document.querySelector('#typeSeg [data-t="trial"]').click()`);
  // (GRIDLINE_SMOKE_GHOST=file: race that ghost lap, loaded the way the LOAD button does)
  if (process.env.GRIDLINE_SMOKE_GHOST) await win.webContents.executeJavaScript(`gridlineDebug.loadGhost(${JSON.stringify(fs.readFileSync(process.env.GRIDLINE_SMOKE_GHOST, 'utf8'))})`);
  await new Promise(r => setTimeout(r, 300));
  info.trial = await win.webContents.executeJavaScript(`({ ghostRow: !document.getElementById('ghostRow').hidden, ghost: document.getElementById('ghostVal').textContent,
    carsHidden: document.getElementById('carsStep').closest('.row').hidden })`);
  await win.webContents.executeJavaScript(`document.getElementById('startBtn').click()`);
  if (process.env.GRIDLINE_SMOKE_GHOST) {      // high camera, just after the start: the ghost pulling away
    await win.webContents.executeJavaScript(`document.getElementById('camBtn').click()`);
    await new Promise(r => setTimeout(r, 7600));
    fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-ghost.png'), (await win.webContents.capturePage()).toPNG());
  }
  await new Promise(r => setTimeout(r, 9000));
  Object.assign(info.trial, await win.webContents.executeJavaScript(`({ cars: document.querySelectorAll('#towerList > *').length,
    delta: !document.getElementById('tDelta').hidden, lapTime: document.getElementById('tCur').textContent })`));
  fs.writeFileSync(smokeOut.replace(/(\.png)?$/, '-trial.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`gridlineDebug.toMenu()`);
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

// --track-shots=dir: every circuit from a few places (aerial, braking into the slowest corners, beside the barrier)
async function trackShots(win) {
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await new Promise(r => setTimeout(r, 4000));
  const js = c => win.webContents.executeJavaScript(c), wait = ms => new Promise(r => setTimeout(r, ms));
  fs.mkdirSync(shotsDir, { recursive: true });
  await js(`for (const o of document.querySelectorAll('.overlay, #startOv')) o.hidden = true`);
  for (const id of ['elkmoor', 'harrow', 'cobalt', 'marrow', 'northfold']) {
    await js(`gridlineDebug.view('${id}', 0, 0, 1, 1)`); await wait(800);
    const corners = (await js(`gridlineDebug.corners()`)).slice(0, 3);
    const views = [['aerial', `gridlineDebug.view('${id}', ${corners[0] ?? 0.3}, -60, 70, 40)`],
      ['pits', `gridlineDebug.view('${id}', 0.975, -3, 5, 40, 12)`]];
    const pit = await js(`gridlineDebug.pit()`);
    if (pit) views.push(['pitentry', `gridlineDebug.view('${id}', ${pit[0]} - 0.012, 1, 2.2, 45, 6)`],
      ['pitlane', `gridlineDebug.view('${id}', ${pit[1]} + 0.004, 13.4, 1.6, 40, 13.4)`],
      ['pitaerial', `gridlineDebug.view('${id}', ${pit[0]}, -40, 45, 60, 10)`]);
    corners.forEach((f, k) => {
      views.push([`brake${k}`, `gridlineDebug.view('${id}', ${f} - 0.03, 0, 1.6, 60)`]);
      views.push([`corner${k}`, `gridlineDebug.view('${id}', ${f} + 0.004, 4, 3, 40, -8)`]);
    });
    for (const [name, code] of views) {
      await js(code); await wait(400);
      fs.writeFileSync(path.join(shotsDir, `${id}-${name}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  console.log('track shots in ' + shotsDir, JSON.stringify(await js(`gridlineDebug.shadows()`)));
  app.exit(0);
}

if (!app.requestSingleInstanceLock()) app.quit();         // a second launch focuses the running game
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => { const win = createWindow(); if (smokeOut) smokeTest(win); else if (shotsDir) trackShots(win); });
  app.on('window-all-closed', () => app.quit());
}
