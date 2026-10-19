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
import { Garage } from './garage.js';
import { loadGarage, loadRecords, recordLap, playerSpec, playerDriver } from './garage-store.js';

const { EV } = SIM;
// circuits are built on first use (~40 ms) and kept
const tracks = new Map([[SIM.track.id, SIM.track]]);
const trackOf = id => { if (!tracks.has(id)) tracks.set(id, SIM.buildTrack(SIM.CIRCUITS[id])); return tracks.get(id); };
let track = null, world = null, minimap = null;
const carModels = SIM.DRIVERS.map(d => CarModels.create(Display.scene, d, Design.data.car));
const modelOf = new Map(SIM.DRIVERS.map((d, i) => [d.code, carModels[i]]));   // car model by driver code
carModels[SIM.DRIVERS.findIndex(d => d.player)].mountScreen(WheelScreen.mesh);
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
  lights: { t: 0, lit: 0, hold: 0 }, resultsAt: -1, resultsShown: false, ended: false, finalLapShown: false, timeUpShown: false,
  towerT: 0, mapT: 0, slowWindows: 0, acc: 0, carsDirty: false,
  pendingShift: 0, autoShiftHinted: false, queueHinted: false, steerRate: Infinity,   // paddle press waiting for the next sim step
};
const isRunning = () => !!game.race && game.phase !== PHASE.MENU && !game.paused && !game.frozen;

// ---- race setup and prefs (setup-store.js: loading, validation, what they mean for a race) ----
const savePrefs = () => Settings.set(CONFIG.storageKeys.prefs, JSON.stringify(game.prefs));
// Push the prefs into the modules that use them.
function applyPrefs() {
  const p = game.prefs;
  Input.setConfig(p); Sound.setMuted(p.muted);
  Sound.setVolumes({ master: p.volume / 100, engine: p.engineVol / 100, fx: p.fxVol / 100, ambience: p.ambVol / 100 }); Hud.setMuted(p.muted); Hud.showFps(p.showFps);
}

// ---- graphics mode ----
function setGfx(id, announce) {
  const p = GFX_PROFILES[id], gpu = Display.gpu;
  game.gfx = id;
  Display.applyProfile(p); world?.applyProfile(p); CarModels.applyProfile(carModels, p);
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
  const s = game.setup, field = buildField(s.cars).map(d => d.player ? playerDriver(game.garage) : d);   // your livery in the tower, map, results
  const race = SIM.createRace(raceFormat(s), { track, drivers: field, aiPace: RACE_SETUP.aiLevels[s.ai].pace, wear: raceWear(s), ...raceAero(s) });
  for (const [code, m] of modelOf) m.setVisible(field.some(d => d.code === code));
  const L = CONFIG.lights;
  const player = race.cars.find(c => c.player);
  setGearbox(player, game.setup.gearbox);
  player.assists = assistsOf(game.setup);
  player.spec = playerSpec(game.garage);             // the garage's setup + open mods (the rivals race SIM.STOCK)
  player.boostAuto = s.overtake === 'auto';
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
  setStartLights(0); Hud.flash('GO', 0.8); Sound.beep(...SFX.go);
  timers.after(CONFIG.lights.hideAfterGo, () => Hud.showLights(false));
}

