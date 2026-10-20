// Pit stops and what makes them necessary: fuel, tyre wear, damage (WEAR), and the pit lane itself (PIT).
//
// The lane runs beside the main straight on the right, behind the pit wall (runoff.js leaves room for it: entry road,
// lane, exit road). A car enters when it is on the entry road (driven there), or at the start of the entry road when
// it has asked to pit (c.pitRequest: the player's BOX button, the AI's plan). From there it drives itself, as in F1
// games: down to the 80 km/h limit, into its box (one per entrant, in front of its garage), service, back out along
// the fast lane, and onto the track after the exit road. Its position follows a path along the track samples at a
// lateral offset (c.pit.p = unwrapped sample position), so laps, timing and order carry on as usual.
import { PIT, WEAR, EV, TUNING, RUNOFF } from './tuning.js';
import { pitRange } from './runoff.js';
import { DRIVERS } from './drivers.js';
import { rpmAt, GEARS } from './vehicle.js';
import { emit } from './events.js';
import { clamp, wrapA, wrapIdx, smoothstep } from './math.js';
/** @typedef {import('./types.js').Car} Car */
/** @typedef {import('./types.js').Race} Race */
/** @typedef {import('./types.js').Track} Track */


/** @typedef {{ entry: number, from: number, to: number, exit: number, wallLat: number, lane: number, boxLat: number,
 *   garageLat: number, boxes: number[] }} PitLane */
/** @typedef {{ fuelLaps: number, tyreLaps: number, damage: boolean, burnLap: number }} Wear */
/** @typedef {{ wing: number, floor: number, susp: number }} Damage */   // each 0..1
/** @typedef {{ fuel: number, fuelTo: number, wing: boolean, repair: boolean, tyres: boolean, time: number }} Service */
/** In the pit lane: p = unwrapped sample position (from p0, lateral lat0 at the entry), the car's box, phase, service
 * done at the stop (from race time `at` until `until`); done = service finished (a player then waits for the gas).
 * @typedef {{ p: number, p0: number, lat0: number, box: number, phase: 'in' | 'stop' | 'out', at: number, until: number,
 *   service: Service, done: boolean }} PitStop */

// The lane on a track (null without pits): sample ranges + lateral offsets; boxes = one per DRIVERS entry, in front
// of the garage doors world.js draws (PIT.garages: first + step·k m along from the `pits` landmark).
/** @param {Track} track @returns {PitLane} */
export function buildPitLane(track) {
  const r = pitRange(track); if (!r) return null;
  const wallLat = track.HW + RUNOFF.pitWall;
  return { ...r, wallLat, lane: wallLat + PIT.fast, boxLat: wallLat + PIT.box, garageLat: wallLat + PIT.garage,
    boxes: DRIVERS.map((d, k) => track.landmarks.pits + (PIT.garages.first + PIT.garages.step * k) / track.ds) };
}

// A car's fuel, tyres, damage and pit-stop state (part of createCar; setupWear fills the tank for the race).
export const pitState = slot => ({
  fuel: Infinity, tyreWear: 0, damage: /** @type {Damage} */ ({ wing: 0, floor: 0, susp: 0 }), pullSide: slot % 2 ? 1 : -1,   // pullSide: where damaged suspension pulls
  pit: /** @type {PitStop} */ (null), pitRequest: false, pitLimiter: false, pitStops: 0,
  warned: /** @type {{ low?: boolean, box?: boolean, out?: boolean, tyres?: boolean }} */ ({}),   // pit = { p, phase, ... } while in the lane
});

// ---------- race options ----------
// opts.wear = { fuel: 'off'|'normal'|'high', tyres: …, damage: bool } (createRace); everything off by default
/** @param {Race} race */
export function setupWear(race, opts = {}) {
  const fuelLaps = WEAR.fuel[opts.fuel] ?? 0, tyreLaps = WEAR.tyres[opts.tyres] ?? 0;
  race.wear = { fuelLaps, tyreLaps, damage: !!opts.damage, burnLap: fuelLaps ? WEAR.tank / fuelLaps : 0 };
  for (const c of race.cars) {
    Object.assign(c, pitState(c.slot));
    c.fuel = fuelLaps ? Math.min(WEAR.tank, (lapsToGo(race, c) + WEAR.reserve) * race.wear.burnLap) : Infinity;
  }
}

