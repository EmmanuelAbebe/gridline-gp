// Web Audio building blocks shared by the engine voices and the effects. Everything takes the context and a start
// time `t`, so the same code runs live (t = ctx.currentTime) and in an OfflineAudioContext (tools/sound-check).
import { SOUND } from './audio-config.js';

// Noise in three colours (SOUND.noise.colour): 0 white (flat), 1 pink (−3 dB per octave: easier on the ears),
// 2 brown (−6 dB per octave: a soft rumble). 3 s per context and colour, all at the same loudness, seamless loop.
const noiseBuffers = new WeakMap();
export function noiseBuffer(ctx, colour = SOUND.noise.colour) {
  if (!noiseBuffers.has(ctx)) noiseBuffers.set(ctx, []);
  const set = noiseBuffers.get(ctx), c = Math.max(0, Math.min(2, Math.round(colour)));
  if (!set[c]) {
    const N = ctx.sampleRate * 3, K = 4096, seq = new Float32Array(N + K);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < N + K; i++) {
      const w = Math.random() * 2 - 1;
      if (c === 0) seq[i] = w;
      else if (c === 1) {   // Paul Kellet's pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        seq[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      } else { br = (br + 0.02 * w) / 1.02; seq[i] = br; }   // leaky integrator
    }
    let mean = 0; for (let i = 0; i < N + K; i++) mean += seq[i]; mean /= N + K;
    const b = ctx.createBuffer(1, N, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < N; i++) d[i] = seq[i] - mean;
    for (let i = 0; i < K; i++) { const a = i / K; d[i] = (seq[i] - mean) * a + (seq[N + i] - mean) * (1 - a); }   // the end runs into the start
    let rms = 0; for (let i = 0; i < N; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / N);
    for (let i = 0; i < N; i++) d[i] *= 0.577 / rms;   // white noise's loudness for every colour
    set[c] = b;
  }
  return set[c];
}
// A noise source. Continuous ones (loop) come back as a gain node that keeps working when the colour changes
// (setNoiseColour swaps the source behind it); `fixed` = always white (modulators: their depth must not change).
const live = new WeakMap();
const startSource = (ctx, t, buffer, loop) => {
  const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = loop;
  s.loopStart = 0; s.loopEnd = buffer.duration; s.start(t, Math.random() * buffer.duration * 0.9); return s;
};
export function noise(ctx, t, loop = true, { fixed = false } = {}) {
  if (!loop) return startSource(ctx, t, noiseBuffer(ctx), false);
  const outlet = gain(ctx, 1), rec = { outlet, colour: fixed ? 0 : SOUND.noise.colour };
  rec.src = startSource(ctx, t, noiseBuffer(ctx, rec.colour), true); rec.src.connect(outlet);
  outlet.stop = when => rec.src.stop(when);
  if (!fixed) { if (!live.has(ctx)) live.set(ctx, new Set()); live.get(ctx).add(rec); }
  return outlet;
}
export function setNoiseColour(ctx, t = ctx.currentTime) {
  for (const rec of live.get(ctx) || []) {
    if (rec.colour === SOUND.noise.colour) continue;
    rec.colour = SOUND.noise.colour; rec.src.stop(t + 0.01);
    rec.src = startSource(ctx, t, noiseBuffer(ctx, rec.colour), true); rec.src.connect(rec.outlet);
  }
}
export const filter = (ctx, type, frequency, Q = 0.7, gain = 0) => {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; f.gain.value = gain; return f;
};
export const gain = (ctx, value = 0) => { const g = ctx.createGain(); g.gain.value = value; return g; };
export function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
// smooth parameter change (time constant tc s): no zipper noise
export const glide = (param, value, t, tc = 0.03) => param.setTargetAtTime(value, t, tc);

// tanh saturation curve (fixed); the drive is the gain in front of it
let tanhCurve = null;
export function shaper(ctx) {
  if (!tanhCurve) { tanhCurve = new Float32Array(1024); for (let i = 0; i < 1024; i++) tanhCurve[i] = Math.tanh((i / 511.5 - 1) * 2.5) / Math.tanh(2.5); }
  // 4× oversampling: the saturation's harmonics don't fold back as high whistles
  const s = ctx.createWaveShaper(); s.curve = tanhCurve; s.oversample = '4x'; return s;
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
