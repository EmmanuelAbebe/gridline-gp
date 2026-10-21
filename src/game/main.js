// ============================================================================
// GAME: the race state machine and main loop, wiring the modules together.
// Modules talk through plain function calls downward and events upward (Input → game);
// game state never lives in the DOM.
// ============================================================================
import '../styles/fonts.css';
import '../styles/base.css';
import '../styles/hud.css';
import '../styles/menus.css';
import '../styles/tools.css';
import { SIM } from '../sim/index.js';
import { CONFIG, SFX, GFX_PROFILES, RACE_SETUP, PHASE } from './config.js';
import { $, fmtTime, createTimers } from './util.js';
import { Settings } from './settings.js';
import { Design } from './design.js';
import { Display, createFpsMonitor } from './display.js';
import { Input } from './input.js';
import { Sound } from './sound.js';
import { buildWorld } from './world.js';
import { CarModels } from './car-models.js';
import { CameraRig } from './camera-rig.js';
import { createMinimap, drawOutline } from './minimap.js';
import { Hud } from './hud.js';
import { Screens } from './screens.js';
import { WheelScreen } from './wheel-screen.js';
import { createMirrors } from './mirrors.js';
import { aiLap, aiLapReady, ghostDriver, createRival, rivalGap } from './ai-ghosts.js';
import { createRacingLine } from './racing-line.js';
import { createGhostInputs } from './ghost-inputs.js';
import { createPresence } from './presence.js';
import { createHudMirror } from './hud-mirror.js';
import { createRecorder, ghostPose, ghostDelta, loadGhosts, keepGhost, ghostOf, dropGhost, readGhostFile, storeJson, packGhost, unpackGhost } from './ghost.js';
import { HudStyle } from './hud-style.js';
import { LayoutEditor } from './layout-editor.js';
import { TweakPanel } from './tweak-panel.js';
import { AppShell } from './app-shell.js';
import { InputMonitor } from './input-monitor.js';
import { SettingsScreen } from './settings-screen.js';
import { SoundStudio } from './sound-studio.js';
import { createSlipstreamFx } from './slipstream-fx.js';
import { createRaceAudio } from './race-audio.js';
import { poseOf, savePoses, interpolatePoses } from './pose.js';
import { loadSetup, loadPrefs, steerRate, raceFormat, raceWear, raceAero, buildField, playerSlotOf, assistsOf, setupSummary } from './setup-store.js';
import { messageFor, SAY } from './race-messages.js';
import { bindSettings } from './settings-binding.js';
import { installDebug } from './debug.js';
import { PhoneWheel } from './phone-wheel.js';
import { createHaptics } from './haptics.js';
import { createPitCrews } from './pit-crew.js';
import { createTyreMarks } from './tyre-marks.js';
import { Garage } from './garage.js';
import { loadGarage, loadRecords, recordLap, playerSpec, playerDriver } from './garage-store.js';

const { EV } = SIM;
// circuits are built on first use (~40 ms) and kept
const tracks = new Map([[SIM.track.id, SIM.track]]);
const trackOf = id => { if (!tracks.has(id)) tracks.set(id, SIM.buildTrack(SIM.CIRCUITS[id])); return tracks.get(id); };
let track = null, world = null, minimap = null;
const carModels = SIM.DRIVERS.map(d => CarModels.create(Display.scene, d, Design.data.car));
const modelOf = new Map(SIM.DRIVERS.map((d, i) => [d.code, carModels[i]]));   // car model by driver code
const playerModel0 = carModels[SIM.DRIVERS.findIndex(d => d.player)];
playerModel0.mountScreen(WheelScreen.mesh);
// working rear-view mirrors on the player's car (mirrors.js), rebuilt with the car design
const mirrors = createMirrors(Display.renderTo);
mirrors.build(playerModel0.object, Design.data.car.parts);
const wakes = createSlipstreamFx(Display.scene, SIM.DRIVERS);
const raceAudio = createRaceAudio();
const timers = createTimers();
const fpsMonitor = createFpsMonitor(CONFIG.fps.window);

const game = {
  phase: PHASE.MENU, paused: false, frozen: false, race: null, player: null, gfx: null,
  setup: loadSetup(Settings.get(CONFIG.storageKeys.race)),   // start-screen choices: cars, race type, laps / minutes (+ gearbox, assists from Settings)
  prefs: loadPrefs(Settings.get(CONFIG.storageKeys.prefs)),  // Settings screen: controller, sound, FPS counter
  garage: loadGarage(Settings.get(CONFIG.storageKeys.garage)),    // your car: livery, setup, open mods (garage.js)
  records: loadRecords(Settings.get(CONFIG.storageKeys.records)), // best valid lap per circuit, stock and modified apart
  // ghost laps (ghost.js): your best per circuit and class, and ones loaded from a file; game.ghost = the one shown
  ghosts: loadGhosts(Settings.get(CONFIG.storageKeys.ghosts), SIM.CIRCUITS), loadedGhosts: loadGhosts(Settings.get(CONFIG.storageKeys.ghostsLoaded), SIM.CIRCUITS),
  ghost: null, ghostStart: null, trial: false, rival: null,   // rival: a live AI ghost (ai-ghosts.js createRival)
  lights: { t: 0, lit: 0, hold: 0 }, resultsAt: -1, resultsShown: false, ended: false, finalLapShown: false, timeUpShown: false,
  towerT: 0, mapT: 0, slowWindows: 0, acc: 0, carsDirty: false,
  pendingShift: 0, autoShiftHinted: false, queueHinted: false, steerRate: Infinity,   // paddle press waiting for the next sim step
};
const isRunning = () => !!game.race && game.phase !== PHASE.MENU && !game.paused && !game.frozen;