// laps still to drive (including the rest of this one); timed races estimate from the last lap (or WEAR.lapSpeed)
/** @param {Race} race @param {Car} c */
export function lapsToGo(race, c) {
  const done = Math.max(0, c.lap - 1) + (c.lap >= 1 ? c.idx / race.track.N : 0);
  if (race.laps < Infinity) return Math.max(0, race.laps - done);
  if (race.duration < Infinity) {
    const lap = c.lastLap || race.track.L / WEAR.lapSpeed;
    return Math.max(0, (race.duration - race.t) / lap + 1 - (c.lap >= 1 ? c.idx / race.track.N : 0));
  }
  return Infinity;
}
// laps the fuel in the tank still lasts
/** @param {Race} race @param {Car} c */
export const fuelLaps = (race, c) => race.wear?.burnLap ? c.fuel / race.wear.burnLap : Infinity;

// ---------- fuel and tyres, every step ----------
/** @param {Race} race @param {Car} c */
export function updateWear(race, c, thr, dt) {
  const W = race.wear; if (!W || c.pit || c.finished) return;
  const dist = Math.abs(c.v) * dt, L = race.track.L;
  if (W.fuelLaps && c.fuel > 0) {
    const B = WEAR.burn;
    c.fuel = Math.max(0, c.fuel - W.burnLap * dist / L * (B.idle + B.throttle * thr) / B.lap);   // ≈ 1 tank-lap per racing lap
    const left = fuelLaps(race, c), need = lapsToGo(race, c);
    if (left < need) {
      if (left < WEAR.warn.fuelLow && !c.warned.low) { c.warned.low = true; emit(c, EV.FUEL_LOW); }
      if (left < WEAR.warn.fuelBox && !c.warned.box) { c.warned.box = true; emit(c, EV.FUEL_BOX); }
    }
    if (c.fuel <= 0 && !c.warned.out) { c.warned.out = true; emit(c, EV.FUEL_OUT); }
  }
  if (W.tyreLaps) {
    c.tyreWear = Math.min(1, c.tyreWear + dist / (L * W.tyreLaps) * (1 + WEAR.slideWear * (c.slideF + c.slideR)));
    if (c.tyreWear > WEAR.warn.tyres && !c.warned.tyres) { c.warned.tyres = true; emit(c, EV.TYRES_WORN); }
  }
}

// ---------- damage (car.js walls, collide.js contacts) ----------
// impact = closing speed (m/s), front = 0..1 how much of it hit the nose, hard = how unforgiving the thing hit was
/** @param {Race} race @param {Car} c */
export function addDamage(race, c, impact, front, hard = 1) {
  if (!race.wear?.damage || impact * hard < WEAR.damage.min) return;
  const D = WEAR.damage, d = c.damage, e = impact * hard, before = { ...d };
  d.wing = Math.min(1, d.wing + e * front / D.wing);
  d.floor = Math.min(1, d.floor + e / D.floor);
  d.susp = Math.min(1, d.susp + Math.max(0, e - D.suspFrom) / D.susp);
  // a message when a part gets noticeably worse (crossing a quarter step)
  const worst = ['wing', 'floor', 'susp'].find(k => Math.floor(d[k] * D.steps) > Math.floor(before[k] * D.steps));
  if (worst) emit(c, EV.DAMAGE, { part: worst });
}
// what the damage and tyres do to the car (chassis.js): grip, front / total downforce, drag, steering pull
/** @param {Car} c */
export function carCondition(c) {
  const d = c.damage, D = WEAR.damage, w = c.tyreWear || 0;
  if (!d) return { grip: 1, front: 1, aero: 1, drag: 1, pull: 0, power: 1 };
  return { grip: (1 - WEAR.drop * w * w) * (1 - D.suspGrip * d.susp), front: 1 - D.wingLoss * d.wing, aero: 1 - D.floorLoss * d.floor,
    drag: 1 + D.floorDrag * d.floor, pull: D.suspPull * d.susp * c.pullSide, power: c.fuel > 0 ? 1 : WEAR.limp };
}

// ---------- the AI's decision (made each lap before the entry) ----------
/** @param {Race} race @param {Car} c */
export function aiWantsPit(race, c) {
  const togo = lapsToGo(race, c), A = PIT.ai;
  if (togo < A.late) return false;                                    // too late to be worth it
  if (fuelLaps(race, c) < togo + A.margin && fuelLaps(race, c) < A.fuelBelow) return true;
  if (c.tyreWear > A.tyres && togo > A.tyresLeft) return true;
  return c.damage?.wing > A.wing && togo > A.wingLeft;
}

