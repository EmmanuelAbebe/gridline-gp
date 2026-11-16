// The cars' rear lights (2026-11-16, the canvas "Gridline livery & lights", L2): real F1 cars have no brake lights. The light
// on the crash structure and the two on the endplates flash while the car harvests energy (about 2 a second; fast when it
// super clips: harvesting at full throttle), and stay on with the pit limiter, in the pit lane and while the car is stopped
// off the road or being recovered. Settings → Graphics Rear lights: 'real', 'realBrake' (as real + on under hard braking, to
// read the car ahead in a pack), 'brake' (brake lights, as before). Pure (tests/rear-lights.test.js); car-glb.js lights them.
//   harvest: kW of charging that counts; slow / fast: flashes per second; hard: brake pedal for realBrake;
//   heat: the exhaust's glow (livery.js parts.glow): up over `rise` s at full throttle above `speed` m/s, down over `fall` s
export const REAR_LIGHTS = Object.freeze({ harvest: 3, slow: 2, fast: 6.25, hard: 0.5, heat: Object.freeze({ rise: 3, fall: 1.5, thr: 0.9, speed: 30 }) });

// how lit the lights want to be (0..1) and whether they flash (they then switch at once), for a car at `clock` s
export function rearLightWant(car, mode, clock, R = REAR_LIGHTS) {
  if (mode === 'brake') return { want: car.brake > 0.05 ? Math.min(1, 0.6 + car.brake) : 0, flash: false };
  const harvest = (car.ersKw ?? 0) < -R.harvest, clip = harvest && (car.thr ?? 0) > 0.9;
  let want = 0, flash = false;
  if (car.limiterOn || car.pit || car.beached || car.upset) want = 1;
  else if (harvest) { want = (clock * (clip ? R.fast : R.slow)) % 1 < 0.5 ? 1 : 0; flash = true; }
  if (mode === 'realBrake' && car.brake > R.hard) want = Math.max(want, 0.8);
  return { want, flash };
}
// the exhaust's heat after dt s
export function exhaustHeat(heat, car, dt, H = REAR_LIGHTS.heat) {
  const hot = (car.thr ?? 0) > H.thr && Math.abs(car.v ?? 0) > H.speed;
  return Math.min(1, Math.max(0, heat + (hot ? dt / H.rise : -dt / H.fall)));
}
