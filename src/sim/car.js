// Car state, where a car is on the track (nearest sample, lateral offset), walls and surface.
import { EV, BARRIERS, ROUGH, OFFTRACK } from './tuning.js';
import { surfaceAt } from './runoff.js';
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
    wallHit: false, touching: false, wasTouching: false, impact: 0, impactHard: 1, barrier: null, onKerb: false, offTrack: false,
    // off track: tyre dirt 0..1, depth in a gravel trap, beached (stuck in gravel, waiting for the marshals)
    dirt: 0, gravelDepth: 0, beached: false, beachedAt: 0, stuckT: 0,
    // drivetrain (vehicle.js): gear 1..8, -1 = reverse; autoShift = automatic gearbox; downQueue = manual downshifts waiting for the revs; slip = slipstream 0..1
    gear: 1, rpm: 0, thr: 0, shiftT: 0, autoShift: true, autoDown: false, downQueue: 0, drive: 0, slip: 0, slipBy: null,
    // chassis (chassis.js, player): lateral speed (m/s, + = right), yaw rate (rad/s), last longitudinal accel,
    // how saturated each axle is (0..1), lock-up / wheel spin flags; surface under the car
    vy: 0, yawRate: 0, ax: 0, slideF: 0, slideR: 0, lockF: false, spinR: false, surface: 'track', assists: null,
    // trail: lateral offset and time when this car last passed each track sample (its wake, for slipstream)
    trailLat: new Float32Array(track.N), trailT: new Float32Array(track.N).fill(-1),
    // AI
    offset: lat, bias: (Math.random()-0.5)*1.6, mistake: 0, mistakeEnd: -1, passBy: null, passSide: 1, aiT: -1,   // mistake: share too fast, until mistakeEnd
    // timing
    // track limits (race.js): metres of the current cut, cuts so far, penalty seconds, current / last lap invalid
    cutRun: 0, cuts: 0, penalty: 0, lapInvalid: false, lastLapInvalid: false,
    lap: 0, finished: false, finishTime: 0, finishLap: 0, lapStart: 0, lastLap: 0, bestLap: Infinity, cpT: [], lastCp: -1,
    // things that happened this step (EV.*); the game drains this queue. `impact` = speed of the last hit
    events: [] };
  locate(track, c, true);
  return c;
}

// The barrier on the car's side at its sample (runoff.js). A hit keeps BARRIERS[type].keep of the speed (a tyre wall
// soaks up more than concrete, which the car glances off); c.impactHard = how hard it felt (sound, shake).
export function resolveWalls(track, c) {
  const { NX, NZ } = track, R = track.runoff[c.lat < 0 ? 0 : 1], lim = R.wall[c.idx] - 1.3;
  if (Math.abs(c.lat) <= lim) { c.wallHit = false; return; }
  const s = Math.sign(c.lat), over = Math.abs(c.lat) - lim;
  c.x -= NX[c.idx]*s*over; c.z -= NZ[c.idx]*s*over; c.lat = s*lim;
  let th = headingAt(track, c.idx);           // nudge the heading back along the wall
  if (!c.wallHit) {
    const B = BARRIERS[R.barrier[c.idx]] || BARRIERS[0];
    c.impact = Math.abs(c.v * Math.sin(c.h - th)); c.impactHard = B.hard; c.barrier = B.name;
    c.v *= B.keep; c.vy *= 0.3; c.yawRate *= 0.3; c.events.push(EV.WALL);
  }
  c.wallHit = true;
  if (Math.cos(c.h - th) < 0) th += Math.PI;
  c.h += wrapA(th - c.h) * 0.12;
}

// Surface under the car (runoff.js surfaceAt: the same layout the renderer draws). Running onto a sausage kerb
// upsets the car once: a yaw kick and a little speed lost (EV.SAUSAGE).
export function updateSurface(track, c) {
  const { surface, depth } = surfaceAt(track, c.idx, c.lat), was = c.surface;
  c.surface = surface; c.gravelDepth = depth;
  c.onKerb = surface === 'kerb' || surface === 'sausage';
  c.offTrack = surface in ROUGH;
  if (surface === 'sausage' && was !== 'sausage') {
    const hit = Math.min(1, Math.abs(c.v) / 40);
    c.yawRate += -Math.sign(c.lat) * OFFTRACK.sausageYaw * hit; c.v *= 1 - OFFTRACK.sausageLoss * hit;
    c.impact = Math.abs(c.v) * 0.25; c.events.push(EV.SAUSAGE);
  }
}

// Beached in a gravel trap: stopped deep in it for stuckTime s. The car can't move until the marshals have lifted it
// back to the edge of the track (recoverTime s later, EV.RECOVERED); dirty tyres afterwards.
export function updateBeached(race, c) {
  const O = OFFTRACK, track = race.track;
  if (c.beached) {
    if (race.t - c.beachedAt < O.recoverTime) return;
    const i = c.idx, s = c.lat < 0 ? -1 : 1, R = track.runoff[s < 0 ? 0 : 1];
    const lat = s * Math.min(R.turf[i] + 1.5, R.wall[i] - 2);
    c.x = track.PX[i] + track.NX[i] * lat; c.z = track.PZ[i] + track.NZ[i] * lat; c.lat = lat; c.h = headingAt(track, i);
    c.v = c.vy = c.yawRate = 0; c.beached = false; c.stuckT = 0; c.dirt = 1; c.gear = 1; c.cutRun = 0;
    updateSurface(track, c); c.events.push(EV.RECOVERED);
    return;
  }
  const stuck = c.surface === 'gravel' && c.gravelDepth > O.deep && Math.hypot(c.v, c.vy) < O.stuckSpeed;
  c.stuckT = stuck ? (c.stuckT || 0) + (race.t - (c.beachClock ?? race.t)) : 0; c.beachClock = race.t;
  if (c.stuckT >= O.stuckTime) { c.beached = true; c.beachedAt = race.t; c.events.push(EV.BEACHED); }
}