// ---- ghost laps and time trial (ghost.js) ----
const recorder = createRecorder();
const haptics = createHaptics();       // force feedback for the phone wheel
const crews = createPitCrews(Display.scene);   // the people in the pit lane (built per race)
const marks = createTyreMarks(Display.scene);  // rubber laid by sliding / locking / spinning tyres (cleared per race)
const ghostModel = CarModels.create(Display.scene, playerDriver(game.garage), Design.data.car);   // the see-through car
ghostModel.setMaterials(CarModels.ghostMaterials()); ghostModel.setShadows(false); ghostModel.setVisible(false);
const saveGhosts = () => Settings.set(CONFIG.storageKeys.ghosts, storeJson(game.ghosts));
const saveLoadedGhosts = () => Settings.set(CONFIG.storageKeys.ghostsLoaded, storeJson(game.loadedGhosts));
const carModified = () => SIM.isModified(game.garage.mods);
const racingLine = createRacingLine(Display.scene);   // the ALIEN's line, colour by its pedals (pref racingLine)
const hudMirror = createHudMirror(Display);        // the rear-view strip on the HUD (pref hudMirror)
const ghostInputs = createGhostInputs();             // the AI ghost's steering / gas / brake charts (pref ghostInputs)
// AI laps (ai-ghosts.js): the fastest AI driver alone at each level, made once per circuit and active-aero setting
const LEVELS = RACE_SETUP.aiLevels, aiPick = () => Object.hasOwn(LEVELS, game.setup.ghost) ? game.setup.ghost : null;
const aiLapsReady = aero => Object.keys(LEVELS).every(id => aiLapReady(track, id, aero));
const aiLapOf = (id, aero = raceAero(game.setup).activeAero) => aiLap(track, id, LEVELS[id], aero);
// the recorded ghost to race on this circuit in this car class (game.setup.ghost): the one loaded from a file (else
// your best), or your best; start = the standing-start lap (your lap 1 from the grid), else the flying lap. (An AI
// pick races a live car instead: game.rival.)
function activeGhost(modified = carModified(), start = false) {
  if (game.setup.ghost === 'loaded' && ghostOf(game.loadedGhosts, track.id, modified)) return ghostOf(game.loadedGhosts, track.id, modified, start);
  return ghostOf(game.ghosts, track.id, modified, start);
}
const showGhostLivery = g => { if (g) ghostModel.setLivery({ ...game.garage.livery, ...(g.livery || {}) }); };
// the list of ghosts on the start menu (time trial): yours, the loaded one, every AI level with its lap time and the
// gap to your best. The AI laps take ~0.3 s to make the first time on a circuit: the list says so and fills in after.
let aiPending = false;
function renderGhostRow() {
  if (game.setup.type !== 'trial') return;          // (the row is only shown for a time trial)
  const mod = carModified(), mine = ghostOf(game.ghosts, track.id, mod), loaded = ghostOf(game.loadedGhosts, track.id, mod);
  const aero = raceAero(game.setup).activeAero, ready = aiLapsReady(aero);
  if (!ready && !aiPending) { aiPending = true; setTimeout(() => { for (const id in LEVELS) aiLapOf(id, aero); aiPending = false; renderGhostRow(); }, 30); }
  const ai = ready ? Object.fromEntries(Object.keys(LEVELS).map(id => [id, aiLapOf(id, aero)])) : {}, D = ghostDriver(), pick = game.setup.ghost;
  const mineStart = ghostOf(game.ghosts, track.id, mod, true);
  const rows = [['mine', 'Your best', [mod ? 'modified car' : '', mineStart ? 'lap 1 from the grid ' + fmtTime(mineStart.time) : ''].filter(Boolean).join(' · '), mine,
    'No lap yet: your first clean lap']];
  if (loaded) rows.push(['loaded', 'Loaded', loaded.driver && loaded.driver !== 'You' ? loaded.driver : 'from a file', loaded, '']);
  for (const [id, label] of RACE_SETUP.choices.ai) rows.push([id, label, D.name, ai[id], ready ? 'no clean lap' : 'timing…']);
  const sel = pick === 'loaded' && !loaded ? 'mine' : pick;
  $('ghostList').replaceChildren(...rows.map(([id, name, sub, g, none]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost-pick'; b.dataset.ghost = id;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === sel));
    const t = document.createElement('span'); t.textContent = g ? fmtTime(g.time) : none;
    const gap = document.createElement('i');
    if (g && mine && g !== mine && id !== 'mine') { const d = g.time - mine.time; gap.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2); gap.className = d >= 0 ? 'up' : 'down';
      gap.title = d >= 0 ? 'slower than your best' : 'faster than your best'; }
    const n = document.createElement('b'); n.textContent = name;
    if (sub) { const sm = document.createElement('small'); sm.textContent = sub; n.append(sm); }
    b.append(n, t, gap);
    b.onclick = () => { game.setup.ghost = id; saveSetup(); };
    return b;
  }));
  $('ghostExport').disabled = !mine; $('ghostClear').hidden = !loaded;
}
// EXPORT: your best here as a small gzipped file (compact JSON inside: ghost.js packGhost), to send to a friend
$('ghostExport').onclick = async () => {
  const mod = carModified(), g = ghostOf(game.ghosts, track.id, mod); if (!g) return;
  const a = document.createElement('a');   // (your standing-start lap goes with it, for your friend's lap 1)
  a.href = URL.createObjectURL(new Blob([await packGhost(g, ghostOf(game.ghosts, track.id, mod, true))], { type: 'application/gzip' }));
  a.download = `gridline-ghost-${track.id}-${fmtTime(g.time).replace(/[:.]/g, '-')}.json.gz`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('ghostLoad').onclick = () => $('ghostFile').click();
$('ghostFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) f.arrayBuffer().then(b => unpackGhost(new Uint8Array(b), SIM.CIRCUITS)).then(loadGhost);   // .json.gz, or an old .json
};
// a ghost file's text (smoke test)
const loadGhostText = text => loadGhost(readGhostFile(text, SIM.CIRCUITS));
// a loaded ghost (LOAD button): kept as the loaded ghost for its circuit and class, and that circuit picked
function loadGhost(g) {
  if (!g) { Hud.toast('That file is not a Gridline ghost lap'); return; }
  const { standing, ...lap } = g;
  dropGhost(game.loadedGhosts, g.circuit, g.modified);        // one friend's laps at a time per class
  for (const x of [lap, standing]) if (x) keepGhost(game.loadedGhosts, x);
  saveLoadedGhosts();
  if (g.circuit !== track.id) { game.setup.track = g.circuit; setTrack(g.circuit); renderSetup(); saveSetup(); }
  game.setup.ghost = 'loaded'; saveSetup();
  Hud.toast(`Ghost loaded: ${fmtTime(g.time)} on ${SIM.CIRCUITS[g.circuit].name}`);
}
$('ghostClear').onclick = () => { dropGhost(game.loadedGhosts, track.id, carModified()); saveLoadedGhosts(); renderGhostRow(); };

// ---- race setup and prefs (setup-store.js: loading, validation, what they mean for a race) ----
const savePrefs = () => Settings.set(CONFIG.storageKeys.prefs, JSON.stringify(game.prefs));
// Push the prefs into the modules that use them.
function applyPrefs() {
  const p = game.prefs;
  Input.setConfig(p); Sound.setMuted(p.muted); racingLine.setMode(p.racingLine); hudMirror.setOn(p.hudMirror);
  ghostInputs.show(!!game.rival && p.ghostInputs, game.rival ? `${game.rival.driver.code} · ${game.rival.levelId.toUpperCase()}` : '');
  Sound.setVolumes({ master: p.volume / 100, engine: p.engineVol / 100, fx: p.fxVol / 100, ambience: p.ambVol / 100 }); Hud.setMuted(p.muted); Hud.showFps(p.showFps);
}

// ---- graphics mode ----
function setGfx(id, announce) {
  const p = GFX_PROFILES[id], gpu = Display.gpu;
  game.gfx = id;
  Display.applyProfile(p); world?.applyProfile(p); CarModels.applyProfile(carModels, p); hudMirror.setPerformance(id === 'perf');
  mirrors.setQuality(!p.lambertCars); mirrors.build(playerModel0.object, Design.data.car.parts);   // resolution follows the mode
  game.gfxNote = (gpu.short ? 'Graphics: ' + gpu.short + '. ' : '') + p.note(gpu.weak);
  if (announce) { Settings.set(CONFIG.storageKeys.gfx, id); Hud.toast(p.label); }
  describeSetup(); SettingsScreen.redraw();
}
const toggleGfx = () => setGfx(game.gfx === 'perf' ? 'quality' : 'perf', true);

// ---- render interpolation: sim state (x, z, h) → the pose drawn (pose.js) ----
function snapCamera() { interpolatePoses(game.race.cars, 1); CameraRig.snap(game.player); }

// ---- race flow: menu → lights → race → done (results) ----
function setStartLights(n) { Hud.setStartLamps(n); world.setStartLights(n); }

function newRace() {
  timers.clear();
  const s = game.setup, field = buildField(s.cars, s.type === 'trial').map(d => d.player ? playerDriver(game.garage) : d);   // your livery in the tower, map, results
  const race = SIM.createRace(raceFormat(s), { track, drivers: field, aiPace: RACE_SETUP.aiLevels[s.ai].pace, aiFollow: RACE_SETUP.aiLevels[s.ai].follow || 1, aiAlien: !!RACE_SETUP.aiLevels[s.ai].alien, wear: raceWear(s), ...raceAero(s) });
  for (const [code, m] of modelOf) m.setVisible(field.some(d => d.code === code));
  const L = CONFIG.lights;
  const player = race.cars.find(c => c.player);
  setGearbox(player, game.setup.gearbox);
  player.assists = assistsOf(game.setup);
  player.spec = playerSpec(game.garage);             // the garage's setup + open mods (the rivals race SIM.STOCK)
  player.boostAuto = s.overtake === 'auto';
  game.trial = s.type === 'trial'; recorder.stop();
  // time trial: an AI pick = a live rival in a race of its own (no contact), else a recorded ghost lap
  const pick = game.trial ? aiPick() : null;
  game.rival = pick ? createRival(track, pick, LEVELS[pick], { activeAero: race.activeAero }) : null;
  game.ghost = game.trial && !pick ? activeGhost(player.spec.modified) : null;            // laps 2..
  game.ghostStart = game.trial && !pick ? activeGhost(player.spec.modified, true) : null; // lap 1, from the grid
  Hud.setDelta(null, game.trial); ghostModel.setVisible(false);
  if (game.rival) { const d = game.rival.driver; ghostModel.setLivery({ ...game.garage.livery, color: d.color, accent: d.accent }); }
  ghostInputs.show(!!game.rival && game.prefs.ghostInputs, game.rival ? `${game.rival.driver.code} · ${pick.toUpperCase()}` : '');
  racingLine.set(track, aiLapOf('alien', race.activeAero)?.line);
  crews.build(race, Design.data.car); marks.clear();
  showGhostLivery(game.ghostStart || game.ghost);
  Object.assign(game, { race, player, phase: PHASE.LIGHTS, paused: false, pendingShift: 0, pendingBoost: false, autoShiftHinted: false, queueHinted: false,
    resultsAt: -1, resultsShown: false, ended: false, finalLapShown: false, timeUpShown: false,
    lights: { t: 0, lit: 0, hold: L.holdMin + Math.random() * L.holdRand } });
  setStartLights(0); Hud.showLights(true); Hud.setLapTimes(0, 0); raceAudio.reset();
  Screens.show(null); Screens.hud(true);
  snapCamera();
}

function stepStartLights(dt) {
  const L = CONFIG.lights, s = game.lights;
  s.t += dt;
  const n = Math.min(L.count, Math.floor(s.t / L.interval));
  if (n > s.lit) { s.lit = n; setStartLights(n); Sound.beep(...SFX.light); }
  if (s.t >= L.interval * L.count + s.hold) lightsOut();
}

function lightsOut() {
  game.phase = PHASE.RACE; game.race.t = 0;
  recorder.start(0);                         // the first lap runs from lights out (lapStart 0)
  setStartLights(0); Hud.flash('GO', 0.8); Sound.beep(...SFX.go);
  timers.after(CONFIG.lights.hideAfterGo, () => Hud.showLights(false));
}

const showMessage = m => { if (!m) return; if (m.radio) Hud.radio(m.radio, m.secs); else Hud.toast(m.toast, m.kind, m.secs); };
// A player car's SIM event: its message (race-messages.js), plus what it does to the race flow, sound and camera.
function onPlayerEvent(c, e) {
  const race = game.race;
  haptics.event(e);
  showMessage(messageFor(e, c, race));
  switch (e.type) {
    case EV.LAP: {
      Hud.setLapTimes(e.time, c.bestLap, e.invalid);
      // the ghost: keep the lap when it is your best valid one here (in this car class); in a time trial race it next
      // (c.lap 2 = lap 1 just done: from the grid at lights out, a standing start)
      const g = recorder.lap(e.time, { circuit: race.track.id, modified: c.spec.modified, driver: 'You', date: Date.now(), start: c.lap === 2,
        livery: { color: game.garage.livery.color, accent: game.garage.livery.accent } });
      recorder.start(c.lapStart);
      if (!e.invalid && g && keepGhost(game.ghosts, g)) {
        saveGhosts();
        if (game.trial && !game.rival && activeGhost(c.spec.modified, g.start) === g) { game[g.start ? 'ghostStart' : 'ghost'] = g; showGhostLivery(g); }
      }
      if (!e.invalid && recordLap(game.records, race.track.id, c.spec.modified, e.time)) {
        Settings.set(CONFIG.storageKeys.records, JSON.stringify(game.records)); describeRecord();
        showMessage({ toast: `New lap record${c.spec.modified ? ' (modified car)' : ''}  ${fmtTime(e.time)}`, kind: 'purple' });
      }
      if (c.lap === race.laps && !c.finished) announceFinalLap();
      break;
    }
    case EV.CUT: Sound.beep(...SFX.cut); break;
    case EV.SHIFT_DENIED:     // manual: a downshift waiting for the revs to drop (shown in the gear label)
      if (!game.queueHinted) { game.queueHinted = true; showMessage(SAY.downQueued); }
      break;
    case EV.FINISH:
      Hud.flash('CHEQUERED FLAG', 2); game.phase = PHASE.DONE; game.resultsAt = race.t + CONFIG.resultsDelay;
      break;
    case EV.WALL:
    case EV.CONTACT: {
      // a tyre wall or TecPro soaks a hit up (softer sound, less shake) than Armco or concrete (SIM BARRIERS)
      const wall = e.type === EV.WALL, sfx = wall ? SFX.wall : SFX.contact, hard = wall ? e.hard : 1;
      if (e.impact >= sfx.min) { const k = Math.min(1, e.impact / sfx.fullAt) * hard; Sound.impact(k, sfx); CameraRig.shake(k * (wall ? 0.6 : 0.35)); }
      break;
    }
    case EV.SAUSAGE:          // a raised kerb: a bang and a jolt
      Sound.impact(Math.min(0.5, e.impact / 20), SFX.kerbStrike); CameraRig.shake(Math.min(0.5, e.impact / 15));
      break;
  }
}
function drainEvents(c) {
  if (!c.events.length) return;
  if (c.player) for (const e of c.events) onPlayerEvent(c, e);
  c.events.length = 0;
}

function announceFinalLap() {
  if (game.finalLapShown) return;
  game.finalLapShown = true;
  timers.after(CONFIG.finalLapFlashDelay, () => Hud.flash('FINAL LAP', 1.4));
}
// Race-wide moments the player should hear about: time running out, and the flag ahead of them.
function watchRace(race) {
  if (race.t >= race.duration && !game.timeUpShown) { game.timeUpShown = true; showMessage(SAY.timeUp); }
  if (race.chequered && !game.player.finished) announceFinalLap();
}
// Pause menu "End race": classify everyone where they are now.
function endRace() {
  if (!game.race || game.resultsShown) return;
  game.paused = false; game.ended = true; game.phase = PHASE.DONE;
  showResults();
}

function showResults() {
  game.resultsShown = true;
  Hud.renderResults(game.race, game.player);
  Screens.show('results', 'againBtn');
}

function simStep(dt) {
  const race = game.race;
  if (game.ended) return;                     // ended from the pause menu: the field stays where it stopped
  savePoses(race.cars); if (game.rival) savePoses(game.rival.race.cars);
  timers.tick(dt);
  if (game.phase === PHASE.LIGHTS) { stepStartLights(dt); return; }
  race.t += dt;
  if (game.rival) game.rival.step(dt);        // the AI ghost's own race, in step with yours from lights out
  for (const c of race.cars) {
    if (c.player && !c.finished && game.autopilot) SIM.driveAI(race, c, dt, game.autopilot);   // (gridlineDebug.autopilot: screenshots)
    else if (c.player && !c.finished) { SIM.drivePlayer(race, c, { ...Input.drive, steerRate: game.steerRate, calm: game.prefs.calm / 100, speedSteer: game.prefs.speedSteer === 'on' ? SIM.ASSISTS.medium.steer : 0, shift: game.pendingShift, boost: game.pendingBoost }, dt); game.pendingShift = 0; game.pendingBoost = false; }
    else SIM.driveAI(race, c, dt, c.finished ? CONFIG.finishedAiSkill : 0);
  }
  SIM.collide(race);
  if (!game.player.finished) recorder.sample(game.player, race.t); else recorder.stop();
  for (const c of race.cars) drainEvents(c);
  watchRace(race);
  if (game.resultsAt > 0 && race.t >= game.resultsAt && !game.resultsShown) showResults();
}

// ---- player commands (keyboard, pad, buttons) ----
function togglePause() {
  if (game.phase === PHASE.MENU || !game.race || game.resultsShown) return;
  game.paused = !game.paused;
  Screens.show(game.paused ? 'pause' : null, game.paused ? 'resumeBtn' : null);
}
function startFromMenu() { Sound.init(); newRace(); }
function toMenu() { game.phase = PHASE.MENU; game.resultsShown = false; Screens.hud(false); Screens.show('start', 'startBtn'); }
// auto: the car shifts; semi: you shift up, the car shifts down (you may click down too); manual: you shift.
function setGearbox(car, mode) { car.autoShift = mode === 'auto'; car.autoDown = mode === 'semi'; car.downQueue = 0; }
// Paddles (Q/E, phone buttons 1/2, LB/RB). With the automatic gearbox they do nothing; say so once per race.
const racing = () => isRunning() && game.phase === PHASE.RACE && !game.player.finished;
function shift(dir) {
  if (!racing()) return;
  if (!game.player.autoShift) { game.pendingShift = dir; return; }
  if (!game.autoShiftHinted) { game.autoShiftHinted = true; showMessage(SAY.autoShift); }
}
function confirm() {                                   // pad A
  if (AppShell.quitOpen) { AppShell.cancelQuit(); return; }   // (A never quits: the safe answer)
  if (SettingsScreen.open || InputMonitor.open) return;
  if (away) { if (away.reason !== 'phone') backFromAway(); return; }
  if (game.phase === PHASE.MENU) startFromMenu();
  else if (game.resultsShown) newRace();
  else if (game.paused) togglePause();
}
function onCameraChanged() {
  const cam = CameraRig.mode;
  if (game.player) snapCamera();
  HudStyle.apply(cam.id); TweakPanel.setCamera(cam.id); LayoutEditor.setCamera(cam);
}
function cycleCamera() { CameraRig.cycle(); onCameraChanged(); }
function toggleLayout() {
  if (LayoutEditor.active) LayoutEditor.exit();
  else if ($('hud').hidden) showMessage(SAY.noHud);
  else LayoutEditor.enter(CameraRig.mode);
}
// ---- "are you there?" (presence.js): the phone put down, a pad untouched, the controller gone → the race pauses ----
const presence = createPresence();
const AWAY = {
  phone: ['Phone wheel put down', "Pick the phone up and tap I'm here on it: the race carries on after a 3 second count."],
  idle: ['Are you there?', "Your controller hasn't moved for a while. Press A, Enter or I'm here to carry on."],
  lost: ['Controller disconnected', 'Connect it again to carry on, or continue with the keyboard.'],
};
let away = null;                 // { reason, counting } while the overlay is up
function goAway(reason) {
  away = { reason, counting: false, key: presence.lastKey };
  game.paused = true;
  const [title, note] = AWAY[reason];
  $('awayTitle').textContent = title; $('awayNote').textContent = note;
  $('awayBtn').textContent = reason === 'phone' ? 'Waiting for the phone…' : reason === 'lost' ? 'Continue' : "I'm here";
  $('awayBtn').disabled = reason === 'phone';
  Screens.show('away', reason === 'phone' ? 'awayMenuBtn' : 'awayBtn');
}
// back: a 3-2-1 count on the overlay, then the race runs (so the car doesn't jerk on the first input)
function backFromAway() {
  if (!away || away.counting) return;
  away.counting = true; $('awayBtn').disabled = true;
  let n = 3;
  const tick = () => {
    if (!away) return;                                  // went to the pause menu meanwhile
    if (n === 0) { away = null; Screens.show(null); game.paused = false; presence.reset(); return; }
    $('awayTitle').textContent = String(n); $('awayNote').textContent = 'Get ready'; Sound.beep(...SFX.light);
    n--; setTimeout(tick, 700);
  };
  tick();
}
function watchPresence(dt) {
  if (away) {
    if (away.reason === 'phone' && !PhoneWheel.away) backFromAway();                 // tapped "I'm here" on the phone
    if (away.reason === 'lost' && Input.device && Input.device.key === away.key) backFromAway();   // it's back
    return;
  }
  const why = presence.update(dt, { racing: racing() && !game.autopilot, pad: Input.device, phoneAway: PhoneWheel.away });
  if (why) goAway(why);
}
$('awayBtn').onclick = () => backFromAway();
$('awayMenuBtn').onclick = () => { away = null; Screens.show('pause', 'resumeBtn'); };
// pause when the window loses focus or is hidden (pref pauseOnBlur)
const leave = () => { if (game.prefs.pauseOnBlur && racing()) togglePause(); };
addEventListener('blur', leave);
document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });

