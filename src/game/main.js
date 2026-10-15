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
import { CONFIG, SFX, GFX_PROFILES, RACE_SETUP, PREFS, PHASE } from './config.js';
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
import { createSlipstreamFx } from './slipstream-fx.js';

const { EV } = SIM;
// circuits are built on first use (~40 ms) and kept
const tracks = new Map([[SIM.track.id, SIM.track]]);
const trackOf = id => { if (!tracks.has(id)) tracks.set(id, SIM.buildTrack(SIM.CIRCUITS[id])); return tracks.get(id); };
let track = null, world = null, minimap = null;
const carModels = SIM.DRIVERS.map(d => CarModels.create(Display.scene, d, Design.data.car));
const modelOf = new Map(SIM.DRIVERS.map((d, i) => [d.code, carModels[i]]));   // car model by driver code
carModels[SIM.DRIVERS.findIndex(d => d.player)].mountScreen(WheelScreen.mesh);
const wakes = createSlipstreamFx(Display.scene, SIM.DRIVERS);
const timers = createTimers();
const fpsMonitor = createFpsMonitor(CONFIG.fps.window);

const game = {
  phase: PHASE.MENU, paused: false, frozen: false, race: null, player: null, gfx: null,
  setup: loadSetup(),            // start-screen choices: cars, race type, laps / minutes (+ gearbox, assists from Settings)
  prefs: loadPrefs(),            // Settings screen: controller, sound, FPS counter
  lights: { t: 0, lit: 0, hold: 0 }, resultsAt: -1, resultsShown: false, ended: false, finalLapShown: false, timeUpShown: false,
  towerT: 0, mapT: 0, slowWindows: 0, acc: 0, carsDirty: false,
  pendingShift: 0, autoShiftHinted: false, queueHinted: false, steerRate: Infinity,   // paddle press waiting for the next sim step
};
const isRunning = () => !!game.race && game.phase !== PHASE.MENU && !game.paused && !game.frozen;

// ---- race setup ----
function loadSetup() {
  let saved = null; try { saved = JSON.parse(Settings.get(CONFIG.storageKeys.race)); } catch (e) {}
  const d = RACE_SETUP.defaults, s = saved && typeof saved === 'object' ? saved : {};
  return {
    cars: Math.min(SIM.DRIVERS.length, Math.max(1, Math.round(+s.cars) || d.cars)),
    type: ['laps', 'timed', 'unlimited'].includes(s.type) ? s.type : d.type,
    laps: Math.min(RACE_SETUP.maxLaps, Math.max(1, Math.round(+s.laps) || d.laps)),
    minutes: RACE_SETUP.minutes.includes(+s.minutes) ? +s.minutes : d.minutes,
    gearbox: ['auto', 'semi', 'manual'].includes(s.gearbox) ? s.gearbox : d.gearbox,
    assists: Object.hasOwn(SIM.ASSISTS, s.assists || '') || s.assists === 'custom' ? s.assists : d.assists,
    custom: Object.fromEntries(Object.entries(RACE_SETUP.customDefault).map(([k, v]) =>
      [k, Object.hasOwn(RACE_SETUP.customLevels, s.custom?.[k] || '') ? s.custom[k] : v])),
    ai: Object.hasOwn(RACE_SETUP.aiLevels, s.ai || '') ? s.ai : d.ai,
    track: Object.hasOwn(SIM.CIRCUITS, s.track || '') ? s.track : SIM.track.id,
  };
}
function loadPrefs() {
  let saved = null; try { saved = JSON.parse(Settings.get(CONFIG.storageKeys.prefs)); } catch (e) {}
  const s = saved && typeof saved === 'object' ? saved : {}, out = {};
  for (const [k, d] of Object.entries(PREFS.defaults)) {
    const lim = PREFS.limits[k];
    out[k] = typeof d === 'boolean' ? (typeof s[k] === 'boolean' ? s[k] : d)
      : Number.isFinite(+s[k]) && s[k] !== null && s[k] !== '' ? Math.min(lim[1], Math.max(lim[0], +s[k])) : d;
  }
  return out;
}
const savePrefs = () => Settings.set(CONFIG.storageKeys.prefs, JSON.stringify(game.prefs));
// Push the prefs into the modules that use them.
function applyPrefs() {
  const p = game.prefs;
  Input.setConfig(p); Sound.setVolume(p.volume / 100); Sound.setMuted(p.muted); Hud.setMuted(p.muted); Hud.showFps(p.showFps);
}
// controller steering smoothing level → how fast the car's steering may follow (SIM drivePlayer steerRate)
const steerRate = () => game.prefs.smoothing ? PREFS.smoothingRate / game.prefs.smoothing : Infinity;
const raceFormat = s => s.type === 'timed' ? { type: 'timed', minutes: s.minutes } : s.type === 'unlimited' ? { type: 'unlimited' } : { type: 'laps', laps: s.laps };
// The grid: the fastest `cars - 1` rivals in skill order, with you about three-quarters of the way back.
function buildField(cars) {
  const you = SIM.DRIVERS.find(d => d.player), rivals = SIM.DRIVERS.filter(d => !d.player).slice(0, cars - 1);
  rivals.splice(Math.round((cars - 1) * 0.78), 0, you);
  return rivals;
}
const playerSlotOf = cars => buildField(cars).findIndex(d => d.player);

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

