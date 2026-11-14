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
// (GRIDLINE_SMOKE_CLASS: the race in that class; Formula E's HUD: the Energy row, attack mode in its chip)
const fe = r.carClass === 'fe';
const checks = [
  ['race HUD shown', r.race?.hud],
  ...(r.carClass ? [['race in the car class asked for', r.classRace?.start?.cls === r.carClass]] : []),
  ...(fe ? [['Formula E: the Energy row', r.classRace.start.fuelLbl === 'Energy' && / kWh · /.test(r.classRace.start.fuel)],
    ['Formula E: stock car, its own AI laps in the ghost list', (r.trial?.ghosts || []).some(g => /^Your best/.test(g) && !/modified/.test(g)) && (r.trial?.ghosts || []).some(g => /^ALIEN.*1:1\d\.\d{3}$/.test(g))],
    ['Formula E: attack mode chip, then on with AWD', /^ATTACK × 2/.test(r.classRace.start.boost) && /^ATTACK 1:1\d · AWD$/.test(r.classRace.on.boost)],
    // (the Blender car: its halo lit blue in attack mode, seen from the chase camera)
    ...(r.classRace.model === '2026' ? [['Formula E: the halo\'s attack-mode LEDs lit', r.classRace.halo > 10]] : [])] : []),
  // the class picker: race weekend's CAR step (the picked car's numbers, COMPARE = both), the garage's Car tab
  ['race weekend: CAR is the first of five steps', r.menu?.steps?.length === 5 && r.menu.steps[0] === (fe ? 'GP ELECTRIC' : 'GP HYBRID')],
  ['CAR step: your car\'s numbers, COMPARE both', r.menu?.car?.one === '12 rows × 1' && r.menu.car.compare === '12 rows × 2' && r.menu.car.list.length === 2],
  ['garage opens on the Car tab, your car marked', r.garage?.car?.tab === 'Car' && r.garage.car.cards.join() === 'GP HYBRID*,GP ELECTRIC'],
  ['10 cars racing', r.race?.cars === 10],
  ['race clock running', r.race?.lapTime && r.race.lapTime !== '0:00.000'],
  ['time trial: you alone', r.trial?.cars === 1],
  ['ghost list filled', (r.trial?.ghosts || []).length >= 6],
  ['sector panel: 3 sectors + mini-sectors', r.sectors?.cells === 3 && r.sectors.minis >= 4],
  ['lap analysis opens and closes', r.analysis?.shown && r.analysis.corners >= 4 && r.analysis.refs >= 2 && r.analysis.backToPause],
  ...(r.compare ? [
    ['lap compare 2D: your lap against the reference, replayed', r.compare.shown && /^[+−±]\d/.test(r.compare.delta) && r.compare.gap && r.compare.corner.startsWith('NEXT') && r.compare.before !== r.compare.after],
    ['lap compare 2D zoomed: double-click zooms in, follows your car, double-click again = the whole circuit', r.compare.zoom?.zoomed && r.compare.zoom.x === '×5' && r.compare.zoom.follow === 'true' && r.compare.zoom.inset && r.compare.zoom.whole],
    ['lap compare 2D: the lines coloured by speed, with its key (km/h)', r.compare.speed?.key && r.compare.speed.hi > r.compare.speed.lo && r.compare.speed.lo >= 0],
    ['lap compare 3D: the circuit behind, the other car tagged, the HUD out of the way', r.compare.chase.on && r.compare.chase.tag && r.compare.chase.hudHidden && r.compare.chase.vl.startsWith('VIRTUAL LAP')],
    ['lap compare: Done puts the pause menu and the HUD back', r.compare.after3d.pause && r.compare.after3d.hud && r.compare.after3d.plain],
    ...(r.compareMenu ? [['lap compare from the start menu: your best ever in 3D, back to the paddock', r.compareMenu.on && /best ever/.test(r.compareMenu.lap) && r.compareMenu.home]] : []),
  ] : []),
  ['quit asks first', r.quitAsks === true && r.quitStay === true],
  ['garage setup: Brakes group with migration + engine braking', r.garage?.brakes?.items === 'Brake balance, Brake migration, Engine braking' && r.garage.brakes.fresh === 2 && r.garage.brakes.migration === '6 %' && r.garage.brakes.dot && r.garage.allStock === 'Stock setup'],
  ['garage setup: Differential group', r.garage?.diff === 'Entry (on the brakes) 6, Mid-corner (coasting) 6, Exit (on the throttle) 5'],
  ['garage setup: Tyres group', r.garage?.pressures === 'Front pressure 23.0 psi, Rear pressure 21.0 psi'],
  ['garage setup: Suspension group', r.garage?.suspension === '10 items, 10 new'],
  ['garage setup: Dampers group', r.garage?.dampers === 'Front bump, Rear bump, Front rebound, Rear rebound'],
  ['qualifying starts on the lights', r.quali?.lights > 0],
  ['quit only on the paddock', r.quitElsewhere === 0],
  ['HUD bar: FPS + PAUSE only', Array.isArray(r.hudButtons) && r.hudButtons.join() === 'fpsChip,pauseBtn'],
  ['full screen from Settings → Graphics', r.fullPressed === 'true'],
  ['damage on the HUD: a hit = the card + the panel (NEW); 4 s later the panel alone; the pit box lists the repairs',
    /^Front wing 40/.test(r.damage?.hit?.card || '') && r.damage.hit.panel && r.damage.hit.fresh && /Front wing 40 %/.test(r.damage.hit.rows) && /s a lap/.test(r.damage.hit.total)
    && r.damage.after?.card === false && r.damage.after.panel && !r.damage.after.fresh && /NEW NOSE \+3\.0 S/.test(r.pitBox || '') && /pays back|doesn't pay back/.test(r.pitBox || '')],
  ['practice screen from the paddock: SECTION, the map with corners, quick picks, three tiles, a corner row each, START PRACTICE', r.practice?.menu?.open && r.practice.menu.tab === 'section' && !r.practice.menu.paused && r.practice.menu.go === 'START PRACTICE' && r.practice.corners > 4 && r.practice.quick >= 4 && r.practice.tiles === 3 && r.practice.rows === r.practice.corners],
  ['practice screen: the car picker shows the car you race', r.practice?.car === (r.practice?.race === 'fe' ? 'GP ELECTRIC' : 'GP HYBRID')],
  ['practice: the first run waits for you (READY WHEN YOU ARE, rolling), Enter sets it off', r.practice?.ready && r.practice.went],
  ['practice: every run waits at READY, with the last run on it (LAST RUN · time or OFF AT)', /^LAST RUN · /.test(r.practice?.readyAgain || '')],
  ['practice analysis: COMPARE (a run against the AI, delta, parts, the car now), TELEMETRY (drives to tick, channels), CORNER (every run through it)',
    r.practice?.ana?.cmp >= 2 && /^[+−±]\d/.test(r.practice.ana.delta) && r.practice.ana.parts >= 8 && r.practice.ana.now && r.practice.ana.tel && r.practice.ana.runs >= 2
    && r.practice.ana.chans === 4 && r.practice.ana.cor && r.practice.ana.corners >= 1 && r.practice.ana.rows >= 2],
  ['practice run: the practice HUD, a run timed (or off) by the autopilot', r.practice?.box && r.practice.runs?.some(t => /^\d+(\d+\.\d{3}|OFF)/.test(t))],
  ['practice run 2: your first run as the ghost, the next corner\'s braking marks', /^BEST RUN/.test(r.practice?.ghost || '') && r.practice.brakeTags?.length > 0],
  ['practice paused: the practice screen (not the pause menu) on RUNS, a row per run, RESUME', r.practice?.paused?.open && r.practice.paused.paused && r.practice.paused.tab === 'runs' && r.practice.paused.rows >= 1 && r.practice.paused.go === 'RESUME' && !r.practice.paused.pauseMenu && r.practice.paused.chips >= 1],
  ['practice paused, another section picked: START it, RESUME the old one (back on track)', /^START /.test(r.practice?.newSection?.go || '') && /^RESUME /.test(r.practice.newSection.back) && r.practice.resumed],
  ['practice: EXIT PRACTICE = the paddock; from there the screen shows the last session', r.practice?.home && r.practice.again?.open && /LAST SESSION/.test(r.practice.again.strip) && r.practice.again.go === 'START PRACTICE'],
  ['quit closed the app', log.includes('quit via in-game button')],
  ['log file written', r.logFile === true],
  ['no page errors', Array.isArray(r.errors) && r.errors.length === 0],
  // (where the phone server ran) the race wheel's map row: a tap on ATTACK → the ECU on MANUAL, map 2
  // (the same) the phone designer: the phone page in a frame with the editor, DONE sends the layout to the phone
  ['phone designer edits and sends the layout', !r.phone || r.phone.error || (r.phone.design?.frame && r.phone.design.boxes >= 8 && r.phone.design.sent && r.phone.design.closed)],
  ['phone map tap reaches the ECU', !r.phone || r.phone.error || (r.phone.ecu?.mode === 'manual' && r.phone.ecu?.map === 2)],
  ['phone steers through the steering assist', !r.phone || r.phone.error || (r.phone.assist?.preset === 'balanced' && (r.phone.assist.kmh < 80 || r.phone.assist.steer < 0.9))],
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
console.log(`webgl: ${r.webgl}, compositing: ${r.gpu2d}, phone: ${r.phone?.seen?.state ?? r.phone?.error ?? '?'}`);
if (checks.some(([, ok]) => !ok)) fail(checks.filter(([, ok]) => !ok).map(([n]) => n).join(', ') + (r.errors?.length ? `; errors: ${r.errors.join(' | ')}` : ''));