const escape = () => away ? (away = null, Screens.show('pause', 'resumeBtn')) : AppShell.quitOpen ? AppShell.cancelQuit() : Garage.open ? Garage.close() : InputMonitor.open ? InputMonitor.toggle(false) : SoundStudio.open ? SoundStudio.toggle(false) : SettingsScreen.open ? SettingsScreen.close()
  : LayoutEditor.active ? LayoutEditor.exit() : togglePause();
// "Quit the game?" (Alt+F4 mid-race too): the race pauses behind it
AppShell.onAskQuit(() => { if (isRunning() && !game.paused) togglePause(); });
function setPref(key, value) {
  game.prefs[key] = value; savePrefs(); applyPrefs();
  if (key === 'smoothing') game.steerRate = steerRate(game.prefs);
  describeSetup();
}
function toggleMute() { setPref('muted', !game.prefs.muted); }

// ---- settings screen (settings-binding.js) ----
function setDriving(key, value) {
  if (key.startsWith('a.')) game.setup.custom[key.slice(2)] = value; else game.setup[key] = value;
  renderSetup(); saveSetup();
  if (game.player) {                         // takes effect at once, also mid-race
    if (key === 'gearbox') setGearbox(game.player, value);
    if (key === 'assists' || key.startsWith('a.')) game.player.assists = assistsOf(game.setup);
    if (key === 'overtake') game.player.boostAuto = value === 'auto';
  }
}
const settings = bindSettings(game, { setGfx, setPref, setDriving, togglePause, toggleLayout });
const openSettings = tab => settings.open(tab);
// The start menu's line about the Settings-screen choices.
const describeSetup = () => {
  const g = game.garage, custom = Object.entries(g.setup).some(([k, v]) => v !== SIM.SETUP[k].def);
  Screens.summary(setupSummary(game.setup, game.prefs, game.gfx) + (g.mods && SIM.isModified(g.mods) ? ' · car MODIFIED' : custom ? ' · custom car setup' : ''));
};
// the start menu's circuit line: your records here
// the start menu's intro line (a time trial is you alone)
const describeEvent = () => { const trial = game.setup.type === 'trial'; Screens.describeEvent(track, trial ? 1 : game.setup.cars, playerSlotOf(game.setup.cars, trial)); };
function describeRecord() {
  const r = game.records[track.id] || {}, parts = [];
  if (r.stock) parts.push('record ' + fmtTime(r.stock));
  if (r.modified) parts.push('modified ' + fmtTime(r.modified));
  Screens.trackInfo(track, SIM.CIRCUITS[track.id].blurb, parts.join(' · '));
  renderGhostRow();
}

