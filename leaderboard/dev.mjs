// The leaderboard on this machine (no Vercel needed): node dev.mjs [port] serves public/ and runs api/*.js the way
// Vercel does (req.query, req.body as JSON, res.status().json()). Without Upstash env vars the boards live in memory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)), port = +process.argv[2] || 3100;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.status = code => { res.statusCode = code; return res; };
  res.json = v => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
  const api = /^\/api\/([a-z]+)$/.exec(url.pathname);
  if (api) {
    const file = path.join(root, 'api', api[1] + '.js');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'no such endpoint' });
    req.query = Object.fromEntries(url.searchParams);
    try { await (await import(file)).default(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'server error' }); }
    return;
  }
  const f = path.join(root, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!f.startsWith(path.join(root, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`leaderboard on http://localhost:${port}`));
