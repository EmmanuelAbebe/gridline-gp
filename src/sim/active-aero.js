// Active aero and overtake mode (ACTIVE_AERO, OVERTAKE in tuning.js). Every car, player and AI, the same rules.
// Off unless the race has `activeAero` (createRace option), so cars without it keep aeroOpen = 0: the physics then
// multiplies by exactly 1 (sim-trace unchanged).
import { ACTIVE_AERO as AA, OVERTAKE, AI, TUNING, EV } from './tuning.js';
import { STOCK } from './spec.js';
import { G } from './vehicle.js';
import { wrapIdx } from './math.js';
import { emit } from './events.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */

// Straight-mode zones of a track: { zone (1 per sample inside one), zones [{ from, to }] (sample indices, to exclusive,
// may wrap) }. A sample qualifies when the AI's speed profile is flat out for closeAhead m and every bend in the next
// `look` m (racing line or centre line) is one a car with open wings takes at full speed.
/** @param {{ N: number, ds: number, K: Float32Array, LK: Float32Array, VP: Float32Array }} t */
export function buildAeroZones(t) {
  const { N, ds, K, LK, VP } = t, Z = AA.zone, dfOpen = STOCK.dfK * (1 - AA.downforceCut), mu = STOCK.grip * AI.grip;
  const flatOut = k => { const den = 1 - mu * dfOpen / Math.max(k, 1e-6); return den <= 0.02 || Math.sqrt(mu * G / Math.max(k, 1e-6) / den) >= TUNING.V_CAP; };
  const look = Math.round(Z.look / ds), ahead = Math.round(Z.closeAhead / ds), ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let good = true;
    for (let o = 0; o <= Math.max(look, ahead) && good; o++) {
      const j = wrapIdx(i + o, N);
      if (o <= ahead && VP[j] < TUNING.V_CAP - 1e-3) good = false;
      if (o <= look && !flatOut(Math.max(Math.abs(K[j]), Math.abs(LK[j])))) good = false;
    }
    ok[i] = good ? 1 : 0;
  }
  // runs of qualifying samples (wrapping past the line), long enough
  const zone = new Uint8Array(N), zones = [], min = Math.round(Z.minLength / ds);
  if (ok.every(Boolean)) return { zone: zone.fill(1), zones: [{ from: 0, to: N }] };
  let start = ok.indexOf(0);
  for (let k = 1; k <= N; k++) {
    const i = wrapIdx(start + k, N);
    if (ok[i] && !ok[wrapIdx(i - 1, N)]) {
      let len = 0; while (len < N && ok[wrapIdx(i + len, N)]) len++;
      if (len >= min) { zones.push({ from: i, to: wrapIdx(i + len, N) }); for (let o = 0; o < len; o++) zone[wrapIdx(i + o, N)] = 1; }
    }
  }
  return { zone, zones: zones.sort((a, b) => a.from - b.from) };
}

// Time behind the car directly ahead on the road (any car, lapped ones too): from the trail every car leaves
// (when it last passed the sample this car is on). Infinity when nobody passed it in the last `within` s.
/** @param {Race} race @param {Car} c */
export function gapAhead(race, c, within = 5) {
  let best = Infinity;
  for (const o of race.cars) {
    if (o === c || o.pit) continue;
    const t = o.trailT[c.idx];
    if (t >= 0 && race.t - t < Math.min(best, within) && race.t - t > 0) best = race.t - t;
  }
  return best;
}

// Before each driving step. inp: thr, brk (as about to be applied), boost (player: true for the step the button
// was pressed: switches overtake mode on / off).
/** @param {Race} race @param {Car} c */
export function updateActiveAero(race, c, inp, dt) {
  if (!race.activeAero) return;
  const T = race.track;
  // overtake mode: detection each time the car starts a lap
  if (race.overtake && c.lap !== c.boostLap) {
    c.boostLap = c.lap; c.boostOn = false;
    const gap = c.lap >= OVERTAKE.fromLap && !c.finished ? gapAhead(race, c) : Infinity;
    c.boostLeft = gap <= OVERTAKE.gap ? OVERTAKE.seconds : 0;
    if (c.boostLeft) emit(c, EV.BOOST_READY, { gap });
  }
  const zoneHere = !!T.aeroZone[c.idx] && !c.pit;
  if (c.boostLeft > 0) {
    const was = c.boostOn;
    if (c.player && !c.boostAuto) { if (inp.boost) c.boostOn = !c.boostOn; }
    else c.boostOn = zoneHere && inp.thr > AA.thr && gapAhead(race, c) < OVERTAKE.gap * 1.2;
    if (c.boostOn && inp.thr > 0.5) c.boostLeft = Math.max(0, c.boostLeft - dt);
    if (c.boostLeft <= 0 || c.pit) c.boostOn = false;
    if (c.boostOn !== was) emit(c, EV.BOOST, { on: c.boostOn, left: c.boostLeft });
  } else c.boostOn = false;
  // straight mode / corner mode
  // opening needs (nearly) full throttle; once open they stay open through the zone on a part throttle (a car held
  // up behind another), and close on the brakes, a lift below holdThr, steering or a slide
  const thrOk = inp.thr >= (c.aeroOpen > 0 ? AA.holdThr : AA.thr);
  const open = zoneHere && thrOk && inp.brk < 0.05 && Math.abs(c.steer) < AA.steer && c.v > AA.minSpeed
    && c.slideR < 0.5 && !c.beached;
  c.aeroOpen = open ? Math.min(1, c.aeroOpen + dt / AA.openTime) : Math.max(0, c.aeroOpen - dt / AA.closeTime);
}
