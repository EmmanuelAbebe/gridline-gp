// Car state, where a car is on the track (nearest sample, lateral offset), walls and surface.
import { EV, BARRIERS, ROUGH, OFFTRACK, WALLS } from './tuning.js';
import { surfaceAt } from './runoff.js';
import { wrapA, wrapIdx, speedOf } from './math.js';
import { gridSlot, headingAt } from './track.js';
import { emit } from './events.js';
import { pitState } from './pit.js';
import { STOCK } from './spec.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */
/** @typedef {import('./types.js').Track} Track */

// Nearest-sample search (full scan, or a window around the last index). Returns the previous index.
/** @param {Track} track @param {Car} c @returns {number} */
export function locate(track, c, full) {
  const { N, PX, PZ, NX, NZ } = track;
  let best = 1e18, bi = c.idx;
  if (full) { for (let i = 0; i < N; i++) { const dx = c.x-PX[i], dz = c.z-PZ[i], d = dx*dx+dz*dz; if (d < best) { best = d; bi = i; } } }
  else for (let o = -24; o <= 24; o++) { const i = wrapIdx(c.idx+o, N), dx = c.x-PX[i], dz = c.z-PZ[i], d = dx*dx+dz*dz; if (d < best) { best = d; bi = i; } }
  const old = c.idx; c.idx = bi;
  c.lat = (c.x-PX[bi])*NX[bi] + (c.z-PZ[bi])*NZ[bi];
  return old;
}

// Every field a car has, grouped by the module that owns it (a field added anywhere else is a bug: tsc checks it).
/** @param {Track} track @param {import('./drivers.js').Driver} driver @param {number} slot @param {() => number} rng */
export function createCar(track, driver, slot, rng) {
  const { PX, PZ, NX, NZ } = track, { idx, lat } = gridSlot(track, slot);
  const c = { player: false, ...driver, slot,
    // physics: position, heading, speed, nearest sample / lateral offset (locate), steering (-1..1 after shaping)
    idx, x: PX[idx] + NX[idx]*lat, z: PZ[idx] + NZ[idx]*lat, h: headingAt(track, idx), v: 0, lat, steer: 0, roll: 0,
    // pedals as applied this step (driving.js / pit.js: brake lights, HUD, sound)
    thr: 0, brake: 0,
    // walls and contact (car.js resolveWalls, collide.js); surface under the car (updateSurface)
    wallHit: false, touching: false, wasTouching: false, onKerb: false, offTrack: false, surface: 'track',
    // off track: tyre dirt 0..1, depth in a gravel trap, beached (stuck in gravel, waiting for the marshals);
    // beachClock = race time of the last updateBeached (null before the first)
    dirt: 0, gravelDepth: 0, beached: false, beachedAt: 0, stuckT: 0, beachClock: null,
    // performance spec (spec.js): STOCK, or the player's garage setup + mods (set by the game before the start)
    spec: STOCK,
    // drivetrain (vehicle.js): gear 1..8, -1 = reverse; autoShift = automatic gearbox; downQueue = manual downshifts waiting for the revs; slip = slipstream 0..1
    gear: 1, rpm: 0, shiftT: 0, autoShift: true, autoDown: false, downQueue: 0, drive: 0, slip: 0, slipBy: null,
    // active aero (active-aero.js): wings open 0..1 (straight mode); overtake mode: seconds left this lap, on, lap detected
    // boostAuto: a player car using overtake mode the way the AI does (the game's AUTO setting)
    aeroOpen: 0, boostLeft: 0, boostOn: false, boostLap: 0, boostAuto: false,
    // chassis (chassis.js): lateral speed (m/s, + = right), yaw rate (rad/s), last longitudinal accel,
    // how saturated each axle is (0..1), lock-up / wheel spin flags; assists (ASSISTS levels, set by createRace / the game)
    vy: 0, yawRate: 0, ax: 0, slideF: 0, slideR: 0, lockF: false, spinR: false, assists: null,
    // trail: lateral offset and time when this car last passed each track sample (its wake, for slipstream)
    trailLat: new Float32Array(track.N), trailT: new Float32Array(track.N).fill(-1),
    // player driving (driving.js drivePlayer): smoothed steering input (null until the first player step)
    steerIn: null,
    // AI (driving.js driveAI): line offset, own line bias, mistake = share too fast until mistakeEnd, passing,
    // dirtyK = corner-speed factor in dirty air (smoothed); racecraft: pressure 0..1 (a car close behind), defending
    // to the apex sample defendTo on defendSide (defendZone = the corner last decided for)
    offset: lat, bias: (rng()-0.5)*1.0, mistake: 0, mistakeEnd: -1, passBy: null, passSide: 1, aiT: -1, dirtyK: 1,
    pressure: 0, defendTo: -1, defendSide: 1, defendZone: -1,
    // track limits (race.js): metres of the current cut, cuts so far, penalty seconds, current / last lap invalid
    cutRun: 0, cuts: 0, penalty: 0, lapInvalid: false, lastLapInvalid: false,
    // timing (race.js)
    lap: 0, finished: false, finishTime: 0, finishLap: 0, lapStart: 0, lastLap: 0, bestLap: Infinity, cpT: [], lastCp: -1,
    // fuel, tyres, damage, pit stops (pit.js)
    ...pitState(slot),
    // things that happened this step ({ type: EV.*, ...details }, events.js); the game drains this queue
    events: [] };
  locate(track, c, true);
  return c;
}