// ---- garage (garage.js): looks go on your race car at once, setup and mods from the next race ----
const playerModel = () => modelOf.get(SIM.DRIVERS.find(d => d.player).code);
let garageSave = 0;
Garage.on('change', (g, what) => {
  clearTimeout(garageSave); garageSave = setTimeout(() => Settings.set(CONFIG.storageKeys.garage, JSON.stringify(g)), 300);
  if (what === 'look') playerModel().setLivery(g.livery);
  describeSetup();
});
Garage.on('close', () => { Settings.set(CONFIG.storageKeys.garage, JSON.stringify(game.garage)); Screens.show('start', 'startBtn'); });
Garage.on('designTools', () => TweakPanel.toggle());
function openGarage() { if (game.phase !== PHASE.MENU || Garage.open) return; Screens.show(null); Garage.show(game.garage, GFX_PROFILES[game.gfx]); }

const ACTIONS = { camera: cycleCamera, mute: toggleMute, pause: escape, fps: () => setPref('showFps', !game.prefs.showFps), graphics: toggleGfx, confirm,
  settings: () => settings.toggle(),
  tweak: () => TweakPanel.toggle(), layout: toggleLayout, fullscreen: () => AppShell.toggleFullscreen(),
  inputs: () => InputMonitor.toggle(),
  shiftUp: () => shift(+1), shiftDown: () => shift(-1), box: requestBox, boost: requestBoost,
  // phone buttons 1 / 2 (pad A / B): shift down / up while racing, confirm / resume in menus
  primary: () => racing() ? shift(-1) : confirm(),
  secondary: () => racing() ? shift(+1) : SettingsScreen.open ? SettingsScreen.close() : game.paused ? togglePause() : null };
