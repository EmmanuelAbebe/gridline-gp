// Live sector timing (2026-10-26): your laps recorded at every track sample (lap-analysis.js), the HUD's sector panel
// (each mini-sector and sector coloured as you complete it: purple = the best anyone has, green = your best, yellow =
// slower, with the gap to the reference lap), your best sectors / mini-sectors and best lap's trace saved per circuit
// and car class, and the session's laps for the analysis screen (analysis-screen.js).
// The reference = the fastest lap of: your best, the ALIEN's (on this race's active aero and the AI's assists), a lap
// loaded from a file (another player's). ctx: { game, aiLapOf(id, aero) }
import { SIM } from '../sim/index.js';
import { CONFIG } from './config.js';
import { Settings } from './settings.js';
import { Hud } from './hud.js';
import { ghostOf } from './ghost.js';
import { ghostDriver } from './ai-ghosts.js';
import { createTraceRecorder, traceFromAi, traceFromGhost, miniTimes, sectorTimes, countsMini, countsSector, colourOf, emptyBests,
  keepBests, referenceOf, bestsOf, putBests, loadSectorStore, storeSectorsJson, timeAt } from './lap-analysis.js';
import { zoneTag, lapClass } from './aero-zones.js';
import { playerClass } from './car-class.js';

export function createSectorTiming({ game, aiLapOf }) {
  const store = loadSectorStore(Settings.get(CONFIG.storageKeys.sectors));
  const save = () => Settings.set(CONFIG.storageKeys.sectors, storeSectorsJson(store));
  let S = null;              // this race: { track, L, cls, bests, candidates, ref, laps, session, rec, mini }

  // your all-time bests here (per car class and straight-mode zone layout: zones = zoneTag); the first time (or after a
  // layout change) from your saved ghost lap, if any (car: the car class's id)
  function bestsFor(track, L, modified, zones = '', car = playerClass().id) {
    const cls = lapClass(modified, zones, car);
    let b = bestsOf(store, track.id, cls, L);
    if (!b || !b.best) {                        // (no best lap's trace: none yet, or a damaged save, lap-analysis.js expandTrace)
      if (!b) { b = emptyBests(L); putBests(store, track.id, cls, b); }
      const g = ghostOf(game.ghosts, track.id, modified, false, zones, car), gs = ghostOf(game.ghosts, track.id, modified, true, zones, car);
      for (const x of [g, gs]) { const tr = x && traceFromGhost(x, track.N); if (tr) keepBests(b, L, tr); }
    }
    return b;
  }
  // your saved ghost lap that is this trace's lap (the same time), for where the car was (lap-replay.js); else null
  function myGhost(tr, id, modified, zones, car) {
    const g = tr && ghostOf(game.ghosts, id, modified, !!tr.start, zones, car);
    return g && Math.abs(g.time - tr.time) < 0.002 ? g : null;
  }
  // the laps to compare with: yours, the ALIEN's, a loaded one (another player's); ghost = the recorded ghost of that lap
  function candidatesFor(race, modified) {
    const id = race.track.id, alien = aiLapOf('alien', race.activeAero), zones = zoneTag(race.track, race.activeAero), car = race.carClass?.id ?? playerClass().id;
    const loaded = ghostOf(game.loadedGhosts, id, modified, false, zones, car);
    return [
      S.bests.best && { id: 'mine', name: 'Your best', trace: S.bests.best, ghost: myGhost(S.bests.best, id, modified, zones, car) },
      alien && { id: 'alien', name: `ALIEN · ${ghostDriver().code}`, trace: traceFromAi(alien), driver: ghostDriver() },
      loaded && { id: 'loaded', name: loaded.driver && loaded.driver !== 'You' ? loaded.driver : 'Loaded lap', trace: traceFromGhost(loaded, race.track.N), ghost: loaded },
    ].filter(Boolean);
  }
  const showRef = () => Hud.sectorRef(S.ref.ref ? `${S.ref.ref.name} ${S.ref.ref.trace.time.toFixed(3)}` : '');

  // one mini-sector (and the sector it ends) of the lap in progress done: colour and gap
  function complete(tr, m) {
    const { L, bests, ref, session } = S, t = miniTimes(tr, L)[m], counts = countsMini(tr, L, m);
    const mine = Math.min(bests.mini[m], session.mini[m]);
    Hud.sectorMini(m, !counts ? 'none' : game.player.lapInvalid ? 'invalid' : colourOf(t, mine, Math.min(mine, ref.mini[m])));
    const s = L.sectors.findIndex(x => x.minis[x.minis.length - 1] === m);
    if (s < 0) return;
    const st = sectorTimes(tr, L)[s], smine = Math.min(bests.sec[s], session.sec[s]), rt = ref.ref ? sectorTimes(ref.ref.trace, L)[s] : NaN;
    Hud.sectorTime(s, st, Number.isFinite(rt) && countsSector(tr, s) ? st - rt : null,
      !countsSector(tr, s) ? 'none' : game.player.lapInvalid ? 'invalid' : colourOf(st, smine, Math.min(smine, ref.sec[s])));
  }

  return {
    get data() { return S; },
    store, bestsFor, myGhost,
    // a new race: the layout, your bests, the reference; nothing recorded until lights out
    start(race, player) {
      const track = race.track, L = SIM.buildSectors(track), zones = zoneTag(track, race.activeAero), car = race.carClass.id, bests = bestsFor(track, L, player.spec.modified, zones, car);
      S = { track, L, cls: lapClass(player.spec.modified, zones, car), bests, laps: [], session: emptyBests(L), rec: createTraceRecorder(track.N), mini: 0, modified: player.spec.modified };
      S.candidates = candidatesFor(race, player.spec.modified); S.ref = referenceOf(L, S.candidates);
      Hud.sectorSetup(L); showRef();
    },
    lightsOut(player) { if (S) { S.rec.start(1, player, 0); S.mini = 0; } },
    // every sim step while racing (after the cars moved, before the events)
    step(player, race) {
      if (!S || !S.rec.on) return;
      if (player.finished) { S.rec.stop(); return; }
      S.rec.sample(player, race.t - player.lapStart);
      const tr = S.rec.current, M = S.L.minis;
      while (tr && S.mini < M.length && M[S.mini].to < S.L.N && Number.isFinite(tr.t[M[S.mini].to])) complete(tr, S.mini++);
    },
    // your lap just ended (EV.LAP): the last mini-sectors, the bests (saved), the next lap
    onLap(race, c, e) {
      if (!S) return;
      const tr = S.rec.finish(e.time, { invalid: !!e.invalid, lap: c.lap - 1 });
      if (tr && Number.isFinite(timeAt(tr, 1))) {
        while (S.mini < S.L.minis.length) complete(tr, S.mini++);
        S.laps.push(tr);
        keepBests(S.session, S.L, tr);
        const got = keepBests(S.bests, S.L, tr);
        if (got.sec.length || got.mini.length || got.lap) save();
        if (got.lap) { S.candidates = candidatesFor(race, S.modified); S.ref = referenceOf(S.L, S.candidates); showRef(); }
      }
      S.rec.start(c.lap, c, race.t - c.lapStart); S.mini = 0;
      Hud.sectorNewLap();
    },
    // the analysis screen's view of a circuit outside a race (start menu): your best against the reference
    // (activeAero: the setup's, for the ALIEN's lap)
    menuData(track, modified, activeAero) {
      const race = { track, activeAero };
      const L = SIM.buildSectors(track), bests = bestsFor(track, L, modified, zoneTag(track, activeAero));
      const keep = S; S = { track, L, bests, laps: [], session: emptyBests(L), modified };
      S.candidates = candidatesFor(race, modified); S.ref = referenceOf(L, S.candidates);
      const out = S; S = keep; return out;
    },
    reset() { S = null; },
  };
}
