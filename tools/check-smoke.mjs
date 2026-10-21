// Reads the desktop app's --smoke-test output (stdout saved to a file) and fails unless the run was healthy: a race
// ran with 10 cars and the clock going, the time trial started, quitting asked first and closed the app, and the page
// logged no errors. Used by .github/workflows/installers.yml on every OS.
// Usage: node tools/check-smoke.mjs smoke.log
import { readFileSync } from 'node:fs';

const log = readFileSync(process.argv[2], 'utf8');
const line = log.split('\n').reverse().find(l => l.startsWith('{') && l.includes('"race"'));
const fail = msg => { console.error(`smoke test FAILED: ${msg}\n--- log ---\n${log.slice(-4000)}`); process.exit(1); };
if (!line) fail('no report (the app crashed or hung)');
const r = JSON.parse(line);
const checks = [
  ['race HUD shown', r.race?.hud],
  ['10 cars racing', r.race?.cars === 10],
  ['race clock running', r.race?.lapTime && r.race.lapTime !== '0:00.000'],
  ['time trial: you alone', r.trial?.cars === 1],
  ['ghost list filled', (r.trial?.ghosts || []).length >= 6],
  ['quit asks first', r.quitAsks === true && r.quitStay === true],
  ['quit closed the app', log.includes('quit via in-game button')],
  ['no page errors', Array.isArray(r.errors) && r.errors.length === 0],
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
console.log(`webgl: ${r.webgl}, compositing: ${r.gpu2d}, phone: ${r.phone?.seen?.state ?? r.phone?.error ?? '?'}`);
if (checks.some(([, ok]) => !ok)) fail(checks.filter(([, ok]) => !ok).map(([n]) => n).join(', ') + (r.errors?.length ? `; errors: ${r.errors.join(' | ')}` : ''));
