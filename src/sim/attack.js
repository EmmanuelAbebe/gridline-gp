// Attack mode and the all-wheel drive start (car classes step 2 stage 4: docs/formula-e-plan.md). Formula E (Gen3 Evo): in
// a race each driver must take attack mode twice, 8 minutes in all: 350 kW in place of 300 and the front motor driving
// too (AWD). It is taken by arming it and then driving through the activation zone, a stretch off the racing line (the
// outside of a corner), so it costs a little time where it is taken. The front motor also drives at the start.
// Here: the zone = the outside of one slow corner's apex (attackZone, per track × class), three loops the car's centre
// must cross on that side (`zone.lat` of the half-width past the middle); a race's attack time = `share` of its expected
// length (laps × a flat-out lap: energy.js; timed: the minutes), split over `uses` activations. The AI (and the player's
// AUTO) arms it on a lap from `fromLap` when nobody is within `ai.safeGap` s behind (it loses a little in the zone), or
// when the laps left are running out (`ai.each` laps per activation left + `ai.spare`); the player's BUTTON arms / disarms it (inp.boost). Time trials and races without
// overtake mode: none. A class without `attack` (the F1): nothing here.
import { EV } from './tuning.js';
import { emit } from './events.js';
import { wrapIdx } from './math.js';
import { aiOf } from './ai-profile.js';
import { lapsToGo } from './pit.js';
import { gapBehind } from './ecu.js';
import { lapEnergy } from './energy.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */
/** @typedef {import('./types.js').Track} Track */
/** @typedef {import('./types.js').CarClass} CarClass */
/** @typedef {{ loops: number[], apex: number, side: number, lat: number, from: number, to: number }} AttackZone */

const zones = new WeakMap();
// The activation zone: the outside of the apex of a slow corner (`zone.minV`..`maxV` m/s on the class's line) whose
// line runs closest to the inside, away from the start / finish and the pit roads (`zone.clear` m); loops at the
// apex and `length` / 2 m either side. Null if no corner fits.
/** @param {Track} T @param {CarClass} cls @returns {AttackZone | null} */
export function attackZone(T, cls) {
  let byClass = zones.get(T);
  if (!byClass) zones.set(T, byClass = new Map());
  if (byClass.has(cls)) return byClass.get(cls);
  const Z = cls.attack.zone, P = aiOf(T, cls), { N, ds } = T, half = Math.round(Z.length / 2 / ds), clear = Z.clear / ds;
  const lane = T.pit, near = i => Math.min(i, N - i) < clear
    || (lane && wrapIdx(i - lane.entry, N) < wrapIdx(lane.exit - lane.entry, N) + clear);
  let best = null, score = -Infinity;
  for (const a of new Set(P.APEX)) {
    const hw = T.HW, inside = Math.abs(P.RO[a]) / hw;
    if (P.VP[a] < Z.minV || P.VP[a] > Z.maxV || near(a) || inside < Z.inside) continue;
    const s = inside - P.VP[a] / Z.maxV;               // (the line nearest the inside, then the slower corner)
    if (s > score) { score = s; best = a; }
  }
  const out = best === null ? null : { apex: best, side: -Math.sign(P.RO[best]), lat: Z.lat * T.HW,
    loops: [wrapIdx(best - half, N), best, wrapIdx(best + half, N)], from: wrapIdx(best - half, N), to: wrapIdx(best + half, N) };
  byClass.set(cls, out);
  return out;
}

// createRace: the race's attack mode (race.attack: the zone, seconds per activation) and every car's activations and
// AWD start; nothing for a class without it, a time trial or a race without overtake mode
/** @param {Race} race */
export function setupAttack(race) {
  race.attack = null;
  const A = race.carClass.attack;
  for (const c of race.cars) c.awdStart = !!A;
  if (!A || !race.overtake) return;
  const zone = attackZone(race.track, race.carClass);
  const length = race.laps < Infinity ? race.laps * lapEnergy(race.track, race.carClass).time : race.duration;
  if (!zone || !(length < Infinity)) return;
  race.attack = { zone, seconds: length * A.share / A.uses };
  for (const c of race.cars) { c.attackUses = A.uses; c.attackArmed = false; c.attackLoop = 0; c.attackLeft = 0; c.attackOn = false; c.attackLap = 0; }
}