// ---------- the pit lane ----------
/** @param {Track} track */
const at = (track, p) => wrapIdx(Math.floor(p), track.N);
/** @param {Car} c */
const boxOf = (lane, c) => lane.boxes[Math.max(0, DRIVERS.findIndex(d => d.code === c.code))];

// Called before a car's normal step: starts its pit stop at the entry road. Returns true when it is in the pit lane.
/** @param {Race} race @param {Car} c */
export function checkPitEntry(race, c) {
  const lane = race.track.pit; if (!lane || c.finished || c.pit) return !!c.pit;
  const { N } = race.track, d = wrapIdx(c.idx - lane.entry, N);
  const E = PIT.enter;
  if (d >= lane.from - lane.entry - E.latest) return false;
  const onRoad = c.lat > race.track.HW + E.road;
  if (!onRoad && !(c.pitRequest && d < E.request)) return false;
  c.pit = { p: lane.entry + d, p0: lane.entry + d, lat0: c.lat, box: boxOf(lane, c), phase: 'in', at: 0, until: 0, service: null, done: false };
  c.pitRequest = false; emit(c, EV.PIT_IN);
  return true;
}

// the pit road's centre line at p for drawing (world.js): from the road edge onto the fast lane, along it, back out
/** @param {Track} track */
export function laneCentre(track, p) {
  const L = track.pit, edge = track.HW - PIT.edge;
  if (p < L.from) return edge + (L.lane - edge) * smoothstep((p - L.entry) / (L.from - L.entry));
  if (p <= L.to) return L.lane;
  return L.lane + (edge - L.lane) * smoothstep((p - L.to) / (L.exit - L.to));
}
// lateral offset of the pit path at p (unwrapped samples)
/** @param {Race} race @param {Car} c */
function pathLat(race, c, p) {
  const lane = race.track.pit, P = c.pit;
  if (p < lane.from) return P.lat0 + (lane.lane - P.lat0) * smoothstep((p - P.p0) / (lane.from - P.p0));
  if (p <= lane.to) {
    const into = smoothstep((p - (P.box - PIT.turnIn)) / PIT.turnInLength), out = 1 - smoothstep((p - P.box) / PIT.turnOut);
    return lane.lane + (lane.boxLat - lane.lane) * (p < P.box ? into : out);
  }
  return lane.lane + (race.track.HW - PIT.edge - lane.lane) * smoothstep((p - lane.to) / (lane.exit - lane.to));
}

