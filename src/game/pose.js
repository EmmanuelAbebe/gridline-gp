// Where each car is drawn this frame: its sim position (x, z, h) interpolated between the last two fixed steps
// (main.js). Kept here, not on the sim's car objects, so the car state stays the simulation's own.
// On a hilly circuit (setPoseTrack) also its height and how the road tilts it: y, pitch (nose up +), roll (+ = leaning
// over to the right, the right side down: three.js rotation.x of the car); 0 on the flat. A car in the air (SIM c.air)
// adds its height, pitch and roll: y / pitch / roll = the whole car (the model, the cockpit view), road* = the road
// alone (the chase cameras, tyre marks), air* = the air part.
import { SIM } from '../sim/index.js';

const poses = new WeakMap();
let track = null;
// the circuit the cars are on (main.js setTrack)
export function setPoseTrack(t) { track = t; }
// { x, z, h, y, pitch, roll } to draw (+ the previous step's px, pz, ph); a car seen for the first time is drawn where it is
export function poseOf(c) {
  let p = poses.get(c);
  if (!p) { p = { x: c.x, z: c.z, h: c.h, px: c.x, pz: c.z, ph: c.h, y: 0, pitch: 0, roll: 0, roadY: 0, roadPitch: 0, roadRoll: 0,
    airY: 0, airPitch: 0, airRoll: 0, pa: [0, 0, 0] }; poses.set(c, p); ground(c, p); }
  return p;
}
// before a sim step: remember where the cars were
export function savePoses(cars) { for (const c of cars) { const p = poseOf(c), A = c.air ?? upright(c.upset); p.px = c.x; p.pz = c.z; p.ph = c.h; p.pa = [A.y, A.pitch, A.roll]; } }
// a car lying on its side (lifted by its half-width) or its back (by the halo's height) after a flip (SIM c.upset), or upright
const FLAT = { y: 0, pitch: 0, roll: 0 };
function upright(u) {
  if (!u) return FLAT;
  const up = Math.cos(u.pitch) * Math.cos(u.roll);
  return { pitch: u.pitch, roll: u.roll, y: Math.max(0.9 * Math.abs(Math.sin(u.roll)), up < 0 ? 1.0 : 0) };
}
// a = 0..1 of the way from the previous step to the current one (1 = exactly the sim state)
export function interpolatePoses(cars, a) {
  for (const c of cars) {
    const p = poseOf(c);
    p.x = p.px + (c.x - p.px) * a; p.z = p.pz + (c.z - p.pz) * a; p.h = p.ph + SIM.wrapA(c.h - p.ph) * a;
    const A = c.air ?? upright(c.upset), [y0, pi0, r0] = p.pa;
    p.airY = A.y * a + y0 * (1 - a); p.airPitch = A.pitch * a + pi0 * (1 - a); p.airRoll = A.roll * a + r0 * (1 - a);
    ground(c, p);
  }
}
// the road under the drawn position: height, and the slopes along / across the car (from the track's grade and bank)
function ground(c, p) {
  road(c, p);
  p.roadY = p.y; p.roadPitch = p.pitch; p.roadRoll = p.roll;
  p.y += p.airY || 0; p.pitch += p.airPitch || 0; p.roll += p.airRoll || 0;
}
function road(c, p) {
  const E = track?.elev; if (!E) { p.y = p.pitch = p.roll = 0; return; }
  const T = track, i = c.idx, s = SIM.samplePos(T, i, p.x, p.z), lat = (p.x - T.PX[i]) * T.NX[i] + (p.z - T.PZ[i]) * T.NZ[i];
  p.y = SIM.surfaceY(T, s, lat);
  const a = SIM.wrapIdx(Math.floor(s), T.N), b = SIM.wrapIdx(a + 1, T.N), f = s - Math.floor(s);
  const sx = E.SX[a] + (E.SX[b] - E.SX[a]) * f, grade = sx / Math.sqrt(1 - sx * sx);
  const side = Math.abs(lat) <= T.HW ? Math.tan(E.BANK[a] + (E.BANK[b] - E.BANK[a]) * f) : 0;
  const cd = Math.cos(p.h) * T.TX[i] + Math.sin(p.h) * T.TZ[i], sd = Math.sin(p.h) * T.TX[i] - Math.cos(p.h) * T.TZ[i];
  p.pitch = Math.atan(grade * cd + side * sd); p.roll = -Math.atan(side * cd - grade * sd);
}