Input.on('action', name => ACTIONS[name]?.());
// BOX (B, pad X, the HUD button): pit at the end of this lap, press again to stay out
function requestBox() {
  const p = game.player;
  if (!racing() || !p || p.pit || p.finished || !game.race.track.pit) return;
  p.pitRequest = !p.pitRequest;
  showMessage(p.pitRequest ? SAY.boxOn : SAY.boxOff);
}
$('boxBtn').onclick = requestBox;
// overtake mode (X, pad View, the HUD button) when set to BUTTON: on / off while it is available this lap
function requestBoost() {
  const p = game.player;
  if (!racing() || !p || p.finished || !game.race.overtake) return;
  if (p.boostAuto) { showMessage(SAY.boostAuto); return; }
  if (p.boostLeft > 0) game.pendingBoost = true; else showMessage(SAY.boostNone);
}
$('boostBtn').onclick = requestBoost;
Input.on('gesture', Sound.init);
Input.on('padchange', (on, label) => { Hud.setPad(on, Input.gamepadAllowed); if (on && game.phase !== PHASE.MENU) showMessage({ toast: `${label} connected` }); });

$('camBtn').onclick = cycleCamera;
$('muteBtn').onclick = () => { Sound.init(); toggleMute(); };
$('settingsBtn').onclick = $('pauseSettingsBtn').onclick = $('setBtn').onclick = () => openSettings();
$('pauseBtn').onclick = togglePause;
$('resumeBtn').onclick = togglePause;
$('restartBtn').onclick = () => newRace();
$('againBtn').onclick = () => newRace();
$('endBtn').onclick = endRace;
$('menuBtn').onclick = toMenu;
$('designBtn').onclick = () => TweakPanel.toggle();
$('testCtlBtn').onclick = $('pauseInputsBtn').onclick = () => InputMonitor.toggle(true);
$('fullBtn').onclick = $('fullStartBtn').onclick = () => AppShell.toggleFullscreen();

