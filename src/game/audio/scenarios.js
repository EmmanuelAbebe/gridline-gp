// Scripted test scenes for the sound (Settings → Sound → Test sounds, and tools/sound-check renders them offline).
// Each scene: label, seconds, mix, and at(t) → the parts of the frame state that change; events(t0, t1) → one-shots.
const GEARS_KMH = [0, 108, 142, 174, 205, 235, 265, 296, 340];   // km/h at 12 000 rpm per gear (tuning.js gearbox.top)
const rpmFor = (kmh, gear) => kmh / GEARS_KMH[gear] * 12000;
const listenerAt = (x, y, z, fx = 1, fz = 0) => ({ x, y, z, fx, fy: 0, fz, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0 });
const car = o => ({ rpm: 4000, thr: 0, brk: 0, speed: 0, gear: 1, limiter: false, slideF: 0, slideR: 0, lockF: false, spinR: false,
  surface: 'track', onKerb: false, slip: 0, beepRpm: 11800, ...o });

// a rival driving past along +x at `kmh`, 12 m from a listener standing still beside the track (looking at the track)
const passBy = kmh => ({
  label: `Pass-by at ${kmh} km/h`, seconds: 6, mix: 'tv', playerOn: false,
  at(t) {
    const v = kmh / 3.6, x = (t - 3) * v, gear = GEARS_KMH.findIndex(g => g > kmh * 1.02) || 8;
    return { listener: listenerAt(0, 1.2, -12, 0, 1), player: car({}),
      rivals: [{ id: 'R', x, y: 0.6, z: 0, vx: v, vz: 0, rpm: rpmFor(kmh, gear), thr: 1, gear }] };
  },
});

export const SCENARIOS = {
  steady: { label: 'Steady 10 000 rpm, full throttle (outside)', seconds: 3, mix: 'tv',
    at() { return { listener: listenerAt(0, 1, 0), player: car({ rpm: 10000, thr: 1, gear: 5, speed: 60 }), rivals: [] }; } },
  rev: { label: 'Rev sweep (cockpit)', seconds: 7, mix: 'driver',
    at(t) {   // idle → limiter over 4 s, hold the limiter 1 s, lift (overrun pops) and let it fall
      const up = Math.min(1, t / 4), rpm = t < 5 ? 4000 + 8500 * up : Math.max(4000, 12500 - (t - 5) * 4500);
      return { listener: listenerAt(0, 1, 0), player: car({ rpm, thr: t < 5 ? 1 : 0, limiter: t > 4 && t < 5 }), rivals: [] };
    } },
  shifts: { label: 'Upshifts 1 → 8 (cockpit)', seconds: 8, mix: 'driver',
    at(t) {   // full throttle, each gear revs to 11 800 and shifts
      let kmh = 0, gear = 1;
      kmh = Math.min(330, 40 + 290 * (1 - Math.exp(-t / 3.2)));
      while (gear < 8 && rpmFor(kmh, gear) > 11800) gear++;
      return { listener: listenerAt(0, 1, 0), player: car({ rpm: rpmFor(kmh, gear), thr: 1, gear, speed: kmh / 3.6 }), rivals: [] };
    } },
  downshifts: { label: 'Braking, downshifts 8 → 2 (cockpit)', seconds: 4, mix: 'driver',
    at(t) {
      const kmh = Math.max(90, 320 - t * 75); let gear = 8;
      while (gear > 2 && rpmFor(kmh, gear - 1) < 11000) gear--;
      return { listener: listenerAt(0, 1, 0), player: car({ rpm: rpmFor(kmh, gear), thr: 0, brk: 1, gear, speed: kmh / 3.6 }), rivals: [] };
    } },
  pass100: passBy(100), pass200: passBy(200), pass300: passBy(300),
  lockup: { label: 'Lock-up and tyre squeal', seconds: 4, mix: 'tv',
    at(t) {
      const kmh = Math.max(40, 180 - t * 40);
      return { listener: listenerAt(0, 1, 0), player: car({ rpm: rpmFor(kmh, 4), gear: 4, speed: kmh / 3.6, brk: 1,
        lockF: t > 0.4 && t < 1.8, slideF: t < 1.8 ? 0.9 : 0.4, slideR: t > 2.2 ? 0.6 : 0 }), rivals: [] };
    } },
  kerbs: { label: 'Kerbs, grass, gravel', seconds: 6, mix: 'driver',
    at(t) {
      const surface = t < 2 ? 'track' : t < 4 ? 'grass' : 'sand';
      return { listener: listenerAt(0, 1, 0), player: car({ rpm: 9000, thr: 0.5, gear: 3, speed: 120 / 3.6, onKerb: t < 2 && t > 0.5, surface }), rivals: [] };
    } },
  overtake: { label: 'Overtaken at 280 km/h (cockpit)', seconds: 5, mix: 'driver',
    at(t) {   // you at 250, a car 3 m to your right at 290 passing at t = 2.5 s
      const v = 250 / 3.6, vr = 290 / 3.6, me = v * t, x = me + (t - 2.5) * (vr - v);
      return { listener: { ...listenerAt(me, 1, 0), vx: v }, player: car({ rpm: rpmFor(250, 6), thr: 1, gear: 6, speed: v, slip: t > 2.5 ? 0.6 : 0 }),
        rivals: [{ id: 'R', x, y: 0.6, z: 3, vx: vr, vz: 0, rpm: rpmFor(290, 7), thr: 1, gear: 7 }] };
    },
    events: (a, b) => a < 2.5 && b >= 2.5 ? [{ whoosh: [1, 0.8] }] : [] },
};

// Runs a scene: frame(state, t) for t in steps of 1/60 s from `start` (context time). `schedule(fn)` = how frames
// are paced: live uses setInterval (returns a stop function), offline calls them all at once. onDone when it ends.
export function playScenario(engine, name, start, live = true, onDone = () => {}) {
  const sc = SCENARIOS[name], dt = 1 / 60, base = { active: true, doppler: true, shiftBeep: false, mix: sc.mix, playerOn: sc.playerOn };
  let k = 0, timer = 0;
  const step = () => {
    const t = k * dt, at = start + t;
    engine.frame({ ...base, ...sc.at(t), dt }, live ? engine.ctx.currentTime : at);
    for (const e of sc.events?.(t - dt, t) || []) if (e.whoosh) engine.whoosh(...e.whoosh, live ? engine.ctx.currentTime : at);
    k++;
    if (t >= sc.seconds) { clearInterval(timer); engine.frame({ ...base, ...sc.at(sc.seconds), active: false, dt }, live ? engine.ctx.currentTime : at + dt); onDone(); return false; }
    return true;
  };
  if (!live) { while (step()); return () => {}; }
  timer = setInterval(step, dt * 1000);
  return () => { clearInterval(timer); engine.frame({ ...base, ...sc.at(0), active: false, dt }); };
}
