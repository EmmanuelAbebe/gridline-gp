// Reads the desktop app's --smoke-test output (stdout saved to a file) and fails unless the run was healthy: a race
// ran with 10 cars and the clock going, the time trial started, the log file was written, quitting asked first and closed the app, and the page
// logged no errors. Used by .github/workflows/installers.yml on every OS.
// Usage: node tools/check-smoke.mjs smoke.log
import { readFileSync } from 'node:fs';

const log = readFileSync(process.argv[2], 'utf8');
const line = log.split('\n').reverse().find(l => l.startsWith('{') && l.includes('"race"'));
const fail = msg => { console.error(`smoke test FAILED: ${msg}\n--- log ---\n${log.slice(-4000)}`); process.exit(1); };
const failed = log.split('\n').find(l => l.startsWith('{"smokeFailed"'));
if (failed) fail(`a step failed: ${JSON.parse(failed).smokeFailed}`);
if (!line) fail('no report (the app crashed or hung)');
const r = JSON.parse(line);
const checks = [
  ['race HUD shown', r.race?.hud],
  ['10 cars racing', r.race?.cars === 10],
  ['race clock running', r.race?.lapTime && r.race.lapTime !== '0:00.000'],
  ['time trial: you alone', r.trial?.cars === 1],
  ['ghost list filled', (r.trial?.ghosts || []).length >= 6],
  ['sector panel: 3 sectors + mini-sectors', r.sectors?.cells === 3 && r.sectors.minis >= 4],
  ['lap analysis opens and closes', r.analysis?.shown && r.analysis.corners >= 4 && r.analysis.refs >= 2 && r.analysis.backToPause],
  ['quit asks first', r.quitAsks === true && r.quitStay === true],
  ['garage setup: Brakes group with migration + engine braking', r.garage?.brakes?.items === 'Brake balance, Brake migration, Engine braking' && r.garage.brakes.fresh === 2 && r.garage.brakes.migration === '6 %' && r.garage.brakes.dot && r.garage.allStock === 'Stock setup'],
  ['garage setup: Differential group', r.garage?.diff === 'Entry (on the brakes) 6, Mid-corner (coasting) 6, Exit (on the throttle) 5'],
  ['garage setup: Tyres group', r.garage?.pressures === 'Front pressure 23.0 psi, Rear pressure 21.0 psi'],
  ['garage setup: Suspension group', r.garage?.suspension === '10 items, 10 new'],
  ['qualifying starts on the lights', r.quali?.lights > 0],
  ['quit only on the paddock', r.quitElsewhere === 0],
  ['HUD bar: FPS + PAUSE only', Array.isArray(r.hudButtons) && r.hudButtons.join() === 'fpsChip,pauseBtn'],
  ['full screen from Settings → Graphics', r.fullPressed === 'true'],
  ['quit closed the app', log.includes('quit via in-game button')],
  ['log file written', r.logFile === true],
  ['no page errors', Array.isArray(r.errors) && r.errors.length === 0],
  // (where the phone server ran) the race wheel's map row: a tap on ATTACK → the ECU on MANUAL, map 2
  // (the same) the phone designer: the phone page in a frame with the editor, DONE sends the layout to the phone
  ['phone designer edits and sends the layout', !r.phone || r.phone.error || (r.phone.design?.frame && r.phone.design.boxes >= 8 && r.phone.design.sent && r.phone.design.closed)],
  ['phone map tap reaches the ECU', !r.phone || r.phone.error || (r.phone.ecu?.mode === 'manual' && r.phone.ecu?.map === 2)],
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
console.log(`webgl: ${r.webgl}, compositing: ${r.gpu2d}, phone: ${r.phone?.seen?.state ?? r.phone?.error ?? '?'}`);
if (checks.some(([, ok]) => !ok)) fail(checks.filter(([, ok]) => !ok).map(([n]) => n).join(', ') + (r.errors?.length ? `; errors: ${r.errors.join(' | ')}` : ''));