// The barrier on the car's side at its sample (runoff.js). A hit keeps BARRIERS[type].keep of the speed (a tyre wall
// soaks up more than concrete, which the car glances off). Returns the new hit's EV.WALL event (impact speed, `hard` =
// how hard it felt for sound and shake, `front` = nose-on share for damage), else null.
/** @param {Track} track @param {Car} c */
export function resolveWalls(track, c) {
  const { NX, NZ } = track, R = track.runoff[c.lat < 0 ? 0 : 1], lim = R.wall[c.idx] - WALLS.clearance;
  if (Math.abs(c.lat) <= lim) { c.wallHit = false; return null; }
  const s = Math.sign(c.lat), over = Math.abs(c.lat) - lim;
  c.x -= NX[c.idx]*s*over; c.z -= NZ[c.idx]*s*over; c.lat = s*lim;
  let th = headingAt(track, c.idx);           // nudge the heading back along the wall
  let hit = null;
  if (!c.wallHit) {
    const B = BARRIERS[R.barrier[c.idx]] || BARRIERS[0];
    hit = { impact: Math.abs(c.v * Math.sin(c.h - th)), hard: B.hard, front: Math.abs(Math.sin(c.h - th)), barrier: B.name };
    c.v *= B.keep; c.vy *= WALLS.sideways; c.yawRate *= WALLS.sideways; emit(c, EV.WALL, hit);
  }
  c.wallHit = true;
  if (Math.cos(c.h - th) < 0) th += Math.PI;
  c.h += wrapA(th - c.h) * WALLS.align;
  return hit;
}

// Surface under the car (runoff.js surfaceAt: the same layout the renderer draws). Running onto a sausage kerb
// upsets the car once: a yaw kick and a little speed lost (EV.SAUSAGE).
/** @param {Track} track @param {Car} c */
export function updateSurface(track, c) {
  const { surface, depth } = surfaceAt(track, c.idx, c.lat), was = c.surface;
  c.surface = surface; c.gravelDepth = depth;
  c.onKerb = surface === 'kerb' || surface === 'sausage';
  c.offTrack = surface in ROUGH;
  if (surface === 'sausage' && was !== 'sausage') {
    const hit = Math.min(1, Math.abs(c.v) / OFFTRACK.sausageFull);
    c.yawRate += -Math.sign(c.lat) * OFFTRACK.sausageYaw * hit; c.v *= 1 - OFFTRACK.sausageLoss * hit;
    emit(c, EV.SAUSAGE, { impact: Math.abs(c.v) * OFFTRACK.sausageImpact });
  }
}

// Beached in a gravel trap: stopped deep in it for stuckTime s. The car can't move until the marshals have lifted it
// back to the edge of the track (recoverTime s later, EV.RECOVERED); dirty tyres afterwards.
/** @param {Race} race @param {Car} c */
export function updateBeached(race, c) {
  const O = OFFTRACK, track = race.track;
  if (c.beached) {
    if (race.t - c.beachedAt < O.recoverTime) return;
    const i = c.idx, s = c.lat < 0 ? -1 : 1, R = track.runoff[s < 0 ? 0 : 1];
    const lat = s * Math.min(R.turf[i] + O.recoverLat, R.wall[i] - O.recoverWall);
    c.x = track.PX[i] + track.NX[i] * lat; c.z = track.PZ[i] + track.NZ[i] * lat; c.lat = lat; c.h = headingAt(track, i);
    c.v = c.vy = c.yawRate = 0; c.beached = false; c.stuckT = 0; c.dirt = 1; c.gear = 1; c.cutRun = 0;
    updateSurface(track, c); emit(c, EV.RECOVERED);
    return;
  }
  const stuck = c.surface === 'gravel' && c.gravelDepth > O.deep && speedOf(c) < O.stuckSpeed;
  c.stuckT = stuck ? (c.stuckT || 0) + (race.t - (c.beachClock ?? race.t)) : 0; c.beachClock = race.t;
  if (c.stuckT >= O.stuckTime) { c.beached = true; c.beachedAt = race.t; emit(c, EV.BEACHED); }
}
