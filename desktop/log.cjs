// The app's log file, for bug reports: gridline.log in the OS's log folder (Linux ~/.config/Gridline GP/logs, Windows
// %APPDATA%\Gridline GP\logs, macOS ~/Library/Logs/Gridline GP). Each start moves the last run's log to
// gridline-previous.log first, so the log of a run that crashed survives the restart. What goes in: app / OS / GPU
// versions, the page's warnings and errors, crashes of the page or the GPU process, a page that stops responding.
// Capped at MAX bytes per run. Settings → Tools → Open log folder (preload openLogs) shows it.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX = 2 * 1024 * 1024;

function createLog(app) {
  const dir = app.getPath('logs'), file = path.join(dir, 'gridline.log');
  let size = 0, full = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, 'gridline-previous.log'));
  } catch { /* a read-only profile: the game runs without a log */ }
  function write(level, ...parts) {
    if (full) return;
    const line = `${new Date().toISOString()} ${level} ${parts.map(p => p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}\n`;
    size += Buffer.byteLength(line);
    try {
      if (size > MAX) { full = true; fs.appendFileSync(file, `${new Date().toISOString()} log full (${MAX} bytes): later messages dropped\n`); }
      else fs.appendFileSync(file, line);
    } catch { /* ignore: never stop the game for its log */ }
  }
  write('info', `Gridline GP ${require('../package.json').version} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · ${os.type()} ${os.release()} ${process.arch}`,
    `· ${os.cpus()[0]?.model || '?'} × ${os.cpus().length} · ${Math.round(os.totalmem() / 2 ** 30)} GB · args ${JSON.stringify(process.argv.slice(1))}`);
  process.on('uncaughtException', e => write('error', 'app:', e));
  process.on('unhandledRejection', e => write('error', 'app (promise):', e));
  app.on('child-process-gone', (_e, d) => write('error', 'process gone:', d));
  return {
    file, dir, write,
    // a game window: its console warnings / errors, crashes, hangs
    watch(win) {
      const LEVEL = ['debug', 'info', 'warn', 'error'];
      win.webContents.on('console-message', (e, level, message, line, source) => {
        // (Electron 3x: one event object; older: positional arguments)
        const lv = typeof e?.level === 'string' ? e.level : LEVEL[level] ?? level;
        const msg = e?.message ?? message, where = e?.sourceId ?? source, at = e?.lineNumber ?? line;
        if (lv === 'warn' || lv === 'warning' || lv === 'error') write(lv === 'error' ? 'error' : 'warn', `page: ${msg}`, where ? `(${path.basename(String(where))}:${at})` : '');
      });
      // the GPU and what Chromium does with it, once the game has started it (WebGL software = a slow game)
      win.webContents.once('did-finish-load', () => setTimeout(() => app.getGPUInfo('basic')
        .then(g => write('info', 'gpu:', g.gpuDevice, app.getGPUFeatureStatus())).catch(() => {}), 3000));
      win.webContents.on('render-process-gone', (_e, d) => write('error', 'page crashed:', d));
      win.webContents.on('did-fail-load', (_e, code, desc, url) => write('error', `page failed to load: ${code} ${desc} ${url}`));
      win.on('unresponsive', () => write('warn', 'page not responding'));
      win.on('responsive', () => write('info', 'page responding again'));
    },
  };
}

module.exports = { createLog };