const showMessage = m => { if (!m) return; if (m.radio) Hud.radio(m.radio, m.secs); else Hud.toast(m.toast, m.kind, m.secs); };
// A player car's SIM event: its message (race-messages.js), plus what it does to the race flow, sound and camera.
function onPlayerEvent(c, e) {
  const race = game.race;
  showMessage(messageFor(e, c, race));
  switch (e.type) {
    case EV.LAP:
      Hud.setLapTimes(e.time, c.bestLap, e.invalid);
      if (!e.invalid && recordLap(game.records, race.track.id, c.spec.modified, e.time)) {
        Settings.set(CONFIG.storageKeys.records, JSON.stringify(game.records)); describeRecord();
        showMessage({ toast: `New lap record${c.spec.modified ? ' (modified car)' : ''}  ${fmtTime(e.time)}`, kind: 'purple' });
      }
      if (c.lap === race.laps && !c.finished) announceFinalLap();
      break;
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
  savePoses(race.cars);
  timers.tick(dt);
  if (game.phase === PHASE.LIGHTS) { stepStartLights(dt); return; }
  race.t += dt;
  for (const c of race.cars) {
    if (c.player && !c.finished) { SIM.drivePlayer(race, c, { ...Input.drive, steerRate: game.steerRate, calm: game.prefs.calm / 100, shift: game.pendingShift, boost: game.pendingBoost }, dt); game.pendingShift = 0; game.pendingBoost = false; }
    else SIM.driveAI(race, c, dt, c.finished ? CONFIG.finishedAiSkill : 0);
  }
  SIM.collide(race);
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
  if (SettingsScreen.open || InputMonitor.open) return;
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
const escape = () => Garage.open ? Garage.close() : InputMonitor.open ? InputMonitor.toggle(false) : SoundStudio.open ? SoundStudio.toggle(false) : SettingsScreen.open ? SettingsScreen.close()
  : LayoutEditor.active ? LayoutEditor.exit() : togglePause();
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
function describeRecord() {
  const r = game.records[track.id] || {}, parts = [];
  if (r.stock) parts.push('record ' + fmtTime(r.stock));
  if (r.modified) parts.push('modified ' + fmtTime(r.modified));
  Screens.trackInfo(track, SIM.CIRCUITS[track.id].blurb, parts.join(' · '));
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
  Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
  describeSetup();
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
  modelOf.get(player.code).useCockpitView(!!cam.cockpitBody);
  modelOf.get(player.code).setPedals(player.finished ? 0 : Input.drive.thr, player.finished ? 0 : Input.drive.brk);
  for (const c of race.cars) modelOf.get(c.code).sync(c, poseOf(c), dt);
  CameraRig.update(dt, player, !isRunning());
  Display.render();

  const drive = Input.drive, onLights = game.phase === PHASE.LIGHTS;
  const gi = dashGear(player, onLights, drive.thr);
  Hud.updateDash({
    kmh: Math.round(SIM.speedOf(player) * 3.6), gear: gi.gear, gearNext: gi.next, revs: gi.revs, slip: onLights ? 0 : player.slip,
    steer: player.finished ? 0 : player.steer, thr: drive.thr, brk: drive.brk,
    lapTime: onLights ? '0:00.000' : fmtTime(player.finished ? player.finishTime : race.t - player.lapStart),
    lapInvalid: !onLights && !player.finished && player.lapInvalid, dirt: onLights ? 0 : player.dirt,
  });
  Hud.updateCar(race, player);
  WheelScreen.update(dt, { gear: gi.gear, kmh: Math.round(SIM.speedOf(player) * 3.6), revs: gi.revs });
  raceAudio.frame(dt, { race, player, cam, running: isRunning(), onLights, thr: player.finished ? 0 : player.pit ? player.thr : drive.thr, brk: player.finished ? 0 : drive.brk, prefs: game.prefs });
  if (onLights) wakes.hideAll(); else wakes.update(race, player);
  if ((game.towerT -= dt) <= 0) {
    game.towerT = CONFIG.towerInterval;
    Hud.updateTower(race, player, !onLights);
    if (game.resultsShown) Hud.renderResults(race, player);
  }
  if ((game.mapT -= dt) <= 0) { game.mapT = CONFIG.mapInterval; minimap.draw(race.cars); }
  Hud.tick(dt);
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
  InputMonitor.sample(dt, Input.drive, Input.pad);
  SettingsScreen.tick(Input.pad, Input.shapeSteer(Input.pad.steerRaw));
  if (game.carsDirty) { game.carsDirty = false; for (const m of carModels) m.rebuild(Design.data.car); }
  const running = isRunning();
  if (running) { game.acc += dt; while (game.acc >= STEP) { simStep(STEP); game.acc -= STEP; } }
  else game.acc = 0;
  if (Garage.open) Garage.frame(dt);
  else if (game.race) { interpolatePoses(game.race.cars, running ? game.acc / STEP : 1); renderFrame(dt); }
  else Display.render();
  monitorFps(dt);
}

// ---- circuit: world, minimap and the idle scene behind the menu (cars parked on the grid) ----
function setTrack(id) {
  if (track && track.id === id) return track;
  track = trackOf(id);
  if (game.race) { game.race = null; game.player = null; wakes.hideAll(); }    // the last race was on the old circuit
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
  Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
  return track;
}

// ---- boot ----
installDebug(setTrack, () => track, () => game.player);
setTrack(game.setup.track);
{ const saved = Settings.get(CONFIG.storageKeys.gfx);
  setGfx(Object.hasOwn(GFX_PROFILES, saved || '') ? saved : (Display.gpu.weak ? 'perf' : 'quality'), false); }
applyPrefs(); game.steerRate = steerRate(game.prefs);
playerModel().setLivery(game.garage.livery);
if (PhoneWheel.available && game.prefs.phoneAuto) PhoneWheel.start({ link: game.prefs.phoneLink });   // Settings → Controller
Hud.setPad(false, Input.gamepadAllowed);
HudStyle.apply(CameraRig.mode.id);
Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
describeSetup();
$('loading').hidden = true;
Screens.show('start', 'startBtn');
requestAnimationFrame(frame);

// offline cache for the installed app; only over http(s), and never fatal (e.g. inside a sandboxed frame)
try { if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
