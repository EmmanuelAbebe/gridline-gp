// Replays a race recorded in the game (the smoke test's out-replay.json: { replay, at }) in Node, the way the
// leaderboard's server will, and says whether the player's car ends exactly where it did in the game.
// node tools/replay-check.mjs file.json
import fs from 'node:fs';
import { SIM } from '../src/sim/index.js';

const { replay, at } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const t0 = performance.now(), r = SIM.replayRun(replay), ms = performance.now() - t0;
const diff = Object.keys(at).filter(k => r.car[k] !== at[k]);
console.log(JSON.stringify({ steps: replay.steps, ms: Math.round(ms), same: !diff.length, diff: Object.fromEntries(diff.map(k => [k, [at[k], r.car[k]]])), laps: r.laps }));
process.exit(diff.length ? 1 : 0);