// ---- design tools ----
TweakPanel.on('camera', id => { CameraRig.select(id); onCameraChanged(); });
TweakPanel.on('freeze', on => { game.frozen = on; });
TweakPanel.on('layout', toggleLayout);
Design.on('change', section => {
  if (section === 'car' || section === 'all') game.carsDirty = true;      // rebuilt once per frame, however many edits
  if (section === 'hud' || section === 'all') HudStyle.apply(CameraRig.mode.id);
});
$('startBtn').onclick = startFromMenu;
$('garageBtn').onclick = openGarage;
function saveSetup() {
  setTrack(game.setup.track);
  Settings.set(CONFIG.storageKeys.race, JSON.stringify(game.setup));
  describeEvent();
  describeSetup();
  renderGhostRow();                // (the time trial's ghost list: the type, circuit or active aero changed)
}
const renderSetup = Screens.bindSetup(game.setup, SIM.DRIVERS.length, Object.values(SIM.CIRCUITS), saveSetup);

// ---- per-frame ----
// Gear and rev lights (0..1, all lit at the shift point) from the car's drivetrain.
// On the grid the gearbox is in neutral and the revs follow the throttle.
const V = SIM.VEHICLE, REV_FROM = CONFIG.revLights.from;
function dashGear(p, onLights, thr) {
  const rpm = onLights ? V.idle + thr * (V.redline - V.idle) * (0.9 + Math.random() * 0.06) : p.rpm;
  return { gear: onLights ? 'N' : p.gear === -1 ? 'R' : String(p.gear), next: !onLights && p.downQueue > 0 ? p.gear - p.downQueue : null,
    revs: SIM.clamp((rpm - REV_FROM) / (V.autoUp - REV_FROM), 0, 1) };
}
function renderFrame(dt) {
  const { race, player } = game, cam = CameraRig.mode;
  crews.update(race, dt, Display.camera.position);
  if (isRunning()) marks.update(race, Design.data.car);
  for (const c of race.cars) modelOf.get(c.code).setService(crews.serviceOf(c));
  CameraRig.setShot(game.prefs.pitCam ? pitShot(race, player) : null);
  CameraRig.setLook(isRunning() ? Input.look : { back: false, side: 0 });
  const cockpit = !!cam.cockpitBody && !CameraRig.onShot && !CameraRig.lookingBack;   // the pit camera / rear view show the car from outside
  modelOf.get(player.code).useCockpitView(cockpit);
  modelOf.get(player.code).setPedals(player.finished ? 0 : Input.drive.thr, player.finished ? 0 : Input.drive.brk);
  for (const c of race.cars) modelOf.get(c.code).sync(c, poseOf(c), dt);
  CameraRig.update(dt, player, !isRunning());
  const lapT = race.t - player.lapStart;
  if (game.rival) {
    // an AI ghost: a live car of its own race (wheels, steering, brake lights, wings: the real car), the live gap
    const rc = game.rival.car;
    ghostModel.setVisible(!player.finished); ghostModel.sync(rc, poseOf(rc), dt);
    if (game.phase === PHASE.RACE) { Hud.setDelta(rivalGap(player, race.t, game.rival), true); ghostInputs.update(rc, player, dt); }
  } else {
    // a recorded ghost lap (yours or a file's) at the same time into its lap as you are into yours, and the live delta;
    // your lap 1 (from the grid) against its standing-start lap, later laps against its flying lap
    const g = player.lap <= 1 ? game.ghostStart : game.ghost, gp = g && game.phase === PHASE.RACE && !player.finished ? ghostPose(g, lapT) : null;
    ghostModel.setVisible(!!gp);
    if (gp) ghostModel.sync({ roll: lapT * 60, steer: 0, brake: 0, aeroOpen: 0 }, gp, dt);
    // (the delta from the first crossing of the line on: from the grid, behind the line, the split would be the lap's last)
    if (game.trial) Hud.setDelta(gp && player.lap >= 1 ? ghostDelta(g, player.idx, lapT) : null, true);
  }
  const eye = Design.data.cameras.find(c => c.id === 'cockpit') || cam;
  mirrors.update([-eye.back, eye.height, eye.side || 0], cockpit ? 'cockpit' : 'outside', Display.camera.position);
  Display.render();
  hudMirror.render(player.finished ? null : player);

  const drive = Input.drive, onLights = game.phase === PHASE.LIGHTS;
  const gi = dashGear(player, onLights, drive.thr);
  Hud.updateDash({
    kmh: Math.round(SIM.speedOf(player) * 3.6), gear: gi.gear, gearNext: gi.next, revs: gi.revs, slip: onLights ? 0 : player.slip,
    steer: player.finished ? 0 : player.steer, steerIn: player.finished ? 0 : player.steerIn, thr: drive.thr, brk: drive.brk,
    lapTime: onLights ? '0:00.000' : fmtTime(player.finished ? player.finishTime : race.t - player.lapStart),
    lapInvalid: !onLights && !player.finished && player.lapInvalid, dirt: onLights ? 0 : player.dirt,
  });
  Hud.updateCar(race, player);
  WheelScreen.update(dt, { gear: gi.gear, kmh: Math.round(SIM.speedOf(player) * 3.6), revs: gi.revs });
  raceAudio.frame(dt, { race, player, cam, running: isRunning(), onLights, thr: player.finished ? 0 : player.pit ? player.thr : drive.thr, brk: player.finished ? 0 : drive.brk, prefs: game.prefs });
  if (onLights) wakes.hideAll(); else wakes.update(race, player, dt);
  if ((game.towerT -= dt) <= 0) {
    game.towerT = CONFIG.towerInterval;
    Hud.updateTower(race, player, !onLights);
    if (game.resultsShown) Hud.renderResults(race, player);
  }
  if ((game.mapT -= dt) <= 0) { game.mapT = CONFIG.mapInterval; minimap.draw(race.cars); }
  Hud.tick(dt);
}

