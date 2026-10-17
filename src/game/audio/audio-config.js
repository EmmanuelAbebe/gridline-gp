// Sound tunables (everything the synthesis and the mix use), in one table. Gains are linear, frequencies Hz.
// SOUND is live: the Sound Studio (sound-studio.js) edits its leaf values in place and saves the changes
// (localStorage gridline.sound); SOUND_DEFAULTS keeps the shipped values.
//
// The engine is a modern 1.6 l V6 turbo hybrid, as a physical model (engine-worklet.js): a 4-stroke V6 fires 3 times
// per crank revolution (the main tone: rpm / 60 × 3 = 600 Hz at 12 000 rpm); the cylinders differ a little and every
// firing varies, so the sound repeats only every 2 revolutions (energy at all half orders); the pulses ring through
// exhaust pipes whose resonances stay fixed while the rpm changes.
const DEFAULTS = {
  speedOfSound: 343,           // m/s, for Doppler
  engine: {
    order: 1.5,                // rpm / 60 × order = the half-order base (used by tools/soundlab's pitch check)
    model: {
      decay: 0.25,             // a firing's pressure pulse decays over this share of the gap to the next firing
      sharpness: 0.05,         // rise time / decay time: lower = sharper, more bark
      coast: 0.22,             // pulse strength off the throttle (1 = as on full throttle)
      noise: 0.5,              // combustion noise in every pulse (the grit)
      spread: 0.3,             // how different the 6 cylinders are (the 2-revolution "grunt")
      jitter: 0.15,            // random strength change per firing
      timing: 0.006,           // random timing change per firing (share of a cycle)
      soundSpeed: 600,         // m/s in the hot exhaust gas
      pipe1: 0.5, pipe2: 0.95, pipe3: 1.7,   // m: primaries, collector, tailpipe (their round trips are the resonances)
      mix1: 0.5, mix2: 0.35, mix3: 0.3,
      feedback: 0.62,          // how strongly the pipes ring
      damping: 0.75,           // 1 = the reflections keep their highs, lower = warmer
      gain: 1.4,
    },
    drive: { coast: 0.6, load: 1.5 },   // into a tanh shaper: more = rasp
    tone: { base: 3500, rpm: 2500, load: 2500 },   // exhaust low-pass: base + rpm share × rpm + throttle × load
    gain: { idle: 0.16, load: 0.34, rpm: 0.18 },
    limiterHz: 17,             // rev-limiter cut-in rate
    crackle: { rate: 18, minRpm: 7200, gain: 0.25 },   // pops per second on the overrun at high rpm
    intake: { gain: 0.28, cutoff: 420 },              // airbox roar (cockpit): low-passed pulses + rush of air
    turbo: { low: 1800, high: 5200, gain: 0.007, spoolUp: 0.22, spoolDown: 0.45, chirp: 0.06 },
    ers: { ratio: 8, gain: 0.005, harvest: 0.006 },  // MGU-K whine: rpm / 60 × ratio; deploying on the throttle, harvesting on the brakes
  },
  // rival engines: the same waves, fewer layers; only the nearest few play
  rivals: { voices: 4, maxDistance: 520, gain: 1.3, refDistance: 9, rolloff: 1.15,
    air: { full: 16000, perMetre: 120, min: 650 } },   // air absorption: low-pass = full × e^(−d / perMetre)
  shift: { crack: 0.32, clunk: 0.30, blip: 0.26, beepHz: 1760 },
  tyres: { squeal: 0.10, lock: 0.16, spin: 0.10 },
  surface: { kerb: 0.22, grass: 0.16, sand: 0.20, ridge: 0.9 },   // kerb ridges every `ridge` m → rumble rate = v / ridge
  wind: { gain: 0.14, vmax: 92 },
  passBy: { gain: 0.34, maxLat: 7, minRel: 7 },   // whoosh when a car passes within maxLat m at ≥ minRel m/s difference
  crowd: { gain: 0.05, refDistance: 45 },
  impact: { ring: [420, 1130, 1870, 2690], debris: 9 },
  // the two mixes: driver = what you hear in the helmet (earplugs: highs down, engine behind you felt in the lows, the
  // airbox above your head, wind kept down); tv = an outside/onboard microphone (brighter exhaust, more wind)
  mix: {
    driver: { low: 10, high: -11, intake: 1, wind: 0.4, rivalsHigh: -8, turbo: 0.7 },
    tv:     { low: 5, high: -4, intake: 0.2, wind: 1, rivalsHigh: -2, turbo: 1 },
  },
  shake: { passBy: 0.05, buffet: 0.012, decay: 0.28 },   // camera shake (m of jitter at strength 1), dirty air, decay s
  eq: { lowHz: 160, highHz: 2500 },   // the mix's bass / treble shelf corners
  noise: { colour: 1 },               // 0 white, 1 pink, 2 brown (synth.js noiseBuffer): every noise-based sound
  // every layer can be switched off (1 on, 0 off): Sound Studio → Layers, to find a sound you don't like
  layers: { engine: 1, texture: 1, intake: 1, turbo: 1, ers: 1, pops: 1, shifts: 1, tyres: 1, surfaces: 1, wind: 1, crowd: 1, rivals: 1, whoosh: 1 },
};

const clone = o => JSON.parse(JSON.stringify(o));
const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
export const SOUND_DEFAULTS = deepFreeze(clone(DEFAULTS));
export const SOUND = clone(DEFAULTS);

// 'engine.drive.load' style paths into SOUND
export const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
export function setPath(o, path, value) { const ks = path.split('.'), last = ks.pop(), at = ks.reduce((a, k) => a?.[k], o); if (at && last in at) at[last] = value; }
// every numeric leaf that differs from the defaults → { path: value }
export function soundOverrides(o = SOUND, d = SOUND_DEFAULTS, pre = '') {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    const p = pre + k, cur = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, soundOverrides(cur, v, p + '.'));
    else if (typeof v === 'number' && typeof cur === 'number' && cur !== v) out[p] = cur;
  }
  return out;
}
// apply { path: value } on top of the defaults (unknown paths and non-numbers ignored)
export function applySoundOverrides(over) {
  const fresh = clone(DEFAULTS);
  for (const [p, v] of Object.entries(over || {})) if (typeof getPath(fresh, p) === 'number' && Number.isFinite(+v)) setPath(fresh, p, +v);
  (function copy(dst, src) { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v)) copy(dst[k], v); else dst[k] = v; } })(SOUND, fresh);
}
