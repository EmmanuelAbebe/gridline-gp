// Time trial and ghosts (split out of main.js 2026-10-21): the start menu's ghost list (yours, a loaded file's, every
// AI level with its lap time), recording your laps (a new best becomes your ghost: standing-start and flying laps kept
// apart), EXPORT / LOAD, and in the race the see-through car: a recorded lap (ghost.js) or a live AI rival in a race of
// its own (ai-ghosts.js), with the live delta and the rival's input charts. The race state it sets stays on `game`
// (trial, ghost, ghostStart, rival, ghosts, loadedGhosts).
// ctx: { game, track() (the current circuit), saveSetup(), switchTrack(id) (the start menu's circuit), describe() }
import { SIM } from '../sim/index.js';
import { CONFIG, RACE_SETUP, PHASE } from './config.js';
import { $, fmtTime } from './util.js';
import { Settings } from './settings.js';
import { Design } from './design.js';
import { Display } from './display.js';
import { CarModels } from './car-models.js';
import { Hud } from './hud.js';
import { poseOf, savePoses, interpolatePoses } from './pose.js';
import { raceAero, aiAssistsOf } from './setup-store.js';
import { playerDriver } from './garage-store.js';
import { aiLap, aiLapReady, ghostDriver, createRival, rivalGap } from './ai-ghosts.js';
import { createGhostInputs } from './ghost-inputs.js';
import { zoneTag } from './aero-zones.js';
import { createRecorder, ghostPose, ghostDelta, keepGhost, ghostOf, dropGhost, readGhostFile, storeJson, packGhost, unpackGhost } from './ghost.js';

const LEVELS = RACE_SETUP.aiLevels;

