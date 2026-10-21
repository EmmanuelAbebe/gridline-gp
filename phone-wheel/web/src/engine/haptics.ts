// Force feedback: the game's { fx } messages (src/game/haptics.js in Gridline GP, ~20 per second while something is
// felt) → navigator.vibrate patterns. A phone motor is only on or off, so strength = how much of the time it is on
// (pulse width), and each effect has its own rhythm: kerbs a regular ripple that speeds up with the car, gravel and
// grass an uneven rumble, a slide a fine fast buzz, a hit one long pulse. Pure (tested in test/haptics.test.ts):
// planFeedback() says what to play; the engine calls navigator.vibrate with it.
import type { FeedbackCfg } from '../settings/settings.ts';

// l = at full steering lock (held), ls = it just got there (a knock)
export interface Fx { k?: number; kh?: number; o?: number; s?: number; h?: number; g?: number; l?: number; ls?: number }
export interface Plan { key: string; start: number; until: number; busyUntil: number }
export const idlePlan = (): Plan => ({ key: '', start: 0, until: 0, busyUntil: 0 });

export const FFB = {
  span: 400,          // ms of pattern per vibrate() call: if the PC goes quiet the motor stops by itself after this
  renew: 150,         // ms before a pattern runs out that the same effect is queued again
  minOn: 12, minOff: 8,               // shorter than this the motor doesn't spin up / doesn't stop
  floor: 0.05,                        // below this nothing plays
  hit: { base: 40, per: 170, max: 260 },  // a hit: base + per × strength ms
  shift: 16,                          // a gear change: one short tick
  lockKnock: 34,                      // reaching full lock: one knock, like a wheel's end stop
  lock: { period: 70, on: 9 },        // held at full lock: a light, slow buzz (only when nothing stronger plays)
  kerb: { duty: 0.25, perLevel: 0.45 },
  slide: { period: 45, on: 6, perLevel: 24 },
  rough: { min: 35, max: 90, duty: 0.25, perLevel: 0.5 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// pattern: null = leave the motor as it is, [] = stop it, else a vibrate() pattern (on, off, on, ... ms)
export function planFeedback(fx: Fx, cfg: FeedbackCfg, now: number, prev: Plan, rand: () => number = Math.random): { pattern: number[] | null; state: Plan } {
  const playing = prev.key !== '' || now < prev.busyUntil;
  const stop = () => ({ pattern: playing ? [] : null, state: idlePlan() });
  if (!cfg.on) return stop();
  const k = cfg.strength;
  // one-off moments first: they take the motor for their length, then the rumble carries on
  if ((fx.h ?? 0) > 0 && cfg.hits) {
    const ms = Math.round(Math.min(FFB.hit.max, FFB.hit.base + FFB.hit.per * clamp((fx.h ?? 0) * k, 0, 1)));
    return { pattern: [ms], state: { ...idlePlan(), busyUntil: now + ms } };
  }
  if (fx.ls && cfg.lock && now >= prev.busyUntil) {
    const ms = Math.round(Math.min(FFB.hit.max, FFB.lockKnock * clamp(k, 0.5, 1.5)));
    return { pattern: [ms], state: { ...idlePlan(), busyUntil: now + ms } };
  }
  if (fx.g && cfg.shifts && now >= prev.busyUntil) return { pattern: [FFB.shift], state: { ...idlePlan(), busyUntil: now + FFB.shift } };
  if (now < prev.busyUntil) return { pattern: null, state: prev };

  const kerb = cfg.kerbs ? clamp((fx.k ?? 0) * k, 0, 1) : 0;
  const rough = cfg.offTrack ? clamp((fx.o ?? 0) * k, 0, 1) : 0;
  const slide = cfg.slides ? clamp((fx.s ?? 0) * k, 0, 1) : 0;
  const top = Math.max(kerb, rough, slide);
  if (top < FFB.floor && (fx.l ?? 0) > 0 && cfg.lock) {                // only the end stop: its own light rhythm
    const period = FFB.lock.period, on = Math.round(clamp(FFB.lock.on * k, FFB.minOn, period - FFB.minOff)), key = `l${on}`;
    if (key === prev.key && now < prev.until - FFB.renew) return { pattern: null, state: prev };
    const pattern: number[] = []; let total = 0;
    while (total < FFB.span) { pattern.push(on, period - on); total += period; }
    return { pattern, state: { key, start: now, until: now + total, busyUntil: 0 } };
  }
  if (top < FFB.floor) return stop();

  // the strongest effect sets the rhythm
  let key: string, period = 0, on = 0;
  if (top === kerb) {
    period = Math.round(1000 / clamp(fx.kh || 10, 2, 40));
    on = Math.round(clamp(period * (FFB.kerb.duty + FFB.kerb.perLevel * kerb), FFB.minOn, period - FFB.minOff));
    key = `k${period}:${on}`;
  } else if (top === slide) {
    period = FFB.slide.period;
    on = Math.round(clamp(FFB.slide.on + FFB.slide.perLevel * slide, FFB.minOn, period - FFB.minOff));
    key = `s${on}`;
  } else key = `o${Math.round(rough * 10)}`;
  if (key === prev.key && now < prev.until - FFB.renew) return { pattern: null, state: prev };

  const pattern: number[] = [];
  let total = 0, start = now;
  if (period) {
    // the same rhythm again: carry on in step with the one playing, so renewing it doesn't stutter
    if (key === prev.key) start = prev.start;
    const t = (now - start) % period;
    if (t < on) pattern.push(Math.round(on - t), period - on); else pattern.push(0, Math.round(period - t));
    total = pattern[0] + pattern[1];
    while (total < FFB.span) { pattern.push(on, period - on); total += period; }
  } else {
    while (total < FFB.span) {
      const p = Math.round(FFB.rough.min + (FFB.rough.max - FFB.rough.min) * rand());
      const o = Math.round(clamp(p * (FFB.rough.duty + FFB.rough.perLevel * rough) * (0.7 + 0.6 * rand()), FFB.minOn, p - FFB.minOff));
      pattern.push(o, p - o); total += p;
    }
  }
  return { pattern, state: { key, start, until: now + total, busyUntil: 0 } };
}
