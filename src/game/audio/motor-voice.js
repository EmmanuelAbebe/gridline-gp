// One electric motor (an electric car's: SOUND.motor). The same interface as engine-voice.js, so the sound engine can
// put either on a car: update(v, t) with v = { rpm, thr, brk, speed, on, pitch (Doppler), air (low-pass cap) }.
// Full voice (the player's car): the whine (a wave of the motor's electrical orders, a detuned twin beating against
// it) → load-dependent low-pass → out; the gear mesh and the inverter as own outputs (`ers` / `turbo`: the mix scales
// them per camera like the engine's); no `intake` sound (an empty output: the wiring stays the same).
// Light voice (rivals): one whine → low-pass (air absorption) → out.
import { SOUND } from './audio-config.js';
import { filter, gain, chain, glide } from './synth.js';

const clamp01 = x => Math.max(0, Math.min(1, x));

function whineWave(ctx) {
  const P = SOUND.motor.partials, n = Math.ceil(Math.max(...P.map(p => p[0])) * 2) + 1;
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  // (half orders: the wave's fundamental is half the motor's order, so 0.5 sits on harmonic 1)
  for (const [k, a] of P) im[Math.round(k * 2)] += a;
  return ctx.createPeriodicWave(re, im, { disableNormalization: false });
}

export function createMotorVoice(ctx, out, { full = true, seed = 1 } = {}) {
  const t0 = ctx.currentTime, M = SOUND.motor;
  const tone = filter(ctx, 'lowpass', 2000, 0.7), level = gain(ctx, 0), nodes = [];
  const wave = whineWave(ctx), osc = ctx.createOscillator(); osc.setPeriodicWave(wave); osc.start(t0); nodes.push(osc);
  const s = { load: 0, regen: 0, lastT: t0 };
  let extras = null;
  // each car's motor a touch different (the slots' beating rate)
  const detune = M.detune * (1 + 0.37 * ((seed * 7919) % 5 - 2) / 2);
  if (full) {
    const twin = ctx.createOscillator(); twin.setPeriodicWave(wave); twin.start(t0); nodes.push(twin);
    const twinG = gain(ctx, 0.55); chain(twin, twinG, tone);
    chain(osc, tone, level, out);
    const ersOut = gain(ctx, 1), turboOut = gain(ctx, 1), intakeOut = gain(ctx, 0);
    const mesh = ctx.createOscillator(); mesh.start(t0); const meshG = gain(ctx, 0); chain(mesh, meshG, ersOut);
    const inv = ctx.createOscillator(); inv.frequency.value = M.inverter.hz; inv.start(t0); const invG = gain(ctx, 0); chain(inv, invG, turboOut);
    nodes.push(mesh, inv);
    extras = { ersOut, turboOut, intakeOut, twin, mesh, meshG, invG };
  } else chain(osc, tone, level, out);

  return {
    outputs: extras && { intake: extras.intakeOut, turbo: extras.turboOut, ers: extras.ersOut },
    configure() { const w = whineWave(ctx); osc.setPeriodicWave(w); extras?.twin.setPeriodicWave(w); },   // SOUND.motor edited
    update(v, t) {
      const dt = Math.max(0, t - s.lastT); s.lastT = t;
      const rpm = Math.max(0, v.rpm || 0), pitch = v.pitch ?? 1, on = v.on ?? 1, sp = clamp01((v.speed || 0) / 80);
      const k = 1 - Math.exp(-dt / 0.05);
      s.load += (clamp01(v.thr) - s.load) * k;
      // (regenerating: braking while moving; the harvest fades out toward walking pace)
      s.regen += (clamp01(v.brk) * clamp01((v.speed || 0) / 15) - s.regen) * k;
      const f = Math.max(1, rpm / 60 * M.order / 2) * pitch;        // the wave's fundamental (half orders)
      glide(osc.frequency, f, t, 0.012);
      let cut = M.tone.base + M.tone.load * Math.max(s.load, s.regen);
      if (v.air) cut = Math.min(cut, v.air);
      glide(tone.frequency, cut, t, 0.03);
      // nearly silent at a standstill: the whine comes with the motor turning
      const turning = clamp01(rpm / 1500), L = SOUND.layers;
      const lvl = on * turning * (M.gain.coast + M.gain.load * s.load + M.gain.regen * s.regen + M.gain.speed * sp) * (full ? L.engine : M.rival.gain);
      glide(level.gain, lvl, t, 0.03);
      if (!full) return;
      glide(extras.twin.frequency, f * (1 + detune), t, 0.012);
      glide(extras.mesh.frequency, rpm / 60 * M.mesh.order * pitch, t, 0.012);
      glide(extras.meshG.gain, on * turning * L.ers * (M.mesh.gain * s.load + M.mesh.regen * s.regen), t, 0.04);
      glide(extras.invG.gain, on * L.turbo * M.inverter.gain * Math.max(s.load, s.regen), t, 0.05);
    },
    stop(t = ctx.currentTime) { glide(level.gain, 0, t, 0.05); for (const n of nodes) n.stop(t + 0.3); },
  };
}
