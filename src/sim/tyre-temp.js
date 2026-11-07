// Tyre temperatures and their grip (2026-10-27; the car class's tyreTemp, TYRE_TEMP for the F1). A car's `tyreT` is null unless the race runs
// them (createRace tyreTemp): then chassis.js multiplies each axle's grip by tempGrip of its tyres and feeds the heat of
// every step back here. Order of the four: FL, FR, RL, RR.
import { EV } from './tuning.js';
import { F1_2026 } from './classes/f1-2026.js';
import { emit } from './events.js';
import { M as FM } from './fmath.js';   // (deterministic sin, cos, atan2, hypot …: the same race on every engine)
/** @typedef {import('./types.js').Car} Car */

/** a set of tyres at `t` °C (default: off the blankets) (surface and core), the share of each axle's load on its outer
 *  wheel (from the last step); win = its compound's window (the class's compounds); tt = the class's tyre temperature
 *  table (every function here reads the set's) */
export const tyreSet = (t = undefined, compound = 'medium', cls = F1_2026) => {
  const tt = cls.tyreTemp, win = cls.compounds[compound].window;
  t ??= tt.blanket;
  return { s: [t, t, t, t], k: [t, t, t, t], out: [0.5, 0.5], heat: [0, 0, 0, 0], win, warm: t >= win[0], hotFor: [0, 0], hot: [false, false], tt }; };

/** the temperature the grip goes by */
export const gripTemp = (T, i) => T.tt.mix * T.s[i] + (1 - T.tt.mix) * T.k[i];

/** grip factor at temperature t: 1 in the window `win`, less cold or hot (TT: the class's tyre temperature table) */
export function tempGrip(t, win = F1_2026.tyreTemp.window, TT = F1_2026.tyreTemp) {
  const [lo, hi] = win;
  if (t < lo) return 1 - TT.cold.loss * (1 - FM.exp(-(lo - t) / TT.cold.scale));
  if (t > hi) return 1 - Math.min(TT.hot.max, TT.hot.loss * FM.pow((t - hi) / TT.hot.scale, TT.hot.pow));
  return 1;
}

/** each axle's grip factor: its two tyres weighted by the load they carry (the outer wheel more) */
export function axleTempGrip(T) {
  const g = [0, 1, 2, 3].map(i => tempGrip(gripTemp(T, i), T.win, T.tt));
  const side = (a, b, out, outerFirst) => outerFirst ? out * g[a] + (1 - out) * g[b] : (1 - out) * g[a] + out * g[b];
  // T.out[axle] > 0 ⇒ the left wheel is the outer one (turning right), < 0 ⇒ the right one; |out| = its share
  const f = side(0, 1, Math.abs(T.out[0]), T.out[0] >= 0), r = side(2, 3, Math.abs(T.out[1]), T.out[1] >= 0);
  return { f, r };
}

/** one step of the heat flows. heatF / heatR = friction power (W) into the front / rear axle's tyres over the step,
 *  loads = [FL, FR, RL, RR] in N, speed m/s; flex = × the flexing heat per axle (the tyre pressures, spec.flex)
 *  @param {readonly number[]} [flexK] */
export function stepTyreTemps(T, heatF, heatR, loads, speed, dt, flexK = [1, 1]) {
  const TT = T.tt, S = TT.surface, K = TT.core, axleLoad = [loads[0] + loads[1], loads[2] + loads[3]];
  for (let i = 0; i < 4; i++) {
    const a = i < 2 ? 0 : 1, share = axleLoad[a] > 0 ? loads[i] / axleLoad[a] : 0.5, size = a ? 1 : TT.front;
    const friction = (a ? heatR : heatF) * TT.share * share, flex = TT.roll * loads[i] * speed * flexK[a];
    const s = T.s[i], k = T.k[i];
    const grow = d => d * FM.pow(Math.abs(d) / TT.ref, TT.grow);
    const toCore = S.core * size * (s - k), toAir = (S.air + S.airV * speed) * size * grow(s - TT.air), toRoad = S.road * size * grow(s - TT.track);
    T.s[i] = s + (friction - toCore - toAir - toRoad) * dt / (S.C * size);
    T.k[i] = k + (toCore + flex - (K.air + K.airV * speed) * size * grow(k - TT.air)) * dt / (K.C * size);
    T.heat[i] = friction + flex;
  }
}

/** the radio's cues (events): warmed up after a cold set; an axle overheating (held a few seconds, once per spell) */
export function tyreEvents(c, dt) {
  const T = c.tyreT, W = T.tt.warn, [lo, hi] = T.win, g = [0, 1, 2, 3].map(i => gripTemp(T, i));
  if (!T.warm && g.every(t => t >= lo + W.warmAt)) { T.warm = true; emit(c, EV.TYRES_WARM); }
  for (const a of [0, 1]) {
    const t = Math.max(g[2 * a], g[2 * a + 1]);
    T.hotFor[a] = t > hi + W.over ? T.hotFor[a] + dt : Math.max(0, T.hotFor[a] - dt * W.for / W.calm);
    if (!T.hot[a] && T.hotFor[a] >= W.for) { T.hot[a] = true; emit(c, EV.TYRES_HOT, { axle: a ? 'rear' : 'front' }); }
    if (T.hot[a] && T.hotFor[a] === 0) T.hot[a] = false;
  }
}

/** extra tyre wear while hot (pit.js) */
export const hotWear = T => 1 + Math.max(0, ...[0, 1, 2, 3].map(i => gripTemp(T, i) - T.win[1])) / T.tt.hotWear;