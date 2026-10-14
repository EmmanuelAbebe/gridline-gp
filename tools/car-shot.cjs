// Screenshot the car showroom (tools/showroom) without a window: starts the Vite dev server, renders, saves a PNG.
// Usage: npm run car-shot -- [out.png] [query, e.g. driver=MAR&brake=0]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const out = process.argv.find(a => a.endsWith('.png')) || 'car-shot.png';
const query = process.argv.find(a => a.includes('=') && !a.startsWith('-')) || '';
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 5174, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const win = new BrowserWindow({ show: false, width: 1800, height: 900, webPreferences: { offscreen: true } });
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log('page:', e.message); });
  await win.loadURL(server.resolvedUrls.local[0] + 'tools/showroom/?' + query);
  for (let i = 0; i < 100 && await win.webContents.executeJavaScript('document.title') !== 'ready'; i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 500));
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log('saved', out);
  await server.close(); app.exit(0);
});