export function createTimeTrial({ game, track, saveSetup, switchTrack }) {
  const recorder = createRecorder();
  const model = CarModels.create(Display.scene, playerDriver(game.garage), Design.data.car);   // the see-through car
  model.setMaterials(CarModels.ghostMaterials()); model.setShadows(false); model.setVisible(false);
  const inputs = createGhostInputs();             // the AI ghost's steering / gas / brake charts (pref ghostInputs)
  const saveGhosts = () => Settings.set(CONFIG.storageKeys.ghosts, storeJson(game.ghosts));
  const saveLoadedGhosts = () => Settings.set(CONFIG.storageKeys.ghostsLoaded, storeJson(game.loadedGhosts));
  const carModified = () => SIM.isModified(game.garage.mods);
  // the zone layout the menu's circuit would be raced on (laps on other zones are kept apart: aero-zones.js zoneTag)
  const zones = () => zoneTag(track(), raceAero(game.setup).activeAero);
  // AI laps (ai-ghosts.js): the fastest AI driver alone at each level, made once per circuit and active-aero setting
  const aiPick = () => Object.hasOwn(LEVELS, game.setup.ghost) ? game.setup.ghost : null;
  // (on your tyres: the garage's starting compound, and the temperatures as in your race)
  const tyreTemp = () => game.setup.tyreTemp === 'on', compound = () => game.garage.tyres.start;
  const aiLapsReady = aero => Object.keys(LEVELS).every(id => aiLapReady(track(), id, aero, aiAssistsOf(game.setup), tyreTemp(), compound()));
  const aiLapOf = (id, aero = raceAero(game.setup).activeAero) => aiLap(track(), id, LEVELS[id], aero, aiAssistsOf(game.setup), tyreTemp(), compound());
  // the recorded ghost to race on this circuit in this car class (game.setup.ghost): the one loaded from a file (else
  // your best), or your best; start = the standing-start lap (your lap 1 from the grid), else the flying lap. (An AI
  // pick races a live car instead: game.rival.) Only laps on the same straight-mode zones.
  function activeGhost(modified = carModified(), start = false, z = zones()) {
    const id = track().id;
    if (game.setup.ghost === 'loaded' && ghostOf(game.loadedGhosts, id, modified, false, z)) return ghostOf(game.loadedGhosts, id, modified, start, z);
    return ghostOf(game.ghosts, id, modified, start, z);
  }
  const showLivery = g => { if (g) model.setLivery({ ...game.garage.livery, ...(g.livery || {}) }); };
  const showInputs = () => inputs.show(!!game.rival && game.prefs.ghostInputs, game.rival ? `${game.rival.driver.code} · ${game.rival.levelId.toUpperCase()}` : '');

  // the list of ghosts on the start menu (time trial): yours, the loaded one, every AI level with its lap time and the
  // gap to your best. The AI laps take ~0.3 s to make the first time on a circuit: the list says so and fills in after.
  let aiPending = false;
  function renderRow() {
    if (game.setup.type !== 'trial') return;          // (the row is only shown for a time trial)
    const id0 = track().id, mod = carModified(), z = zones(), mine = ghostOf(game.ghosts, id0, mod, false, z), loaded = ghostOf(game.loadedGhosts, id0, mod, false, z);
    const aero = raceAero(game.setup).activeAero, ready = aiLapsReady(aero);
    if (!ready && !aiPending) { aiPending = true; setTimeout(() => { for (const id in LEVELS) aiLapOf(id, aero); aiPending = false; renderRow(); }, 30); }
    const ai = ready ? Object.fromEntries(Object.keys(LEVELS).map(id => [id, aiLapOf(id, aero)])) : {}, D = ghostDriver(), pick = game.setup.ghost;
    const mineStart = ghostOf(game.ghosts, id0, mod, true, z);
    const rows = [['mine', 'Your best', [mod ? 'modified car' : '', z ? 'your zones' : '', mineStart ? 'lap 1 from the grid ' + fmtTime(mineStart.time) : ''].filter(Boolean).join(' · '), mine,
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
    const id = track().id, mod = carModified(), z = zones(), g = ghostOf(game.ghosts, id, mod, false, z); if (!g) return;
    const a = document.createElement('a');   // (your standing-start lap goes with it, for your friend's lap 1)
    a.href = URL.createObjectURL(new Blob([await packGhost(g, ghostOf(game.ghosts, id, mod, true, z))], { type: 'application/gzip' }));
    a.download = `gridline-ghost-${id}-${fmtTime(g.time).replace(/[:.]/g, '-')}.json.gz`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('ghostLoad').onclick = () => $('ghostFile').click();
  $('ghostFile').onchange = e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) f.arrayBuffer().then(b => unpackGhost(new Uint8Array(b), SIM.CIRCUITS)).then(load);   // .json.gz, or an old .json
  };
  // a loaded ghost (LOAD button): kept as the loaded ghost for its circuit and class, and that circuit picked
  function load(g) {
    if (!g) { Hud.toast('That file is not a Gridline ghost lap'); return; }
    const { standing, ...lap } = g;
    dropGhost(game.loadedGhosts, g.circuit, g.modified, g.zones ?? '');   // one friend's laps at a time per class and layout
    for (const x of [lap, standing]) if (x) keepGhost(game.loadedGhosts, x);
    saveLoadedGhosts();
    if (g.circuit !== track().id) switchTrack(g.circuit);
    game.setup.ghost = 'loaded'; saveSetup();
    // (a lap on other straight-mode zones than yours there is kept, and raced once your zones match it)
    const other = (g.zones ?? '') !== zones() ? ((g.zones ?? '') ? ', driven on other straight-mode zones (AERO ZONES)' : ', driven on the automatic straight-mode zones') : '';
    Hud.toast(`Ghost loaded: ${fmtTime(g.time)} on ${SIM.CIRCUITS[g.circuit].name}${other}`, other ? 'warn' : undefined, other ? 6 : undefined);
  }
  $('ghostClear').onclick = () => { dropGhost(game.loadedGhosts, track().id, carModified(), zones()); saveLoadedGhosts(); renderRow(); };

  return {
    model, renderRow, aiLapOf,
    loadText: text => load(readGhostFile(text, SIM.CIRCUITS)),    // a ghost file's text (smoke test)
    applyPrefs: showInputs,
    // a new race (newRace): a time trial races an AI pick as a live rival in a race of its own (no contact), else a
    // recorded ghost lap; any race records your laps
    start(race, player) {
      const s = game.setup, trial = s.type === 'trial', pick = trial ? aiPick() : null;
      game.trial = trial; recorder.stop();
      game.rival = pick ? createRival(track(), pick, LEVELS[pick], { activeAero: race.activeAero, aiAssists: aiAssistsOf(game.setup), tyreTemp: !!race.tyreTemp, compound: compound() }) : null;
      const z = zoneTag(race.track, race.activeAero);
      game.ghost = trial && !pick ? activeGhost(player.spec.modified, false, z) : null;       // laps 2..
      game.ghostStart = trial && !pick ? activeGhost(player.spec.modified, true, z) : null;   // lap 1, from the grid
      Hud.setDelta(null, trial); model.setVisible(false);
      if (game.rival) { const d = game.rival.driver; model.setLivery({ ...game.garage.livery, color: d.color, accent: d.accent }); }
      else showLivery(game.ghostStart || game.ghost);
      showInputs();
    },
    lightsOut() { recorder.start(0); },                 // the first lap runs from lights out (lapStart 0)
    // every sim step while racing (after the player's car moved)
    step(dt, player, t) {
      if (!player.finished) recorder.sample(player, t); else recorder.stop();
    },
    // every sim step from lights out, before the cars move: the rival's own race runs in step with yours
    stepRival(dt) { if (game.rival) game.rival.step(dt); },
    savePoses() { if (game.rival) savePoses(game.rival.race.cars); },
    interpolate(alpha) { if (game.rival) interpolatePoses(game.rival.race.cars, alpha); },
    // your lap just ended (EV.LAP): keep it when it is your best valid one here in this car class (c.lap 2 = lap 1 just
    // done: from the grid at lights out, a standing start); in a time trial a new best is raced from then on
    onLap(race, c, e) {
      const z = zoneTag(race.track, race.activeAero);
      const g = recorder.lap(e.time, { circuit: race.track.id, modified: c.spec.modified, ...(z ? { zones: z } : {}), driver: 'You', date: Date.now(), start: c.lap === 2,
        livery: { color: game.garage.livery.color, accent: game.garage.livery.accent } });
      recorder.start(c.lapStart);
      if (!e.invalid && g && keepGhost(game.ghosts, g)) {
        saveGhosts();
        if (game.trial && !game.rival && activeGhost(c.spec.modified, g.start, z) === g) { game[g.start ? 'ghostStart' : 'ghost'] = g; showLivery(g); }
      }
    },
    // every frame: the see-through car and the live delta
    frame(race, player, dt) {
      const lapT = race.t - player.lapStart;
      if (game.rival) {
        // an AI ghost: a live car of its own race (wheels, steering, brake lights, wings: the real car), the live gap
        const rc = game.rival.car;
        model.setVisible(!player.finished); model.sync(rc, poseOf(rc), dt);
        if (game.phase === PHASE.RACE) { Hud.setDelta(rivalGap(player, race.t, game.rival), true); inputs.update(rc, player, dt); }
        return;
      }
      // a recorded ghost lap (yours or a file's) at the same time into its lap as you are into yours, and the live delta;
      // your lap 1 (from the grid) against its standing-start lap, later laps against its flying lap
      const g = player.lap <= 1 ? game.ghostStart : game.ghost, gp = g && game.phase === PHASE.RACE && !player.finished ? ghostPose(g, lapT) : null;
      model.setVisible(!!gp);
      if (gp) model.sync({ roll: lapT * 60, steer: 0, brake: 0, aeroOpen: 0 }, gp, dt);
      // (the delta from the first crossing of the line on: from the grid, behind the line, the split would be the lap's last)
      if (game.trial) Hud.setDelta(gp && player.lap >= 1 ? ghostDelta(g, player.idx, lapT) : null, true);
    },
    // the circuit changed: the last race (and its rival) is gone
    reset() { game.rival = null; inputs.show(false); },
  };
}