// the path's point at p (unwrapped samples): track position interpolated between samples + the lateral offset
/** @param {Race} race @param {Car} c */
function pathPoint(race, c, p) {
  const T = race.track, i = at(T, p), j = (i + 1) % T.N, f = p - Math.floor(p), lat = pathLat(race, c, p);
  const nx = T.NX[i] + (T.NX[j] - T.NX[i]) * f, nz = T.NZ[i] + (T.NZ[j] - T.NZ[i]) * f;
  return [T.PX[i] + (T.PX[j] - T.PX[i]) * f + nx * lat, T.PZ[i] + (T.PZ[j] - T.PZ[i]) * f + nz * lat];
}
// direction of the path at p (central difference over a sample, so it turns smoothly instead of per sample)
/** @param {Race} race @param {Car} c */
function pathHeading(race, c, p) {
  const a = pathPoint(race, c, p - 0.5), b = pathPoint(race, c, p + 0.5);
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

// One step of a car in the pit lane (instead of the driving model). Moves it along the path; the caller runs afterMove.
// go = the driver lets it leave once the service is done (drivePlayer: the gas; the AI always)
/** @param {Race} race @param {Car} c */
export function stepPit(race, c, dt, go = true) {
  const T = race.track, lane = T.pit, P = c.pit, ds = T.ds, S = PIT.show;
  c.pitRequest = false;                                               // already in
  let v = Math.max(0, c.v), accel = 0;
  if (P.phase === 'in') {
    const toBox = (P.box - P.p) * ds;
    const target = Math.min(PIT.speed, Math.sqrt(2 * PIT.boxBrake * Math.max(0, toBox)));
    v = v > target ? Math.max(target, v - PIT.brake * dt) : Math.min(target, v + PIT.accel * dt);
    if (toBox < PIT.stopAt || (toBox < PIT.creep.within && v < PIT.creep.below)) {
      v = 0; P.p = P.box; P.phase = 'stop';
      P.service = service(race, c); P.at = race.t; P.until = race.t + P.service.time; emit(c, EV.PIT_STOP, { service: P.service });
    }
  } else if (P.phase === 'stop') {
    v = 0;
    if (!P.done && race.t >= P.until) { applyService(race, c, P.service); P.done = true; emit(c, EV.PIT_READY); }
    if (P.done && go) { P.phase = 'out'; emit(c, EV.PIT_GO); }
  } else {
    const limit = P.p < lane.to ? PIT.speed : TUNING.V_CAP;            // the limiter ends with the pit lane
    accel = P.p < lane.to ? PIT.accel : PIT.exitAccel; v = Math.min(limit, v + accel * dt);
  }
  const p0 = P.p; P.p += v * dt / ds;
  // place the car on the path, pointing along it; the front wheels steer by the path's curvature (bicycle geometry)
  // and the wheels roll with the distance, so it drives into the box instead of sliding there
  const [x, z] = pathPoint(race, c, P.p), h0 = pathHeading(race, c, P.p);
  c.x = x; c.z = z;
  if (P.phase !== 'stop') c.h = h0;
  const k = wrapA(pathHeading(race, c, P.p + 0.6) - pathHeading(race, c, P.p - 0.6)) / (1.2 * ds);
  const steer = clamp(Math.atan(S.wheelbase * k) / S.wheelLock, -1, 1);
  if (v > 0.05) c.steer += (steer - c.steer) * Math.min(1, dt * S.steerRate);
  c.roll += v * dt / TUNING.WHEEL_RADIUS;
  c.v = v; c.vy = 0; c.yawRate = 0; c.slideF = c.slideR = 0; c.lockF = c.spinR = false;
  c.thr = P.phase === 'out' ? S.thrOut : S.thrIn; c.brake = P.phase === 'in' && v < PIT.speed - 0.5 && P.p - p0 > 0 ? S.brake : 0;
  c.gear = 1; while (c.gear < GEARS && rpmAt(v, c.gear) > S.upshift) c.gear++;
  c.rpm = Math.max(S.idle, rpmAt(v, c.gear)); c.ax = 0; c.surface = 'tarmac';
  c.pitLimiter = P.p < lane.to && P.phase !== 'stop';
  if (P.p >= lane.exit) {                                             // back on the track
    const i = at(T, P.p), t = Math.atan2(T.TZ[i], T.TX[i]);
    c.h = t + wrapA(c.h - t); c.pit = null; c.pitLimiter = false;
    c.offset = pathLat(race, c, P.p); emit(c, EV.PIT_OUT);
  }
}

// The stop's jobs one after another (the time adds up to service.time): tyres always, then fuel, a new front wing,
// repairs. The pit crew (game: pit-crew.js) acts them out; [{ job, from, to }] in s from the stop.
/** @param {Service} s */
export function serviceSteps(s) {
  const out = [{ job: 'tyres', from: 0, to: PIT.base }];
  let t = PIT.base;
  const add = (job, d) => { if (d > 0.01) { out.push({ job, from: t, to: t + d }); t += d; } };
  add('fuel', Number.isFinite(s.fuel) ? s.fuel / PIT.refuel : 0);
  add('wing', s.wing ? PIT.wing : 0);
  add('repair', Math.max(0, s.time - t));
  return out;
}

// what the crew does: always tyres; fuel for the rest of the race (+ reserve, at most a full tank); a new front
// wing if it is damaged; floor and suspension repaired
/** @param {Race} race @param {Car} c @returns {Service} */
function service(race, c) {
  const W = race.wear, d = c.damage || { wing: 0, floor: 0, susp: 0 };
  const fuelTo = W?.fuelLaps ? Math.min(WEAR.tank, (lapsToGo(race, c) + WEAR.reserve) * W.burnLap) : c.fuel;
  const fuel = Math.max(0, fuelTo - c.fuel), wing = d.wing > PIT.wingFrom, repair = d.floor + d.susp;
  const time = PIT.base + (Number.isFinite(fuel) ? fuel / PIT.refuel : 0) + (wing ? PIT.wing : 0) + PIT.repair * Math.min(1, repair);
  return { fuel, fuelTo, wing, repair: repair > PIT.repairFrom, tyres: true, time };
}
/** @param {Race} race @param {Car} c */
function applyService(race, c, s) {
  if (Number.isFinite(s.fuelTo)) c.fuel = s.fuelTo;
  c.tyreWear = 0; if (c.damage) c.damage = { wing: 0, floor: 0, susp: 0 };
  c.pitStops++; c.dirt = 0; c.warned = {};
}
