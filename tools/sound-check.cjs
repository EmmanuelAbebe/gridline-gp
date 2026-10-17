// Renders the sound test scenes offline (tools/soundlab) in Electron and writes one WAV per scene, plus levels
// (peak, loudness every 0.5 s) and the Doppler check for the pass-bys. Usage: npm run sound-check -- [out-dir]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const outDir = process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.cjs')) || 'sound-check';
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 5175, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log('page:', e.message); });
  await win.loadURL(server.resolvedUrls.local[0] + 'tools/soundlab/');
  for (let i = 0; i < 600 && await win.webContents.executeJavaScript('document.title') !== 'done'; i++) await new Promise(r => setTimeout(r, 100));
  const results = await win.webContents.executeJavaScript('window.soundlab && window.soundlab.results');
  if (!results) { console.log('soundlab did not finish'); app.exit(1); return; }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, r] of Object.entries(results)) {
    fs.writeFileSync(path.join(outDir, name + '.wav'), Buffer.from(r.wav, 'base64'));
    console.log(name.padEnd(11), 'peak', r.peak, ' dB', r.rmsDb.join(' '), r.doppler ? '\n            doppler ' + JSON.stringify(r.doppler) : '');
  }
  await server.close(); app.exit(0);
});
