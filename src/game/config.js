// Game tunables: timings, sounds, colours, graphics profiles, race setup limits, phases.
import { SIM } from '../sim/index.js';

export const CONFIG = Object.freeze({
  physicsStep: 1 / 120,
  maxFrameDt: 0.1,
  sky: 0xa8cbe6,
  storageKeys: { gfx: 'gridline.gfx', design: 'gridline.design', race: 'gridline.race', prefs: 'gridline.prefs', garage: 'gridline.garage', records: 'gridline.records' },
  lights: { count: 5, interval: 0.9, holdMin: 0.4, holdRand: 1.8, hideAfterGo: 0.7 },
  resultsDelay: 2.2,           // seconds of race time after the chequered flag
  finalLapFlashDelay: 0.9,
  finishedAiSkill: 0.62,       // cool-down pace once a car has finished
  towerInterval: 0.2,
  mapInterval: 1 / 30,
  fps: { window: 0.5, low: 50, adaptBelow: 52, slowWindowsToAdapt: 2 },
  // rev lights: first LED at `from` rpm, all lit at the automatic upshift point (shift now)
  revLights: { from: 8500 },
});

export const SFX = Object.freeze({
  light: [660, 0.12], go: [990, 0.35], cut: [330, 0.18],   // beeps: [Hz, s]; cut = track-limits warning
  // impacts: noise low-pass cutoff (Hz), thump pitch (Hz), impact speeds (m/s): silent below `min`, full volume at `fullAt`
  wall:    { cutoff: 700,  thump: 55,  min: 0,   fullAt: 25 },
  contact: { cutoff: 1800, thump: 110, min: 1.0, fullAt: 15 },
  kerbStrike: { cutoff: 900, thump: 80, min: 0, fullAt: 20 },
});

export const COLORS = Object.freeze({
  grass: 0x4a7530, grassStripe: 0x527f36, sand: 0xcab98f, asphalt: [0x4e5157, 0x52555b], paint: 0xf4f4f0,
  kerb: [0xf4f4f0, 0xd92b2b], barrier: [0x2b62c9, 0xe8e8e4], steel: 0x23272e, lampOn: 0xff2020, lampOff: 0x330a0a,
  stand: 0x8f969e, roof: 0xe6e8ea, pits: 0xf0f1f2, glass: 0x1d2a38, trunk: 0x5b4330, hill: 0x7f9c78, carDark: 0x18191c, tyre: 0x121212,
  turf: [0x2f7a3c, 0x2b7238], tarmacRunoff: [0x5d6066, 0x595c62], gravel: [0xa08b67, 0x9d8865], sausage: [0xf2c81a, 0x1c1c1c],
  armco: 0xaeb4ba, armcoPost: 0x6d737a, tyreWall: 0x1b1b1d, tyreBelt: [0xd92b2b, 0xf4f4f0], tecpro: [0xd92b2b, 0x2b62c9],
  concrete: 0xc3c5c8, fence: 0x9aa1a8, board: 0x1d4fa8, marshal: 0xff7a1a, water: 0x2f5f7f,
  crowd: [0xffc21a, 0xd7261e, 0x2e6bff, 0xf4f4f0, 0x0b8a3e, 0xff6a13, 0x7a3cff, 0x222222, 0x00a19c],
});

// Scenery per circuit (track.theme; render-only). ground: grass colours; trees: how many, which kinds (cone = pine,
// ball = broadleaf), hills: how many and how big; water: lakes (count, radius) or a harbour (`sea`: the side of the
// circuit's bounding box); buildings: city blocks around a street circuit; rocks: moorland boulders.
export const THEMES = Object.freeze({
  forest:  { ground: [0x4a7530, 0x527f36], trees: 520, kinds: ['cone'], hills: { count: 18, size: 1 }, stripes: true },
  downs:   { ground: [0x5d8b3c, 0x679544], trees: 170, kinds: ['ball', 'ball', 'cone'], hills: { count: 26, size: 1.5, low: true }, stripes: true },
  harbour: { ground: [0x5c6166, 0x62676c], trees: 60, kinds: ['ball'], hills: { count: 10, size: 1.8 }, buildings: 260, sea: 'south', stripes: false },
  woods:   { ground: [0x47702f, 0x4f7a35], trees: 760, kinds: ['cone', 'ball'], hills: { count: 22, size: 1.2, near: true }, stripes: true },
  moor:    { ground: [0x6d7a44, 0x75824a], trees: 90, kinds: ['cone'], hills: { count: 20, size: 1.3 }, lakes: [3, 70], rocks: 220, stripes: true },
});
// Advertising boards: invented brands only (the teams plus a few made-up sponsors)
export const BRANDS = Object.freeze([
  ['GRIDLINE', '#ffc21a', '#111'], ['HALCYON', '#2e6bff', '#fff'], ['KESTREL', '#d7261e', '#fff3e0'], ['MERIDIAN', '#00a19c', '#0d2b2a'],
  ['VOLTA ENERGY', '#111', '#b9ff3b'], ['NORTHWIND', '#f4f4f0', '#1d4fa8'], ['ORYX', '#e9e9e6', '#c8102e'], ['STRATA', '#ff6a13', '#1a1a1a'],
]);

