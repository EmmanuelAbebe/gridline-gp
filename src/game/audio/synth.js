// Web Audio building blocks shared by the engine voices and the effects. Everything takes the context and a start
// time `t`, so the same code runs live (t = ctx.currentTime) and in an OfflineAudioContext (tools/sound-check).
import { SOUND } from './audio-config.js';

// One second of white noise per context, looped wherever a noise source is needed.
const noiseBuffers = new WeakMap();
export function noiseBuffer(ctx) {
  if (!noiseBuffers.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return noiseBuffers.get(ctx);
}
export function noise(ctx, t, loop = true) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx); s.loop = loop;
  s.loopStart = 0; s.loopEnd = 1; s.start(t, Math.random()); return s;
}
export const filter = (ctx, type, frequency, Q = 0.7, gain = 0) => {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; f.gain.value = gain; return f;
};
export const gain = (ctx, value = 0) => { const g = ctx.createGain(); g.gain.value = value; return g; };
export function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
// smooth parameter change (time constant tc s): no zipper noise
export const glide = (param, value, t, tc = 0.03) => param.setTargetAtTime(value, t, tc);

// Engine waves (see SOUND.engine): harmonic n of the 1.5-order base; even n = firing orders, odd n = half orders.
// Rebuilt when the wave settings change (Sound Studio); voices compare the returned object and swap waves.
const waves = new WeakMap();
export function engineWaves(ctx) {
  const E = SOUND.engine, key = [E.harmonics, E.halfOrder, E.loadTilt, E.coastTilt].join('|');
  if (waves.get(ctx)?.key !== key) {
    const make = tilt => {
      const re = new Float32Array(E.harmonics + 1), im = new Float32Array(E.harmonics + 1);
      for (let n = 1; n <= E.harmonics; n++) {
        const a = (n % 2 ? E.halfOrder : 1) / n ** tilt;
        im[n] = a * Math.cos(n * 1.7); re[n] = a * Math.sin(n * 1.7);   // fixed phase spread: a pulse train, not a buzz
      }
      return ctx.createPeriodicWave(re, im);
    };
    waves.set(ctx, { key, load: make(E.loadTilt), coast: make(E.coastTilt) });
  }
  return waves.get(ctx);
}

// tanh saturation curve (fixed); the drive is the gain in front of it
let tanhCurve = null;
export function shaper(ctx) {
  if (!tanhCurve) { tanhCurve = new Float32Array(1024); for (let i = 0; i < 1024; i++) tanhCurve[i] = Math.tanh((i / 511.5 - 1) * 2.5) / Math.tanh(2.5); }
  const s = ctx.createWaveShaper(); s.curve = tanhCurve; s.oversample = '2x'; return s;
}

// ---- one-shots: a node graph that plays once from t and stops itself ----
// Filtered noise burst with an attack/decay envelope; optional frequency sweep.
export function burst(ctx, out, t, { type = 'bandpass', freq = 1000, to = null, Q = 1, attack = 0.002, decay = 0.08, level = 0.2 }) {
  const src = noise(ctx, t, false), f = filter(ctx, type, freq, Q), g = gain(ctx, 0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay);
  chain(src, f, g, out); src.stop(t + attack + decay + 0.05);
}
// Sine thump falling in pitch (body of a crack, a clunk, an impact).
export function thump(ctx, out, t, { freq = 90, to = 50, decay = 0.09, level = 0.25, type = 'sine' }) {
  const o = ctx.createOscillator(), g = gain(ctx, 0); o.type = type;
  o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(to, t + decay);
  g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
  chain(o, g, out); o.start(t); o.stop(t + decay + 0.02);
}
// Metal ring: a few inharmonic partials decaying at different rates.
export function ring(ctx, out, t, partials, level, decay) {
  partials.forEach((f, i) => {
    const o = ctx.createOscillator(), g = gain(ctx, 0); o.frequency.value = f * (0.97 + Math.random() * 0.06);
    const d = decay / (1 + i * 0.6);
    g.gain.setValueAtTime(level / (1 + i), t); g.gain.exponentialRampToValueAtTime(0.0003, t + d);
    chain(o, g, out); o.start(t); o.stop(t + d + 0.02);
  });
}
export function beep(ctx, out, t, freq, dur, level = 0.12) {
  const o = ctx.createOscillator(), g = gain(ctx, 0); o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  chain(o, g, out); o.start(t); o.stop(t + dur + 0.02);
}

// Positional source: an HRTF panner (distance roll-off is the panner's; air absorption is a separate low-pass).
export function panner(ctx, refDistance, rolloff, maxDistance = 1500) {
  const p = ctx.createPanner();
  Object.assign(p, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance, rolloffFactor: rolloff, maxDistance });
  return p;
}
export function place(node, t, x, y, z) {
  if (node.positionX) { node.positionX.setValueAtTime(x, t); node.positionY.setValueAtTime(y, t); node.positionZ.setValueAtTime(z, t); }
  else node.setPosition(x, y, z);
}
