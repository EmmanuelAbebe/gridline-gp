// The leaderboard's lap check (docs/leaderboard-plan.md; pure, tests/leaderboard.test.js). A submitted run is the
// player's replay (src/sim/replay.js: the inputs from lights out); the server drives it again with the very same
// physics and takes the time from its own result, so a time the physics doesn't produce can't get on the board.
// Ranked runs: a time trial (you alone, no wear), the stock car (the race setup is allowed; open mods are not), the
// automatic straight-mode zones, this exact physics code (SIM_VERSION). The best valid flying lap counts (lap 2 on:
// lap 1 starts from the grid), with its sector times, the settings it was driven with and its ghost (server-made).
import { SIM } from '../../src/sim/index.js';
import { createRecorder, compactGhost } from '../../src/game/ghost.js';
import { createTraceRecorder, sectorTimes } from '../../src/game/lap-analysis.js';

export const RULES = Object.freeze({
  maxSteps: 120 * 60 * 30,     // 30 minutes of driving at most in one run
  claimTolerance: 0.0005,      // s: the time the game saw vs the replay's (the same physics: equal)
});
const PLAYER = SIM.DRIVERS.find(d => d.player).code;
const fail = reason => ({ ok: false, reason });

// the board a lap goes on: per physics version, circuit and active aero on / off
export const boardKey = (circuit, aero) => `${SIM.TUNING.PHYSICS}:${circuit}:${aero ? 'on' : 'off'}`;

// the assists' name for the strongest help used during the lap (a preset, else 'custom')
function assistName(a) {
  for (const [name, p] of Object.entries(SIM.ASSISTS)) if (Object.keys(p).every(k => p[k] === a[k])) return name;
  return 'custom';
}

// rp: the replay (plain JSON); claim: { time } the game's lap time (optional: a check)
export function verifyRun(rp, claim = {}) {
  if (!rp || typeof rp !== 'object') return fail('not a replay');
  if (rp.sim !== SIM.SIM_VERSION) return fail('another version of the game: update it to submit laps');
  if (rp.tainted) return fail('not driven by you (' + rp.tainted + ')');
  if (!Object.hasOwn(SIM.CIRCUITS, rp.circuit)) return fail('unknown circuit');
  if (rp.zones) return fail('your own straight-mode zones: only the automatic zones are ranked');
  if (!Array.isArray(rp.drivers) || rp.drivers.length !== 1 || rp.drivers[0] !== PLAYER) return fail('not a time trial');
  if (rp.race?.format?.type !== 'unlimited' || Object.keys(rp.race.wear || {}).length) return fail('not a time trial');
  if (SIM.isModified(rp.player?.mods || {})) return fail('a modified car: open mods are not ranked');
  if (!(rp.steps > 0) || rp.steps > RULES.maxSteps) return fail('too long');
  if (!SIM.COMPOUNDS[rp.player?.compound]) return fail('unknown tyres');

  const track = SIM.buildTrack(SIM.CIRCUITS[rp.circuit]), L = SIM.buildSectors(track);
  const ghostRec = createRecorder(), traceRec = createTraceRecorder(track.N);
  let best = null, help = null;
  ghostRec.start(0); traceRec.start(1, { lap: 0, idx: 0 }, 0);
  // the most help the car had at any moment of the lap (assists changed mid-lap count at their strongest)
  const strongest = (h, c) => {
    const a = h ? { ...h.assists } : { ...c.assists };
    if (h) for (const k in a) a[k] = Math.max(a[k], c.assists[k]);
    return { assists: a, auto: !!(h?.auto || c.autoShift), semi: !!(h?.semi || c.autoDown) };
  };
  let run;
  try {
    run = SIM.replayRun(rp, {
      track,
      onStep(race, c) {
        ghostRec.sample(c, race.t); traceRec.sample(c, race.t - c.lapStart);
        help = strongest(help, c);
        for (const e of c.events) if (e.type === SIM.EV.LAP) {
          const lap = c.lap - 1, g = ghostRec.lap(e.time, { circuit: rp.circuit, modified: false, driver: '', start: lap === 1 });
          const tr = traceRec.finish(e.time, { invalid: !!e.invalid, lap });
          if (lap >= 2 && !e.invalid && g && tr && (!best || e.time < best.time)) best = { time: e.time, lap, ghost: g, trace: tr, help };
          ghostRec.start(c.lapStart); traceRec.start(c.lap, c, race.t - c.lapStart); help = null;
        }
      },
    });
  } catch (err) { return fail('could not be replayed: ' + err.message); }
  if (!best) return fail('no clean flying lap (lap 2 on, no track limits broken)');
  if (Number.isFinite(claim.time) && claim.lap === best.lap && Math.abs(claim.time - best.time) > RULES.claimTolerance)
    return fail('the replay drove a different lap than the game did');

  const h = best.help, R = rp.race;
  return {
    ok: true, circuit: rp.circuit, aero: !!R.activeAero, board: boardKey(rp.circuit, R.activeAero), time: best.time, lap: best.lap,
    laps: run.laps.length,
    sectors: sectorTimes(best.trace, L).map(t => Math.round(t * 1000) / 1000),
    settings: {
      assists: assistName(h.assists), gearbox: h.auto ? 'auto' : h.semi ? 'semi' : 'manual', tyres: rp.player.compound,
      tyreTemp: !!R.tyreTemp, overtake: !!R.overtake, setup: SIM.validSetup(rp.player.setup),   // (as the car got it: carSpec clamps)
    },
    ghost: compactGhost(best.ghost),
  };
}
