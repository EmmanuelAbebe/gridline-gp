// Force feedback for the phone wheel (pure: no DOM; tests/haptics.test.js). What the player's car feels each frame
// becomes a small message for the phone (phone-wheel/web/src/engine/haptics.ts turns it into vibration):
//   { fx: { k, kh, o, s, l, h, g, ls } }   k = kerb 0..1 with kh = its ripples per second, o = off the track 0..1 (grass,
//   gravel), s = sliding / locked / spinning 0..1, and once per moment: h = a hit 0..1 (wall, car, sausage kerb),
//   g = 1 for a gear change; l = 1 while the steering is at full lock, with ls = 1 the moment it gets there (2026-10-21,
//   user: feedback at the maximum steering angle). The phone decides what to play (its own settings: strength, which effects).
// Sent at HAPTICS.hz while anything is felt, and once more with everything at 0 when it stops.
import { SIM } from '../sim/index.js';

const { EV } = SIM;
export const HAPTICS = Object.freeze({
  hz: 20,
  kerb: { base: 0.35, perSpeed: 0.5 / 50, sausage: 1, ripple: 1.6, minHz: 6, maxHz: 18 },   // ripple = m between bumps
  rough: { gravel: 0.7, grass: 0.4, turf: 0.3, fullAt: 25, min: 0.15 },                      // fullAt m/s
  slide: { rear: 1, front: 0.6, lock: 0.8, spin: 0.6, fullAt: 15 },
  hit: { wall: 25, contact: 15, contactMin: 1, sausage: 15, sausageMax: 0.5 },               // m/s for a full hit
  minSpeed: 2,
  lock: 0.98,           // |car.steer| from here = full lock
});

const r2 = v => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

export function createHaptics() {
  let hit = 0, shift = 0, wait = 0, felt = false, locked = false, lockHit = 0;
  return {
    // a player event (main.js onPlayerEvent)
    event(e) {
      const H = HAPTICS.hit;
      if (e.type === EV.WALL) hit = Math.max(hit, Math.min(1, e.impact / H.wall) * (e.hard ?? 1));
      else if (e.type === EV.CONTACT && e.impact >= H.contactMin) hit = Math.max(hit, Math.min(1, e.impact / H.contact));
      else if (e.type === EV.SAUSAGE) hit = Math.max(hit, Math.min(H.sausageMax, e.impact / H.sausage));
      else if (e.type === EV.LANDED) hit = Math.max(hit, Math.min(1, e.impact / H.wall));   // (back down from the air: as hard as a wall at that speed)
      else if (e.type === EV.SHIFT && e.from > 0 && e.to > 0) shift = 1;
    },
    // what the car feels now: { k, kh, o, s, l }
    feel(c) {
      const v = SIM.speedOf(c), K = HAPTICS.kerb, R = HAPTICS.rough, S = HAPTICS.slide;
      const out = { k: 0, kh: 0, o: 0, s: 0, l: 0 };
      if (c.pit) return out;
      out.l = Math.abs(c.steerIn ?? c.steer) >= HAPTICS.lock ? 1 : 0;   // the end stop of the controller's travel (speed-sensitive steering maps it to less lock)
      if (v < HAPTICS.minSpeed) return out;
      if (c.onKerb) {
        out.k = c.surface === 'sausage' ? K.sausage : K.base + K.perSpeed * v;
        out.kh = Math.round(Math.min(K.maxHz, Math.max(K.minHz, v / K.ripple)));
      }
      if (c.offTrack) out.o = Math.max(R.min, (R[c.surface] ?? R.grass) * Math.min(1, v / R.fullAt));
      out.s = Math.max(c.slideR * S.rear, c.slideF * S.front, c.lockF ? S.lock : 0, c.spinR ? S.spin : 0) * Math.min(1, v / S.fullAt);
      out.k = r2(out.k); out.o = r2(out.o); out.s = r2(out.s);
      return out;
    },
    // every frame; c = the player's car, or null when nothing should be felt (menus, pause, finished).
    // Returns the message to send, or null.
    frame(c, dt) {
      const f = c ? this.feel(c) : { k: 0, kh: 0, o: 0, s: 0, l: 0 };
      if (f.l && !locked) lockHit = 1;                                  // just reached full lock: one sharp knock
      locked = !!f.l;
      const now = f.k > 0 || f.o > 0 || f.s > 0 || f.l > 0;
      if (!c) { hit = 0; shift = 0; lockHit = 0; }
      if ((wait -= dt) > 1e-6 && !hit && !shift && !lockHit) return null;
      if (!now && !felt && !hit && !shift && !lockHit) return null;
      wait = Math.max(0, wait) + 1 / HAPTICS.hz; felt = now;
      const fx = { ...f };
      if (hit) fx.h = r2(Math.max(0.05, hit));
      if (shift) fx.g = 1;
      if (lockHit) fx.ls = 1;
      hit = 0; shift = 0; lockHit = 0;
      return { fx };
    },
  };
}