// The pit stop camera (Settings → Graphics): from the last metres into the box until just after leaving it, a TV
// shot from above the fast lane, at the front quarter of the box, so you watch the crew work; it drifts slowly while they do.
function pitShot(race, c) {
  const P = c.pit; if (!P || c.finished) return null;
  const ds = race.track.ds, f = crews.boxOf(c);
  const on = P.phase === 'stop' || (P.phase === 'in' && (P.box - P.p) * ds < 22) || (P.phase === 'out' && (P.p - P.box) * ds < 9);
  if (!on || !f) return null;
  const t = P.phase === 'stop' ? race.t - P.at : 0, cx = Math.cos(f.h), cz = Math.sin(f.h);
  const at = (x, y, z) => [f.x + cx * x - cz * z, y, f.z + cz * x + cx * z];       // box frame → world (z = right)
  return { pos: at(6.4 - Math.min(2.5, t * 0.22), 3.6, -6.4 + Math.min(1, t * 0.08)), look: at(0.2, 0.35, 0.5), fov: 44 };
}

function monitorFps(dt) {
  const fps = fpsMonitor.sample(dt);
  if (fps === null) return;
  Hud.setFps(fps, 'Render scale ' + Math.round(Display.scale * 100) + '%' + (Display.gpu.short ? ' · ' + Display.gpu.short : ''));
  // adaptive resolution: drop a step after consecutive slow windows, only while actually racing
  if (isRunning() && fps < CONFIG.fps.adaptBelow) {
    if (++game.slowWindows >= CONFIG.fps.slowWindowsToAdapt && Display.stepDown()) game.slowWindows = 0;
  } else game.slowWindows = 0;
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(CONFIG.maxFrameDt, (now - last) / 1000), STEP = CONFIG.physicsStep;
  last = now;
  Input.poll();
  watchPresence(dt);
  InputMonitor.sample(dt, Input.drive, Input.pad);
  SettingsScreen.tick(Input.pad, Input.shapeSteer(Input.pad.steerRaw));
  if (game.carsDirty) { game.carsDirty = false; for (const m of carModels) m.rebuild(Design.data.car); ghostModel.rebuild(Design.data.car); mirrors.build(playerModel0.object, Design.data.car.parts); }
  const running = isRunning();
  if (running) { game.acc += dt; while (game.acc >= STEP) { simStep(STEP); game.acc -= STEP; } }
  else game.acc = 0;
  if (Garage.open) Garage.frame(dt);
  else if (game.race) {
    interpolatePoses(game.race.cars, running ? game.acc / STEP : 1);
    if (game.rival) interpolatePoses(game.rival.race.cars, running ? game.acc / STEP : 1);
    renderFrame(dt);
  }
  else Display.render();
  { const p = game.player, m = haptics.frame(running && game.phase === PHASE.RACE && p && !p.finished ? p : null, dt); if (m) PhoneWheel.feedback(m.fx); }
  monitorFps(dt);
}

