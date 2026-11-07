// The sim's version for replays (src/sim/sim-version.js): a hash of every src/sim file (sub-folders too). A replay only verifies on the
// very same physics code, so the leaderboard's server refuses replays from another version ("update the game").
// `npm run sim-version` writes it; tests/replay.test.js fails while it is out of date (run it after any src/sim change).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/sim'), OUT = 'sim-version.js';
export function simHash() {
  const h = createHash('sha256');
  // every .js file, in sub-folders too (classes/), by its path from src/sim
  const files = fs.readdirSync(dir, { recursive: true }).map(f => f.split(path.sep).join('/'))
    .filter(f => f.endsWith('.js') && f !== OUT).sort();
  for (const f of files)
    h.update(f + '\n' + fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n') + '\n');
  return h.digest('hex').slice(0, 12);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = simHash();
  fs.writeFileSync(path.join(dir, OUT), `// The physics code's version (tools/sim-version.mjs: a hash of src/sim; \`npm run sim-version\` after changing it).\nexport const SIM_VERSION = '${v}';\n`);
  console.log(v);
}
