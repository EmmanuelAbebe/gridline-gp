// Looking after the boards by hand (moderation): node admin.mjs <command> …, with the Upstash env vars from
// ../.env.local (vercel env pull) or the environment.
//   remove-player <name>   takes the player off every board (entry, ghost, replay) and frees the name
//   show <circuit> [on|off] the board as stored
import fs from 'node:fs';
import { redisStore } from './lib/store.js';
import { board } from './lib/boards.js';
import { boardKey } from './lib/verify.js';
import { SIM } from '../src/sim/index.js';

const envFile = new URL('../.env.local', import.meta.url), env = { ...process.env };
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim()); if (m && !(m[1] in env)) env[m[1]] = m[2];
}
const store = await redisStore(env);
if (!store) { console.error('no Upstash env vars (run: vercel env pull .env.local)'); process.exit(1); }
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'remove-player') {
  const id = await store.get(`pn:${String(a || '').toLowerCase()}`);
  if (!id) { console.error(`no player called ${a}`); process.exit(1); }
  for (const c of Object.keys(SIM.CIRCUITS)) for (const aero of [true, false]) {
    const k = boardKey(c, aero);
    if (await store.zget(`b:${k}`, id) !== null) { await store.zrem(`b:${k}`, id); console.log(`removed from ${k}`); }
    await store.del(`e:${k}:${id}`, `g:${k}:${id}`, `r:${k}:${id}`);
  }
  await store.del(`p:${id}`, `pn:${String(a).toLowerCase()}`);
  console.log(`${a} (${id}) removed`);
} else if (cmd === 'show') {
  console.log(JSON.stringify((await board(store, boardKey(a, b !== 'off'))).body.rows.map(r => [r.rank, r.name, r.time]), null, 1));
} else console.log('commands: remove-player <name> | show <circuit> [on|off]');
