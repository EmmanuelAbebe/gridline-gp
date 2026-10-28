// Tyre temperatures and their grip (2026-10-27; TYRE_TEMP in tuning.js). A car's `tyreT` is null unless the race runs
// them (createRace tyreTemp): then chassis.js multiplies each axle's grip by tempGrip of its tyres and feeds the heat of
// every step back here. Order of the four: FL, FR, RL, RR.
import { TYRE_TEMP as TT, COMPOUNDS, EV } from './tuning.js';
import { emit } from './events.js';
/** @typedef {import('./types.js').Car} Car */

/** a set of tyres at `t` °C (surface and core), the share of each axle's load on its outer wheel (from the last step);
 *  win = its compound's window (COMPOUNDS) */
export const tyreSet = (t = TT.blanket, compound = 'medium') => { const win = COMPOUNDS[compound].window;
  return { s: [t, t, t, t], k: [t, t, t, t], out: [0.5, 0.5], heat: [0, 0, 0, 0], win, warm: t >= win[0], hotFor: [0, 0], hot: [false, false] }; };

/** the temperature the grip goes by */
export const gripTemp = (T, i) => TT.mix * T.s[i] + (1 - TT.mix) * T.k[i];

/** grip factor at temperature t: 1 in the window `win`, less cold or hot */
export function tempGrip(t, win = TT.window) {
  const [lo, hi] = win;
  if (t < lo) return 1 - TT.cold.loss * (1 - Math.exp(-(lo - t) / TT.cold.scale));
  if (t > hi) return 1 - Math.min(TT.hot.max, TT.hot.loss * ((t - hi) / TT.hot.scale) ** TT.hot.pow);
  return 1;
}

/** each axle's grip factor: its two tyres weighted by the load they carry (the outer wheel more) */
export function axleTempGrip(T) {
  const g = [0, 1, 2, 3].map(i => tempGrip(gripTemp(T, i), T.win));
  const side = (a, b, out, outerFirst) => outerFirst ? out * g[a] + (1 - out) * g[b] : (1 - out) * g[a] + out * g[b];
  // T.out[axle] > 0 ⇒ the left wheel is the outer one (turning right), < 0 ⇒ the right one; |out| = its share
  const f = side(0, 1, Math.abs(T.out[0]), T.out[0] >= 0), r = side(2, 3, Math.abs(T.out[1]), T.out[1] >= 0);
  return { f, r };
}

/** one step of the heat flows. heatF / heatR = friction power (W) into the front / rear axle's tyres over the step,
 *  loads = [FL, FR, RL, RR] in N, speed m/s */
export function stepTyreTemps(T, heatF, heatR, loads, speed, dt) {
  const S = TT.surface, K = TT.core, axleLoad = [loads[0] + loads[1], loads[2] + loads[3]];
  for (let i = 0; i < 4; i++) {
    const a = i < 2 ? 0 : 1, share = axleLoad[a] > 0 ? loads[i] / axleLoad[a] : 0.5, size = a ? 1 : TT.front;
    const friction = (a ? heatR : heatF) * TT.share * share, flex = TT.roll * loads[i] * speed;
    const s = T.s[i], k = T.k[i];
    const grow = d => d * (Math.abs(d) / TT.ref) ** TT.grow;
    const toCore = S.core * size * (s - k), toAir = (S.air + S.airV * speed) * size * grow(s - TT.air), toRoad = S.road * size * grow(s - TT.track);
    T.s[i] = s + (friction - toCore - toAir - toRoad) * dt / (S.C * size);
    T.k[i] = k + (toCore + flex - (K.air + K.airV * speed) * size * grow(k - TT.air)) * dt / (K.C * size);
    T.heat[i] = friction + flex;
  }
}

/** the radio's cues (events): warmed up after a cold set; an axle overheating (held a few seconds, once per spell) */
export function tyreEvents(c, dt) {
  const T = c.tyreT, W = TT.warn, [lo, hi] = T.win, g = [0, 1, 2, 3].map(i => gripTemp(T, i));
  if (!T.warm && g.every(t => t >= lo + W.warmAt)) { T.warm = true; emit(c, EV.TYRES_WARM); }
  for (const a of [0, 1]) {
    const t = Math.max(g[2 * a], g[2 * a + 1]);
    T.hotFor[a] = t > hi + W.over ? T.hotFor[a] + dt : Math.max(0, T.hotFor[a] - dt * W.for / W.calm);
    if (!T.hot[a] && T.hotFor[a] >= W.for) { T.hot[a] = true; emit(c, EV.TYRES_HOT, { axle: a ? 'rear' : 'front' }); }
    if (T.hot[a] && T.hotFor[a] === 0) T.hot[a] = false;
  }
}

/** extra tyre wear while hot (pit.js) */
export const hotWear = T => 1 + Math.max(0, ...[0, 1, 2, 3].map(i => gripTemp(T, i) - T.win[1])) / TT.hotWear;