// ---- circuit: world, minimap and the idle scene behind the menu (cars parked on the grid) ----
function setTrack(id) {
  if (track && track.id === id) return track;
  track = trackOf(id);
  if (game.race) { game.race = null; game.player = null; game.rival = null; wakes.hideAll(); crews.dispose(); marks.clear(); racingLine.set(track, null); ghostInputs.show(false); }    // the last race was on the old circuit
  drawOutline($('trackPreview'), track); describeRecord();
  world?.dispose();
  world = buildWorld(Display.scene, track, SIM.DRIVERS);
  if (game.gfx) world.applyProfile(GFX_PROFILES[game.gfx]);
  minimap = createMinimap($('map'), track);
  { const g = track.landmarks.grandstand ?? 0, lat = -(track.runoff[0].wall[g] + 10); Sound.setCrowd(track.PX[g] + track.NX[g] * lat, 6, track.PZ[g] + track.NZ[g] * lat); }
  const { PX, PZ, NX, NZ, TX, TZ, N } = track;
  Display.camera.position.set(PX[0] + NX[0]*30 - TX[0]*40, 14, PZ[0] + NZ[0]*30 - TZ[0]*40);
  Display.camera.lookAt(PX[N-40], 0, PZ[N-40]);
  SIM.createRace(1, { track }).cars.forEach((c, i) => { carModels[i].setVisible(true); carModels[i].place(c.x, c.z, c.h); });
  describeEvent();
  return track;
}

// ---- boot ----
installDebug(setTrack, () => track, () => game.player, () => { game.paused = false; toMenu(); }, loadGhostText, skill => { game.autopilot = skill; },
  () => racingLine.set(track, aiLapOf('alien', true)?.line), setPref);
setTrack(game.setup.track);
{ const saved = Settings.get(CONFIG.storageKeys.gfx);
  setGfx(Object.hasOwn(GFX_PROFILES, saved || '') ? saved : (Display.gpu.weak ? 'perf' : 'quality'), false); }
applyPrefs(); game.steerRate = steerRate(game.prefs);
playerModel().setLivery(game.garage.livery);
if (PhoneWheel.available && game.prefs.phoneAuto) PhoneWheel.start({ link: game.prefs.phoneLink });   // Settings → Controller
Hud.setPad(false, Input.gamepadAllowed);
HudStyle.apply(CameraRig.mode.id);
describeEvent();
describeSetup();
$('loading').hidden = true;
Screens.show('start', 'startBtn');
requestAnimationFrame(frame);

// offline cache for the installed app; only over http(s), and never fatal (e.g. inside a sandboxed frame)
try { if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
