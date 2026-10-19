// Where each car is drawn this frame: its sim position (x, z, h) interpolated between the last two fixed steps
// (main.js). Kept here, not on the sim's car objects, so the car state stays the simulation's own.
import { SIM } from '../sim/index.js';

const poses = new WeakMap();
// { x, z, h } to draw (+ the previous step's px, pz, ph); a car seen for the first time is drawn where it is
export function poseOf(c) {
  let p = poses.get(c);
  if (!p) { p = { x: c.x, z: c.z, h: c.h, px: c.x, pz: c.z, ph: c.h }; poses.set(c, p); }
  return p;
}
// before a sim step: remember where the cars were
export function savePoses(cars) { for (const c of cars) { const p = poseOf(c); p.px = c.x; p.pz = c.z; p.ph = c.h; } }
// a = 0..1 of the way from the previous step to the current one (1 = exactly the sim state)
export function interpolatePoses(cars, a) {
  for (const c of cars) {
    const p = poseOf(c);
    p.x = p.px + (c.x - p.px) * a; p.z = p.pz + (c.z - p.pz) * a; p.h = p.ph + SIM.wrapA(c.h - p.ph) * a;
  }
}
