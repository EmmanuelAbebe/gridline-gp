// Car state, where a car is on the track (nearest sample, lateral offset), walls and surface.
import { EV } from './tuning.js';
import { wrapA } from './math.js';
import { gridSlot, headingAt } from './track.js';

// Nearest-sample search (full scan, or a window around the last index). Returns the previous index.
export function locate(track, c, full) {
  const { N, PX, PZ, NX, NZ } = track;
  let best = 1e18, bi = c.idx;
  if (full) { for (let i = 0; i < N; i++) { const dx = c.x-PX[i], dz = c.z-PZ[i], d = dx*dx+dz*dz; if (d < best) { best = d; bi = i; } } }
  else for (let o = -24; o <= 24; o++) { const i = (c.idx+o+N)%N, dx = c.x-PX[i], dz = c.z-PZ[i], d = dx*dx+dz*dz; if (d < best) { best = d; bi = i; } }
  const old = c.idx; c.idx = bi;
  c.lat = (c.x-PX[bi])*NX[bi] + (c.z-PZ[bi])*NZ[bi];
  return old;
}

export function createCar(track, driver, slot) {
  const { PX, PZ, NX, NZ } = track, { idx, lat } = gridSlot(track, slot);
  const c = { ...driver, slot,
    // physics
    idx, x: PX[idx] + NX[idx]*lat, z: PZ[idx] + NZ[idx]*lat, h: headingAt(track, idx), v: 0, lat, steer: 0, roll: 0,
    wallHit: false, touching: false, wasTouching: false, impact: 0, onKerb: false, offTrack: false,
    // drivetrain (vehicle.js): gear 1..8, -1 = reverse; autoShift = automatic gearbox; slip = slipstream 0..1
    gear: 1, rpm: 0, shiftT: 0, autoShift: true, drive: 0, slip: 0, slipBy: null,
    // chassis (chassis.js, player): lateral speed (m/s, + = right), yaw rate (rad/s), last longitudinal accel,
    // how saturated each axle is (0..1), lock-up / wheel spin flags; surface under the car
    vy: 0, yawRate: 0, ax: 0, slideF: 0, slideR: 0, lockF: false, spinR: false, surface: 'track', assists: null,
    // trail: lateral offset and time when this car last passed each track sample (its wake, for slipstream)
    trailLat: new Float32Array(track.N), trailT: new Float32Array(track.N).fill(-1),
    // AI
    offset: lat, bias: (Math.random()-0.5)*1.6,
    // timing
    lap: 0, finished: false, finishTime: 0, finishLap: 0, lapStart: 0, lastLap: 0, bestLap: Infinity, cpT: [], lastCp: -1,
    // things that happened this step (EV.*); the game drains this queue. `impact` = speed of the last hit
    events: [] };
  locate(track, c, true);
  return c;
}

export function resolveWalls(track, c) {
  const { NX, NZ } = track, lim = track.WALL - 1.3;
  if (Math.abs(c.lat) <= lim) { c.wallHit = false; return; }
  const s = Math.sign(c.lat), over = Math.abs(c.lat) - lim;
  c.x -= NX[c.idx]*s*over; c.z -= NZ[c.idx]*s*over; c.lat = s*lim;
  let th = headingAt(track, c.idx);           // nudge the heading back along the wall
  if (!c.wallHit) { c.impact = Math.abs(c.v * Math.sin(c.h - th)); c.v *= 0.5; c.vy *= 0.3; c.yawRate *= 0.3; c.events.push(EV.WALL); }
  c.wallHit = true;
  if (Math.cos(c.h - th) < 0) th += Math.PI;
  c.h += wrapA(th - c.h) * 0.12;
}

// Surface under the car: track, kerb (only where kerbs are painted), sand (gravel trap on the outside of corners),
// else grass. Uses the same rules as the renderer (track KERB_K / SAND_K / SAND).
export function updateSurface(track, c) {
  const { HW, KERB, SAND, SAND_K, KERB_K } = track, k = track.K[c.idx], a = Math.abs(c.lat);
  const kerbed = Math.abs(k) > KERB_K, outside = c.lat < 0 ? k > SAND_K : k < -SAND_K;
  c.surface = a <= HW ? 'track' : a <= HW + KERB ? (kerbed ? 'kerb' : 'grass') : a <= HW + KERB + SAND && outside ? 'sand' : 'grass';
  c.onKerb = kerbed && a > HW - 0.2 && a <= HW + KERB;
  c.offTrack = c.surface === 'grass' || c.surface === 'sand';
}