// Before each driving step (drivePlayer / driveAI): the AWD start (off once past `start` m/s), arming, the loops, the
// time running down. inp.boost: the player's button (the step it was pressed: arm / disarm).
/** @param {Race} race @param {Car} c */
export function updateAttack(race, c, inp, dt) {
  const A = c.spec.cls.attack;
  if (!A) return;
  if (c.awdStart && c.v > A.start) c.awdStart = false;
  const R = race.attack;
  if (R) {
    if (c.attackOn) {
      c.attackLeft -= dt;
      if (c.attackLeft <= 0 || c.finished) { c.attackOn = false; c.attackLeft = 0; emit(c, EV.ATTACK, { on: false, uses: c.attackUses }); }
    } else if (c.attackUses > 0 && !c.finished && !c.pit) {
      const Z = R.zone, N = race.track.N;
      if (c.player && !c.boostAuto) { if (inp.boost) { c.attackArmed = !c.attackArmed; c.attackLoop = 0; emit(c, EV.ATTACK_ARMED, { armed: c.attackArmed, uses: c.attackUses }); } }
      else if (c.attackLap !== c.lap && wrapIdx(Z.from - c.idx, N) * race.track.ds < A.ai.decide) {
        // decided once a lap, `ai.decide` m before the zone
        c.attackLap = c.lap;
        const was = c.attackArmed, left = lapsToGo(race, c), late = left <= c.attackUses * A.ai.each + A.ai.spare;
        c.attackArmed = c.lap >= A.fromLap && left > 1 && (late || gapBehind(race, c) > A.ai.safeGap);
        c.attackLoop = 0;
        if (c.attackArmed && !was) emit(c, EV.ATTACK_ARMED, { armed: true, uses: c.attackUses });
      }
      // the loops: each one crossed with the car's centre on the zone's side, in order; one missed = round again
      if (c.attackArmed) {
        const at = Z.loops[c.attackLoop], past = wrapIdx(c.idx - at, N);
        if (past < A.zone.window) {
          if (Z.side * c.lat >= Z.lat && ++c.attackLoop === Z.loops.length) {
            c.attackArmed = false; c.attackLoop = 0; c.attackUses--; c.attackOn = true; c.attackLeft = R.seconds;
            emit(c, EV.ATTACK, { on: true, left: R.seconds, uses: c.attackUses });
          }
        } else if (c.attackLoop > 0 && past < N / 2) { c.attackLoop = 0; emit(c, EV.ATTACK_MISSED, {}); }   // (past a loop off the zone's side)
      }
    }
  }
  c.awd = c.attackOn || c.awdStart;
}

// the AI's line: armed and coming up to the zone (within `zone.ahead` m) or in it, it aims for the zone's side
// (`zone.aim` m past the loops), at most `zone.slow` × its line's speed at the apex until `zone.exit` m past it (wide at
// the apex the rest of the corner is tighter: at Hautvale's at the line's speed it slid off the road); null otherwise
// (off: the offset to aim for, null past the zone; v: the speed cap (m/s, before the driver's skill) on the samples
// `from` … `from + span`)
/** @param {Race} race @param {Car} c @returns {{ off: number | null, v: number, from: number, span: number } | null} */
export function attackLine(race, c) {
  const R = race.attack;
  if (!R || !(c.attackArmed || c.attackOn)) return null;
  const Z = R.zone, T = race.track, A = c.spec.cls.attack.zone, to = wrapIdx(Z.from - c.idx, T.N) * T.ds;
  const past = wrapIdx(c.idx - Z.from, T.N), zone = wrapIdx(Z.to - Z.from, T.N), span = zone + Math.round(A.exit / T.ds);
  if (!(past <= span || c.attackArmed && to < A.ahead)) return null;
  return { off: past <= zone + 2 || c.attackArmed ? Z.side * (Z.lat + A.aim) : null, v: aiOf(T, c.spec.cls).VP[Z.apex] * A.slow, from: Z.from, span };
}
