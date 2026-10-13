// Game tunables: timings, sounds, colours, graphics profiles, race setup limits, phases.
export const CONFIG = Object.freeze({
  physicsStep: 1 / 120,
  maxFrameDt: 0.1,
  sky: 0xa8cbe6,
  storageKeys: { gfx: 'gridline.gfx', design: 'gridline.design', race: 'gridline.race' },
  lights: { count: 5, interval: 0.9, holdMin: 0.4, holdRand: 1.8, hideAfterGo: 0.7 },
  resultsDelay: 2.2,           // seconds of race time after the chequered flag
  finalLapFlashDelay: 0.9,
  finishedAiSkill: 0.62,       // cool-down pace once a car has finished
  towerInterval: 0.2,
  mapInterval: 1 / 30,
  fps: { window: 0.5, low: 50, adaptBelow: 52, slowWindowsToAdapt: 2 },
  padDeadZone: 0.035,
  // rev lights: first LED at `from` rpm, all lit at the automatic upshift point (shift now)
  revLights: { from: 8500 },
});

export const SFX = Object.freeze({
  light: [660, 0.12], go: [990, 0.35],
  // impacts: noise low-pass cutoff (Hz), thump pitch (Hz), impact speeds (m/s): silent below `min`, full volume at `fullAt`
  wall:    { cutoff: 700,  thump: 55,  min: 0,   fullAt: 25 },
  contact: { cutoff: 1800, thump: 110, min: 1.0, fullAt: 15 },
});

export const COLORS = Object.freeze({
  grass: 0x4a7530, grassStripe: 0x527f36, sand: 0xcab98f, asphalt: [0x4e5157, 0x52555b], paint: 0xf4f4f0,
  kerb: [0xf4f4f0, 0xd92b2b], barrier: [0x2b62c9, 0xe8e8e4], steel: 0x23272e, lampOn: 0xff2020, lampOff: 0x330a0a,
  stand: 0x8f969e, roof: 0xe6e8ea, pits: 0xf0f1f2, glass: 0x1d2a38, trunk: 0x5b4330, hill: 0x7f9c78, carDark: 0x18191c, tyre: 0x121212,
  crowd: [0xffc21a, 0xd7261e, 0x2e6bff, 0xf4f4f0, 0x0b8a3e, 0xff6a13, 0x7a3cff, 0x222222, 0x00a19c],
});

// Everything Quality vs Performance changes, in one place.
const DPR = window.devicePixelRatio || 1;
export const GFX_PROFILES = Object.freeze({
  quality: {
    label: 'Quality mode', antialias: true,
    renderScales: [2, 1.75, 1.5, 1.25, 1, 0.85, 0.7].filter(v => v <= Math.max(1, DPR) + 0.01), startScale: Math.min(DPR, 1.5),
    lambertCars: false, treeFraction: 1, crowd: 1500, stripes: true, hills: true, fog: [220, 1500], far: 3000,
    note: weakGpu => weakGpu ? 'Performance mode is recommended for this GPU.' : 'Full detail.',
  },
  perf: {
    label: 'Performance mode', antialias: false,
    renderScales: [1, 0.85, 0.75, 0.65, 0.55, 0.5], startScale: 1,
    lambertCars: true, treeFraction: 0.4, crowd: 450, stripes: false, hills: false, fog: [160, 850], far: 950,
    note: () => 'No edge smoothing, lower resolution, lighter scenery.',
  },
});

// Start-screen race setup: limits and the default choice (the last choice is remembered).
export const RACE_SETUP = Object.freeze({
  defaults: { cars: 10, type: 'laps', laps: 3, minutes: 10, gearbox: 'auto' },
  maxLaps: 99,
  minutes: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120],   // stepper stops for timed races
});

export const PHASE = Object.freeze({ MENU: 'menu', LIGHTS: 'lights', RACE: 'race', DONE: 'done' });
