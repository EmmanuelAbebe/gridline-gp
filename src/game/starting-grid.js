// Where you start (grid.js has the rules): the rivals' lap times at the race's level worked out in the background on
// the start menu (~0.1 s of sim per driver, one per tick), your best lap there (the lap record for your car class and
// zone layout), and the qualifying session: you alone on the circuit for `setup.quali` minutes, the rivals' laps coming
// in on the timing screen, your best lap setting your slot for the race that follows.
// ctx: { game, track() (the menu's circuit), onReady() (the times are in: redraw the menu line) }
import { RACE_SETUP, PHASE } from './config.js';
import { playerDriver } from './garage-store.js';
import { raceAero, aiAssistsOf } from './setup-store.js';
import { driverLap, driverLapReady } from './ai-ghosts.js';
import { zoneTag, lapClass } from './aero-zones.js';
import { rivalsOf, topSkill, gridOrder, qualiPlan, qualiStandings } from './grid.js';
import { SIM } from '../sim/index.js';

export function createStartingGrid({ game, track, onReady }) {
  const levelId = () => game.setup.ai, level = () => RACE_SETUP.aiLevels[game.setup.ai];
  // the conditions the times are made in: the race's active aero, the AI's assists, tyre temperatures, your tyres
  const optsOf = rivals => ({ activeAero: raceAero(game.setup).activeAero, aiAssists: aiAssistsOf(game.setup),
    tyreTemp: game.setup.tyreTemp === 'on', compound: game.garage.tyres.start, aiTop: topSkill(rivals) });
  const ready = (T, rivals) => rivals.every(d => driverLapReady(T, d, levelId(), optsOf(rivals)));
  const timesOf = (T, rivals) => Object.fromEntries(rivals.map(d => [d.code, driverLap(T, d, levelId(), level(), optsOf(rivals))]));
  // one missing driver per tick until they are all in (the setup may change meanwhile: each tick asks again)
  let pending = false;
  function work() {
    if (pending) return;
    pending = true;
    const tick = () => {
      const T = track(), rivals = rivalsOf(game.setup.cars), d = rivals.find(x => !driverLapReady(T, x, levelId(), optsOf(rivals)));
      if (d && game.phase === PHASE.MENU) { driverLap(T, d, levelId(), level(), optsOf(rivals)); setTimeout(tick, 0); return; }
      pending = false;
      if (!d) onReady();
      else setTimeout(work, 500);          // (not on the menu: later)
    };
    setTimeout(tick, 0);
  }
  // your best valid lap on this circuit in this car class on these zones (the lap record), or null
  function yourBest(T = track()) {
    const r = game.records[T.id], k = lapClass(SIM.isModified(game.garage.mods), zoneTag(T, raceAero(game.setup).activeAero));
    return r?.[k] ?? null;
  }

  return {
    yourBest,
    // the grid for a race from your best lap here: { order (drivers, pole first), slot, yourTime } — or null while the
    // rivals' times are still being made (sync: make them now; a race about to start)
    forRace({ sync = false } = {}) {
      const T = track(), rivals = rivalsOf(game.setup.cars), you = SIM.DRIVERS.find(d => d.player);
      if (!ready(T, rivals) && !sync) { work(); return null; }
      const yourTime = yourBest(T), order = gridOrder(rivals, timesOf(T, rivals), you, yourTime);
      return { order, slot: order.indexOf(you), yourTime };
    },
    // ---- qualifying ----
    // a session starting (newRace): the rivals' times (made now if they aren't yet) and when each shows up
    startQuali(race) {
      const T = race.track, rivals = rivalsOf(game.setup.cars), times = timesOf(T, rivals);
      game.quali = { rivals, times, plan: qualiPlan(rivals, times, race.duration, race.seed), best: null, done: false };
    },
    // your lap just ended in the session: the best valid one counts
    qualiLap(e) { const Q = game.quali; if (Q && !e.invalid && e.time > 0 && (Q.best === null || e.time < Q.best)) Q.best = e.time; },
    // the timing screen now (grid.js qualiStandings); at the end every rival's laps are in
    standings(race, final = false) {
      const Q = game.quali;
      return qualiStandings(Q.rivals, Q.plan, final ? Infinity : race.t, playerDriver(game.garage), Q.best);   // (you in your livery)
    },
    // the session is over: the race's grid from it (kept for "race again" until you go back to the menu)
    finishQuali() {
      const Q = game.quali, you = SIM.DRIVERS.find(d => d.player), order = gridOrder(Q.rivals, Q.times, you, Q.best);
      Q.done = true;
      game.qualiGrid = { order, slot: order.indexOf(you), yourTime: Q.best, circuit: track().id };
      return game.qualiGrid;
    },
    work,
  };
}
