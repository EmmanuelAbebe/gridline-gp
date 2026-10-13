// Development: start the Vite dev server and open it in the desktop app, so source edits show up on save.
// Usage: npm run dev:app [-- --windowed]
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`dev server ${url}`);

const electron = spawn('node_modules/.bin/electron', ['.', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, GRIDLINE_DEV_URL: url },
});
electron.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