// Everything Quality vs Performance changes, in one place.
const DPR = globalThis.devicePixelRatio || 1;   // globalThis: also loads in Node (tests)
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
const levels = keys => keys.map(k => [k, k.toUpperCase()]);
// rival pace: scales every AI driver's skill (SIM createRace aiPace). Lap times: the fastest rival alone, measured
// with tools/sim-test.mjs-style solo laps on Elkmoor (traffic and dirty air make race laps a little slower)
const AI_LEVELS = {
  rookie: { pace: 0.8,  note: 'Rivals take it easy (Elkmoor: fastest laps about 36 s).' },
  club:   { pace: 0.88, note: 'Quick club drivers (Elkmoor: about 34 s).' },
  pro:    { pace: 0.95, note: 'Racing drivers (Elkmoor: about 33 s).' },
  legend: { pace: 1.03, note: 'On the limit everywhere (Elkmoor: about 32 s).' },
};
export const RACE_SETUP = Object.freeze({
  defaults: { cars: 10, type: 'laps', laps: 3, minutes: 10, gearbox: 'auto', assists: 'medium', ai: 'pro', fuel: 'normal', tyres: 'normal', damage: 'on', aero: 'on', overtake: 'auto' },
  aiLevels: AI_LEVELS,
  // Every setup choice that is one of a list: [value, button label]. The saved setup is checked against these (an
  // unknown value falls back to the default), the Settings screen and the start menu draw their buttons from them,
  // and assists / fuel / tyres follow the SIM tables, so a new level there shows up here by itself.
  choices: {
    type: [['laps', 'LAPS'], ['timed', 'TIMED'], ['unlimited', 'UNLIMITED']],
    ai: levels(Object.keys(AI_LEVELS)),
    gearbox: [['auto', 'AUTO'], ['semi', 'SEMI-AUTO'], ['manual', 'MANUAL']],
    assists: levels([...Object.keys(SIM.ASSISTS), 'custom']),
    fuel: levels(Object.keys(SIM.WEAR.fuel)),
    tyres: levels(Object.keys(SIM.WEAR.tyres)),
    damage: levels(['off', 'on']),
    aero: levels(['off', 'on']),
    overtake: [['auto', 'AUTO'], ['button', 'BUTTON'], ['off', 'OFF']],
  },
  assistNotes: {
    off: 'No help: the car can spin, lock its brakes and spin its wheels.',
    low: 'Some help with steering and slides; wheel spin and lock-ups are still possible.',
    medium: 'Steering matched to grip, slides caught, no wheel spin or lock-ups.',
    high: 'Everything on, plus a calmer car for on/off keyboard steering.',
    custom: 'Pick each assist yourself below.',
  },
  // Custom assists: each one OFF / LOW / ON; ON = the MEDIUM preset's strength (SIM.ASSISTS.medium)
  customLevels: { off: 0, low: 0.5, on: 1 },
  customDefault: { steer: 'on', stability: 'on', tc: 'on', abs: 'on' },
  maxLaps: 99,
  minutes: [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120],   // stepper stops for timed races
});
// a choice's label as a word in a sentence: 'SEMI-AUTO' → 'Semi-auto'
export const choiceWord = (key, value) => {
  const label = RACE_SETUP.choices[key].find(([v]) => v === value)?.[1] ?? String(value);
  return label[0] + label.slice(1).toLowerCase();
};

// Settings screen values (saved in localStorage `gridline.prefs`). Controller values only touch a wheel/pad's analog
// steering and triggers; the keyboard keeps its own steering ramp (SIM drivePlayer).
export const PREFS = Object.freeze({
  defaults: {
    smoothing: 0,        // controller steering smoothing level, 0 = off (the steering goes straight to the car)
    deadZone: 3.5,       // % of steering travel ignored around the centre
    range: 100,          // % of the controller's travel that gives full lock
    curve: 1,            // steering response exponent: 1 = linear, more = finer near the centre
    calm: 100,           // % calm steering at speed (SIM drivePlayer calm): small tilts as gentle as the original game
    pedalDeadZone: 0,    // % of trigger travel ignored at rest
    volume: 80, muted: false, showFps: true,
    engineVol: 100, fxVol: 100, ambVol: 100,   // % per sound bus
    doppler: true, shiftBeep: false,
    shake: 70,           // % camera shake (close passes, dirty air)
    controller: 'auto',  // the device that drives: 'auto' (phone, then a standard pad, then any) or a device key (controllers.js)
    phoneLink: 'wifi',   // how the phone wheel connects (desktop app): wifi / bluetooth / usb (desktop/phone-net.cjs)
    phoneAuto: false,    // start the phone wheel with the game
  },
  // text prefs with a fixed set of values (others keep any string)
  options: { phoneLink: ['wifi', 'bluetooth', 'usb'] },
  smoothingRate: 40,     // smoothing level n: the steering moves at most 40/n of full lock per second
  limits: { smoothing: [0, 10, 1], deadZone: [0, 20, 0.5], range: [40, 100, 5], curve: [1, 3, 0.1], calm: [0, 100, 10], pedalDeadZone: [0, 20, 1], volume: [0, 100, 5],
    engineVol: [0, 150, 5], fxVol: [0, 150, 5], ambVol: [0, 150, 5], shake: [0, 150, 10] },
});

export const PHASE = Object.freeze({ MENU: 'menu', LIGHTS: 'lights', RACE: 'race', DONE: 'done' });
