// Sound tunables (everything the synthesis and the mix use), in one table. Gains are linear, frequencies Hz.
//
// The engine is a modern 1.6 l 90° V6 turbo hybrid. A 4-stroke V6 fires 3 times per crank revolution, so the main
// tone is rpm / 60 × 3 (600 Hz at 12 000 rpm). A 90° V6 fires unevenly, which puts energy at half orders too: the
// engine oscillators run at 1.5 × the crank rate, their even harmonics are the firing orders (3, 6, 9, …) and the odd
// ones the half orders (1.5, 4.5, …) that give the growl.
export const SOUND = Object.freeze({
  speedOfSound: 343,           // m/s, for Doppler
  engine: {
    order: 1.5,                // oscillator frequency = rpm / 60 × order
    harmonics: 28,
    // harmonic n (of the 1.5-order base): firing orders (n even) at full weight, half orders (n odd) at `halfOrder`
    halfOrder: 0.32,
    loadTilt: 0.62,            // amplitude ∝ 1 / n^tilt: on the throttle (bright, raspy)
    coastTilt: 1.25,           //                         off the throttle (dull)
    jitterCents: 9,            // slow random wander of the pitch (combustion is never perfectly even)
    drive: { coast: 0.7, load: 2.1 },   // into a tanh shaper: more = rasp
    tone: { base: 900, rpm: 3600, load: 3200 },   // exhaust low-pass: base + rpm share × rpm + throttle × load
    texture: 0.22,             // combustion noise pulsing at the firing rate, × throttle
    gain: { idle: 0.16, load: 0.34, rpm: 0.18 },
    limiterHz: 17,             // rev-limiter cut-in rate
    crackle: { rate: 18, minRpm: 7200, gain: 0.25 },   // pops per second on the overrun at high rpm
    intake: { gain: 0.28, cutoff: 420 },              // airbox roar (cockpit): low-passed pulses + rush of air
    turbo: { low: 2400, high: 7400, gain: 0.018, spoolUp: 0.22, spoolDown: 0.45, chirp: 0.06 },
    ers: { ratio: 8, gain: 0.010, harvest: 0.012 },  // MGU-K whine: rpm / 60 × ratio; deploying on the throttle, harvesting on the brakes
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
    driver: { low: 7, high: -9, intake: 1, wind: 0.4, rivalsHigh: -4, turbo: 0.7 },
    tv:     { low: 2, high: 0,  intake: 0.2, wind: 1, rivalsHigh: 0, turbo: 1 },
  },
  shake: { passBy: 0.05, buffet: 0.012, decay: 0.28 },   // camera shake (m of jitter at strength 1), dirty air, decay s
});