// ---- render interpolation: sim state (x, z, h) → render state (rx, rz, rh) ----
function savePrev(race) { for (const c of race.cars) { c.px = c.x; c.pz = c.z; c.ph = c.h; } }
function interpolate(race, a) {
  for (const c of race.cars) {
    if (c.px === undefined) { c.px = c.x; c.pz = c.z; c.ph = c.h; }
    c.rx = c.px + (c.x - c.px) * a; c.rz = c.pz + (c.z - c.pz) * a; c.rh = c.ph + SIM.wrapA(c.h - c.ph) * a;
  }
}
function snapCamera() { interpolate(game.race, 1); CameraRig.snap(game.player); }

// ---- race flow: menu → lights → race → done (results) ----
function setStartLights(n) { Hud.setStartLamps(n); world.setStartLights(n); }

function newRace() {
  timers.clear();
  const field = buildField(game.setup.cars);
  const race = SIM.createRace(raceFormat(game.setup), { track, drivers: field, aiPace: RACE_SETUP.aiLevels[game.setup.ai].pace });
  for (const [code, m] of modelOf) m.setVisible(field.some(d => d.code === code));
  const L = CONFIG.lights;
  const player = race.cars.find(c => c.player);
  setGearbox(player, game.setup.gearbox);
  player.assists = assistsOf(game.setup);
  Object.assign(game, { race, player, phase: PHASE.LIGHTS, paused: false, pendingShift: 0, autoShiftHinted: false, queueHinted: false,
    resultsAt: -1, resultsShown: false, ended: false, finalLapShown: false, timeUpShown: false,
    lights: { t: 0, lit: 0, hold: L.holdMin + Math.random() * L.holdRand } });
  setStartLights(0); Hud.showLights(true); Hud.setLapTimes(0, 0);
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

function onPlayerEvent(c, e) {
  const race = game.race;
  switch (e) {
    case EV.LAP:
      Hud.setLapTimes(c.lastLap, c.bestLap, c.lastLapInvalid);
      if (c.lastLapInvalid) Hud.toast('Lap ' + (c.lap - 1) + '  ' + fmtTime(c.lastLap) + '  invalid', 'warn');
      else if (race.fastestBy === c && c.events.includes(EV.FASTEST)) Hud.toast('Fastest lap  ' + fmtTime(c.lastLap), 'purple');
      else Hud.toast('Lap ' + (c.lap - 1) + '  ' + fmtTime(c.lastLap));
      if (c.lap === race.laps && !c.finished) announceFinalLap();
      break;
    // track limits: a cut invalidates the lap; past the warnings each cut is a time penalty (SIM.LIMITS)
    case EV.CUT:
      if (c.cuts <= SIM.LIMITS.warnings) Hud.toast(`Track limits  warning ${c.cuts}/${SIM.LIMITS.warnings}  ·  lap invalid`, 'warn', 3);
      Sound.beep(...SFX.cut);
      break;
    case EV.SHIFT_DENIED:     // manual: a downshift waiting for the revs to drop (shown in the gear label)
      if (!game.queueHinted) { game.queueHinted = true; Hud.toast('Too fast for that gear: the downshift goes in as you slow down'); }
      break;
    case EV.PENALTY:
      Hud.toast(`+${SIM.LIMITS.penalty} s penalty  ·  track limits  (total +${c.penalty} s)`, 'warn', 3.5);
      break;
    case EV.FINISH:
      Hud.flash('CHEQUERED FLAG', 2); game.phase = PHASE.DONE; game.resultsAt = race.t + CONFIG.resultsDelay;
      break;
    case EV.WALL:
    case EV.CONTACT: {
      const sfx = e === EV.WALL ? SFX.wall : SFX.contact;
      if (c.impact >= sfx.min) Sound.impact(Math.min(1, c.impact / sfx.fullAt), sfx);
      break;
    }
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
  if (race.t >= race.duration && !game.timeUpShown) { game.timeUpShown = true; Hud.toast('Time up: the leader\'s next lap is the last'); }
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
  savePrev(race);
  timers.tick(dt);
  if (game.phase === PHASE.LIGHTS) { stepStartLights(dt); return; }
  race.t += dt;
  for (const c of race.cars) {
    if (c.player && !c.finished) { SIM.drivePlayer(race, c, { ...Input.drive, steerRate: game.steerRate, calm: game.prefs.calm / 100, shift: game.pendingShift }, dt); game.pendingShift = 0; }
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
  if (!game.autoShiftHinted) { game.autoShiftHinted = true; Hud.toast('Automatic gearbox: pick SEMI-AUTO or MANUAL in Settings (O) to shift yourself'); }
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
  else if ($('hud').hidden) Hud.toast('Start a race to arrange the HUD');
  else LayoutEditor.enter(CameraRig.mode);
}
const escape = () => InputMonitor.open ? InputMonitor.toggle(false) : SettingsScreen.open ? SettingsScreen.close()
  : LayoutEditor.active ? LayoutEditor.exit() : togglePause();
function setPref(key, value) {
  game.prefs[key] = value; savePrefs(); applyPrefs();
  if (key === 'smoothing') game.steerRate = steerRate();
  describeSetup();
}
function toggleMute() { setPref('muted', !game.prefs.muted); }

// ---- settings screen ----
// Opened over the start menu or the pause menu (a running race pauses first); closing goes back to that menu.
let settingsBack = null;
function openSettings(tab) {
  if (SettingsScreen.open) return;
  if (game.race && game.phase !== PHASE.MENU && !game.resultsShown && !game.paused) togglePause();
  settingsBack = Screens.current();
  Screens.show(null); SettingsScreen.show(tab);
}
SettingsScreen.on('close', () => { if (settingsBack) Screens.show(settingsBack); settingsBack = null; });
// The player's assists: a preset, or CUSTOM = each assist off / low / on (on = the medium preset's strength).
function assistsOf(s) {
  if (s.assists !== 'custom') return SIM.ASSISTS[s.assists];
  const M = SIM.ASSISTS.medium, L = RACE_SETUP.customLevels, c = s.custom;
  return { steer: M.steer * L[c.steer], stability: M.stability * L[c.stability], damping: 0, tc: M.tc * L[c.tc], abs: M.abs * L[c.abs] };
}
function setDriving(key, value) {
  if (key.startsWith('a.')) game.setup.custom[key.slice(2)] = value; else game.setup[key] = value;
  renderSetup(); saveSetup();
  if (game.player) {                         // takes effect at once, also mid-race
    if (key === 'gearbox') setGearbox(game.player, value);
    if (key === 'assists' || key.startsWith('a.')) game.player.assists = assistsOf(game.setup);
  }
}
SettingsScreen.bind({
  get(key) {
    return key === 'gearbox' || key === 'assists' ? game.setup[key] : key.startsWith('a.') ? game.setup.custom[key.slice(2)] : key === 'gfx' ? game.gfx
      : key === 'sound' ? !game.prefs.muted : game.prefs[key];
  },
  set(key, value) {
    if (key === 'gearbox' || key === 'assists' || key.startsWith('a.')) setDriving(key, value);
    else if (key === 'gfx') setGfx(value, true);
    else if (key === 'sound') { Sound.init(); setPref('muted', !value); }
    else setPref(key, value);
  },
  note: key => key === 'gfx' ? game.gfxNote : undefined,
  action(name) {
    if (name === 'resetController') {
      for (const k of ['smoothing', 'calm', 'deadZone', 'range', 'curve', 'pedalDeadZone']) game.prefs[k] = PREFS.defaults[k];
      setPref('smoothing', PREFS.defaults.smoothing); SettingsScreen.redraw();
    } else if (name === 'inputs') InputMonitor.toggle(true);
    else if (name === 'fullscreen') AppShell.toggleFullscreen();
    else if (name === 'tweak') { SettingsScreen.close(); TweakPanel.toggle(); }
    else if (name === 'layout') { SettingsScreen.close(); toggleLayout(); }
  },
});
// The start menu's line about the Settings-screen choices.
function describeSetup() {
  const s = game.setup, p = game.prefs, cap = w => w[0].toUpperCase() + w.slice(1);
  const tc = assistsOf(s).tc, tcText = tc >= 1 ? '' : tc > 0 ? ' (traction control low)' : ' (no traction control)';
  Screens.summary(`${s.gearbox === 'semi' ? 'Semi-auto' : cap(s.gearbox)} gearbox · ${cap(s.assists)} assists${tcText} · ${GFX_PROFILES[game.gfx]?.label.replace(' mode', '') ?? ''} graphics`
    + ` · controller smoothing ${p.smoothing ? p.smoothing : 'off'}`);
}

const ACTIONS = { camera: cycleCamera, mute: toggleMute, pause: escape, fps: () => setPref('showFps', !game.prefs.showFps), graphics: toggleGfx, confirm,
  settings: () => SettingsScreen.open ? SettingsScreen.close() : openSettings(),
  tweak: () => TweakPanel.toggle(), layout: toggleLayout, fullscreen: () => AppShell.toggleFullscreen(),
  inputs: () => InputMonitor.toggle(),
  shiftUp: () => shift(+1), shiftDown: () => shift(-1),
  // phone buttons 1 / 2 (pad A / B): shift down / up while racing, confirm / resume in menus
  primary: () => racing() ? shift(-1) : confirm(),
  secondary: () => racing() ? shift(+1) : SettingsScreen.open ? SettingsScreen.close() : game.paused ? togglePause() : null };
Input.on('action', name => ACTIONS[name]?.());
Input.on('gesture', Sound.init);
Input.on('padchange', on => { Hud.setPad(on, Input.gamepadAllowed); if (on && game.phase !== PHASE.MENU) Hud.toast('Wheel connected'); });

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
function saveSetup() {
  setTrack(game.setup.track);
  Settings.set(CONFIG.storageKeys.race, JSON.stringify(game.setup));
  Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
  describeSetup();
}
const renderSetup = Screens.bindSetup(game.setup, SIM.DRIVERS.length, Object.values(SIM.CIRCUITS), saveSetup);

// ---- per-frame ----
// Gear, rev lights (0..1, all lit at the shift point) and engine pitch (0..1, idle..limiter) from the car's drivetrain.
// On the grid the gearbox is in neutral and the revs follow the throttle.
const V = SIM.VEHICLE, REV_FROM = CONFIG.revLights.from;
function dashGear(p, onLights, thr) {
  const rpm = onLights ? V.idle + thr * (V.redline - V.idle) * (0.9 + Math.random() * 0.06) : p.rpm;
  return { gear: onLights ? 'N' : p.gear === -1 ? 'R' : String(p.gear), next: !onLights && p.downQueue > 0 ? p.gear - p.downQueue : null,
    revs: SIM.clamp((rpm - REV_FROM) / (V.autoUp - REV_FROM), 0, 1), pitch: SIM.clamp((rpm - V.idle) / (V.limiter - V.idle), 0, 1) };
}
function renderFrame(dt) {
  const { race, player } = game, cam = CameraRig.mode;
  modelOf.get(player.code).useCockpitView(!!cam.cockpitBody);
  modelOf.get(player.code).setPedals(player.finished ? 0 : Input.drive.thr, player.finished ? 0 : Input.drive.brk);
  for (const c of race.cars) modelOf.get(c.code).sync(c, dt);
  CameraRig.update(dt, player, !isRunning());
  Display.render();

  const drive = Input.drive, onLights = game.phase === PHASE.LIGHTS;
  const gi = dashGear(player, onLights, drive.thr);
  Hud.updateDash({
    kmh: Math.round(Math.abs(player.v) * 3.6), gear: gi.gear, gearNext: gi.next, revs: gi.revs, slip: onLights ? 0 : player.slip,
    steer: player.finished ? 0 : player.steer, thr: drive.thr, brk: drive.brk,
    lapTime: onLights ? '0:00.000' : fmtTime(player.finished ? player.finishTime : race.t - player.lapStart),
    lapInvalid: !onLights && !player.finished && player.lapInvalid,
  });
  WheelScreen.update(dt, { gear: gi.gear, kmh: Math.round(Math.abs(player.v) * 3.6), revs: gi.revs });
  Sound.engine(gi.pitch, player.finished ? 0 : drive.thr, isRunning());
  Sound.tyres(onLights ? 0 : Math.max(player.slideF, player.slideR, player.lockF || player.spinR ? 1 : 0) * Math.min(1, Math.abs(player.v) / 15), isRunning());
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
  if (game.race) { interpolate(game.race, running ? game.acc / STEP : 1); renderFrame(dt); }
  else Display.render();
  monitorFps(dt);
}

// ---- circuit: world, minimap and the idle scene behind the menu (cars parked on the grid) ----
function setTrack(id) {
  if (track && track.id === id) return;
  track = trackOf(id);
  if (game.race) { game.race = null; game.player = null; wakes.hideAll(); }    // the last race was on the old circuit
  drawOutline($('trackPreview'), track); Screens.trackInfo(track, SIM.CIRCUITS[id].blurb);
  world?.dispose();
  world = buildWorld(Display.scene, track, SIM.DRIVERS);
  if (game.gfx) world.applyProfile(GFX_PROFILES[game.gfx]);
  minimap = createMinimap($('map'), track);
  const { PX, PZ, NX, NZ, TX, TZ, N } = track;
  Display.camera.position.set(PX[0] + NX[0]*30 - TX[0]*40, 14, PZ[0] + NZ[0]*30 - TZ[0]*40);
  Display.camera.lookAt(PX[N-40], 0, PZ[N-40]);
  SIM.createRace(1, { track }).cars.forEach((c, i) => { carModels[i].setVisible(true); carModels[i].place(c.x, c.z, c.h); });
  Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
}

// ---- boot ----
setTrack(game.setup.track);
{ const saved = Settings.get(CONFIG.storageKeys.gfx);
  setGfx(Object.hasOwn(GFX_PROFILES, saved || '') ? saved : (Display.gpu.weak ? 'perf' : 'quality'), false); }
applyPrefs(); game.steerRate = steerRate();
Hud.setPad(false, Input.gamepadAllowed);
HudStyle.apply(CameraRig.mode.id);
Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
describeSetup();
$('loading').hidden = true;
Screens.show('start', 'startBtn');
requestAnimationFrame(frame);

// offline cache for the installed app; only over http(s), and never fatal (e.g. inside a sandboxed frame)
try { if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
