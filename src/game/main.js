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
import { gearOf } from './gearbox.js';
import { buildWorld } from './world.js';
import { CarModels } from './car-models.js';
import { CameraRig } from './camera-rig.js';
import { createMinimap } from './minimap.js';
import { Hud } from './hud.js';
import { Screens } from './screens.js';
import { WheelScreen } from './wheel-screen.js';
import { HudStyle } from './hud-style.js';
import { LayoutEditor } from './layout-editor.js';
import { TweakPanel } from './tweak-panel.js';
import { AppShell } from './app-shell.js';

const { EV } = SIM;
const track = SIM.track;

const world = buildWorld(Display.scene, track, SIM.DRIVERS);
const carModels = SIM.DRIVERS.map(d => CarModels.create(Display.scene, d, Design.data.car));
const modelOf = new Map(SIM.DRIVERS.map((d, i) => [d.code, carModels[i]]));   // car model by driver code
carModels[SIM.DRIVERS.findIndex(d => d.player)].mountScreen(WheelScreen.mesh);
const minimap = createMinimap($('map'), track);
const timers = createTimers();
const fpsMonitor = createFpsMonitor(CONFIG.fps.window);

const game = {
  phase: PHASE.MENU, paused: false, frozen: false, race: null, player: null, gfx: null,
  setup: loadSetup(),            // start-screen choices: cars, race type, laps / minutes
  lights: { t: 0, lit: 0, hold: 0 }, resultsAt: -1, resultsShown: false, ended: false, finalLapShown: false, timeUpShown: false,
  towerT: 0, mapT: 0, slowWindows: 0, acc: 0, carsDirty: false,
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
  };
}
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
  Display.applyProfile(p); world.applyProfile(p); CarModels.applyProfile(carModels, p);
  Screens.showGfx(id, (gpu.short ? 'Graphics: ' + gpu.short + '. ' : '') + p.note(gpu.weak));
  if (announce) { Settings.set(CONFIG.storageKeys.gfx, id); Hud.toast(p.label); }
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
  const race = SIM.createRace(raceFormat(game.setup), { track, drivers: field });
  for (const [code, m] of modelOf) m.setVisible(field.some(d => d.code === code));
  const L = CONFIG.lights;
  Object.assign(game, { race, player: race.cars.find(c => c.player), phase: PHASE.LIGHTS, paused: false,
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
      Hud.setLapTimes(c.lastLap, c.bestLap);
      if (race.fastestBy === c && c.events.includes(EV.FASTEST)) Hud.toast('Fastest lap  ' + fmtTime(c.lastLap), 'purple');
      else Hud.toast('Lap ' + (c.lap - 1) + '  ' + fmtTime(c.lastLap));
      if (c.lap === race.laps && !c.finished) announceFinalLap();
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
    if (c.player && !c.finished) SIM.drivePlayer(race, c, Input.drive, dt);
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
function confirm() {                                   // pad A
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
const escape = () => LayoutEditor.active ? LayoutEditor.exit() : togglePause();
function toggleMute() { Hud.setMuted(Sound.toggleMute()); }

const ACTIONS = { camera: cycleCamera, mute: toggleMute, pause: escape, fps: Hud.toggleFps, graphics: toggleGfx, confirm,
  tweak: () => TweakPanel.toggle(), layout: toggleLayout, fullscreen: () => AppShell.toggleFullscreen() };
Input.on('action', name => ACTIONS[name]?.());
Input.on('gesture', Sound.init);
Input.on('padchange', on => { Hud.setPad(on, Input.gamepadAllowed); if (on && game.phase !== PHASE.MENU) Hud.toast('Wheel connected'); });

$('camBtn').onclick = cycleCamera;
$('muteBtn').onclick = () => { Sound.init(); toggleMute(); };
$('pauseBtn').onclick = togglePause;
$('resumeBtn').onclick = togglePause;
$('restartBtn').onclick = () => newRace();
$('againBtn').onclick = () => newRace();
$('endBtn').onclick = endRace;
$('menuBtn').onclick = toMenu;
$('designBtn').onclick = () => TweakPanel.toggle();
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
Screens.bindSetup(game.setup, SIM.DRIVERS.length, () => {
  Settings.set(CONFIG.storageKeys.race, JSON.stringify(game.setup));
  Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
});
Screens.onGfx(id => setGfx(id, true));

// ---- per-frame ----
function renderFrame(dt) {
  const { race, player } = game, cam = CameraRig.mode;
  for (const c of race.cars) modelOf.get(c.code).sync(c);
  modelOf.get(player.code).useCockpitView(!!cam.cockpitBody);
  CameraRig.update(dt, player, !isRunning());
  Display.render();

  const drive = Input.drive, onLights = game.phase === PHASE.LIGHTS;
  const gi = onLights ? { gear: 'N', rpm: 0.18 + drive.thr * (0.67 + Math.random()*0.1) } : gearOf(player.v);   // free revs on the grid
  Hud.updateDash({
    kmh: Math.round(Math.abs(player.v) * 3.6), gear: gi.gear, rpm: gi.rpm,
    steer: player.finished ? 0 : player.steer, thr: drive.thr, brk: drive.brk,
    lapTime: onLights ? '0:00.000' : fmtTime(player.finished ? player.finishTime : race.t - player.lapStart),
  });
  WheelScreen.update(dt, { gear: gi.gear, kmh: Math.round(Math.abs(player.v) * 3.6), rpm: gi.rpm });
  Sound.engine(gi.rpm, player.finished ? 0 : drive.thr, isRunning());
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
  if (game.carsDirty) { game.carsDirty = false; for (const m of carModels) m.rebuild(Design.data.car); }
  const running = isRunning();
  if (running) { game.acc += dt; while (game.acc >= STEP) { simStep(STEP); game.acc -= STEP; } }
  else game.acc = 0;
  if (game.race) { interpolate(game.race, running ? game.acc / STEP : 1); renderFrame(dt); }
  else Display.render();
  monitorFps(dt);
}

// ---- boot: idle scene behind the menu (cars parked on the grid) ----
{ const { PX, PZ, NX, NZ, TX, TZ, N } = track;
  Display.camera.position.set(PX[0] + NX[0]*30 - TX[0]*40, 14, PZ[0] + NZ[0]*30 - TZ[0]*40);
  Display.camera.lookAt(PX[N-40], 0, PZ[N-40]);
  SIM.createRace(1, { track }).cars.forEach((c, i) => carModels[i].place(c.x, c.z, c.h)); }
{ const saved = Settings.get(CONFIG.storageKeys.gfx);
  setGfx(Object.hasOwn(GFX_PROFILES, saved || '') ? saved : (Display.gpu.weak ? 'perf' : 'quality'), false); }
Hud.setPad(false, Input.gamepadAllowed);
HudStyle.apply(CameraRig.mode.id);
Screens.describeEvent(track, game.setup.cars, playerSlotOf(game.setup.cars));
$('loading').hidden = true;
Screens.show('start', 'startBtn');
requestAnimationFrame(frame);

// offline cache for the installed app; only over http(s), and never fatal (e.g. inside a sandboxed frame)
try { if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
