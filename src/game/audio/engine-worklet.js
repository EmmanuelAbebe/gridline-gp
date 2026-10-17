// Physical engine model on the audio thread (AudioWorklet): what makes it sound like an engine and not a toy.
//
// 1. Combustion pulses: six cylinders fire once per 720° cycle each (a 4-stroke V6: 3 firings per revolution). Every
//    firing is a pressure kick (fast rise, decay) plus a burst of combustion noise; its strength depends on the
//    throttle, each cylinder is a little different (fixed per engine) and every firing varies (random). So the
//    sound only repeats every two revolutions: energy at all half orders, the "grunt" under the firing note.
// 2. Exhaust: the pulses ring through waveguides (delay lines with damped feedback) for the pipes. Their resonances
//    stay put while the rpm changes, so the harmonics sweep through them: the timbre changes as the revs rise,
//    as in a real engine (a fixed waveform only slides in pitch: the toy sound).
//
// Parameters (k-rate): rpm, throttle 0..1, pitch (Doppler: the whole sound, pipes included, is time-scaled).
// Settings come in processorOptions / port messages (SOUND.engine.model), seed = which engine (cylinder spread).
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
function engineProcessor() {
  class V6Engine extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'rpm', defaultValue: 4000, minValue: 0, maxValue: 30000, automationRate: 'k-rate' },
        { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      ];
    }
    constructor(options) {
      super();
      const o = options.processorOptions || {};
      this.cfg = o.cfg; let seed = (o.seed || 1) * 9301 + 49297;
      this.rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      this.cyl = []; for (let k = 0; k < 6; k++) this.cyl.push({ amp: 0, slow: 0, fast: 0, noise: 0, spread: this.rand() * 2 - 1 });
      this.next = 0; this.phase = 0; this.fired = 0;
      this.pipes = [0, 1, 2].map(() => ({ buf: new Float32Array(8192), lp: 0 })); this.w = 0;
      this.dc = 0; this.dcOut = 0;
      this.port.onmessage = e => { this.cfg = { ...this.cfg, ...e.data }; };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0], c = this.cfg, n = out.length;
      const pitch = params.pitch[0], rpm = Math.max(300, params.rpm[0]), thr = params.throttle[0];
      const cycle = rpm / 120 * pitch / sampleRate;                      // 720° cycles per sample
      const interval = 1 / (rpm / 20 * pitch);                            // s between firings (3 per revolution)
      const tauSlow = Math.min(c.decay * interval, 0.004), tauFast = tauSlow * c.sharpness;
      const kSlow = Math.exp(-1 / (tauSlow * sampleRate)), kFast = Math.exp(-1 / (tauFast * sampleRate));
      const strength = c.coast + (1 - c.coast) * thr, grit = c.noise * (0.35 + 0.65 * thr);
      const mix = [c.mix1, c.mix2, c.mix3], delays = [c.pipe1, c.pipe2, c.pipe3].map(L => Math.min(8000, Math.max(8, 2 * L / c.soundSpeed * sampleRate / pitch)));
      for (let i = 0; i < n; i++) {
        this.phase += cycle;
        // the next firing: cylinder `fired`, at 1/6 of a cycle intervals, nudged by the timing jitter
        if (this.phase >= this.next) {
          const k = this.fired % 6, cy = this.cyl[k];
          cy.amp = strength * (1 + c.spread * cy.spread) * (1 + c.jitter * (this.rand() * 2 - 1));
          cy.slow = cy.fast = cy.amp; cy.noise = cy.amp;
          this.fired++; this.next += 1 / 6 * (1 + c.timing * (this.rand() * 2 - 1));
          if (this.phase > 1e6) { this.phase -= 1e6; this.next -= 1e6; }
        }
        let x = 0;
        for (const cy of this.cyl) {
          if (cy.amp === 0) continue;
          cy.slow *= kSlow; cy.fast *= kFast; cy.noise *= kSlow;
          x += cy.slow - cy.fast + grit * cy.noise * (this.rand() * 2 - 1);
          if (cy.slow < 1e-5) cy.amp = cy.slow = cy.fast = cy.noise = 0;
        }
        // exhaust waveguides: y = x + feedback · damped(y delayed by the pipe's round trip)
        let y = 0;
        for (let p = 0; p < 3; p++) {
          const P = this.pipes[p], d = delays[p], r = this.w - d, i0 = Math.floor(r), f = r - i0;
          const a = P.buf[(i0 + 8192) & 8191], b = P.buf[(i0 + 8193) & 8191], back = a + (b - a) * f;
          P.lp += (back - P.lp) * c.damping;                             // the pipe loses highs on every round trip
          const v = x + c.feedback * P.lp;
          P.buf[this.w] = v; y += v * mix[p];
        }
        this.w = (this.w + 1) & 8191;
        // DC blocker (the pulses are one-sided)
        const hp = y - this.dc + 0.995 * this.dcOut; this.dc = y; this.dcOut = hp;
        out[i] = hp * c.gain;
      }
      return true;
    }
  }
  registerProcessor('v6-engine', V6Engine);
}

// Module URL for ctx.audioWorklet.addModule (a Blob: the build stays one file and works from file://).
let url = null;
export function engineWorkletUrl() {
  if (!url) url = URL.createObjectURL(new Blob(['(' + engineProcessor.toString() + ')()'], { type: 'application/javascript' }));
  return url;
}
const loaded = new WeakMap();
export function loadEngineWorklet(ctx) {
  if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(engineWorkletUrl()));
  return loaded.get(ctx);
}
