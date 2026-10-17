// One engine. The sound itself is the physical model in engine-worklet.js (combustion pulses into exhaust pipes);
// this file is the graph around it. Full voice (the player's car):
//   model → tanh saturation (rasp grows with throttle) → exhaust low-pass → rev-limiter cut → out; the airbox roar
//   is the same pulses low-passed (+ a rush of air), plus turbo whistle and ERS whine as own outputs (the mix scales
//   them per camera); overrun pops and the lift-off turbo chirp as one-shots.
// Light voice (rivals): model → low-pass (air absorption) → out; Doppler goes in as the model's pitch.
// Needs loadEngineWorklet(ctx) to have resolved.
import { SOUND } from './audio-config.js';
import { noise, filter, gain, chain, glide, shaper, burst } from './synth.js';

const E = SOUND.engine, IDLE = 4000, LIMIT = 12500;
const clamp01 = x => Math.max(0, Math.min(1, x));
// the model's settings; the grit layer switch (Sound Studio) scales its combustion noise
const modelCfg = () => ({ ...E.model, noise: E.model.noise * SOUND.layers.texture });

export function createEngineVoice(ctx, out, { full = true, seed = 1 } = {}) {
  const t0 = ctx.currentTime;
  const model = new AudioWorkletNode(ctx, 'v6-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { cfg: modelCfg(), seed } });
  const P = n => model.parameters.get(n);
  const tone = filter(ctx, 'lowpass', 3000, 0.7), level = gain(ctx, 0), nodes = [];
  const s = { load: 0, boost: 0, thr: 0, lastT: t0, nextPop: t0 };
  let drive = null, limiter = null, extras = null;

  if (full) {
    drive = gain(ctx, E.drive.coast);
    // rev limiter: a square wave pulling the level down at limiterHz while on the limiter
    const lim = gain(ctx, 1), sq = ctx.createOscillator(), depth = gain(ctx, 0);
    sq.type = 'square'; sq.frequency.value = E.limiterHz; sq.start(t0); chain(sq, depth); depth.connect(lim.gain); nodes.push(sq);
    limiter = { lim, depth, sq };
    chain(model, drive, shaper(ctx), tone, lim, level, out);
    // airbox: the induction pulses (the same combustion, low-passed) and a rush of air; turbo; ERS
    const intakeOut = gain(ctx, 1), turboOut = gain(ctx, 1), ersOut = gain(ctx, 1);
    const iLp = filter(ctx, 'lowpass', E.intake.cutoff, 0.9), iG = gain(ctx, 0);
    const rush = noise(ctx, t0), rBand = filter(ctx, 'bandpass', 700, 0.8), rG = gain(ctx, 0);
    chain(model, iLp, iG, intakeOut); chain(rush, rBand, rG, intakeOut);
    const tOsc = ctx.createOscillator(); tOsc.start(t0); const tG = gain(ctx, 0); chain(tOsc, tG, turboOut);
    // a pure sine: the hybrid whine without buzz
    const eOsc = ctx.createOscillator(); eOsc.start(t0); const eG = gain(ctx, 0); chain(eOsc, eG, ersOut);
    nodes.push(rush, tOsc, eOsc);
    extras = { intakeOut, turboOut, ersOut, iLp, iG, rG, rBand, tOsc, tG, eOsc, eG };
  } else chain(model, tone, level, out);

  return {
    outputs: extras && { intake: extras.intakeOut, turbo: extras.turboOut, ers: extras.ersOut },
    configure() { model.port.postMessage(modelCfg()); },   // SOUND.engine.model edited
    // v: rpm, thr 0..1, brk 0..1, speed m/s, on 0..1 (overall level), pitch (Doppler ratio, rivals), air (low-pass cap),
    // limiter (on the rev limiter)
    update(v, t) {
      const dt = Math.max(0, t - s.lastT); s.lastT = t;
      const rpm = Math.max(1500, v.rpm || IDLE), thr = clamp01(v.thr), r = clamp01((rpm - IDLE) / (LIMIT - IDLE));
      s.load += (thr - s.load) * (1 - Math.exp(-dt / 0.04));
      glide(P('rpm'), rpm, t, 0.012); glide(P('throttle'), s.load, t, 0.02); glide(P('pitch'), v.pitch ?? 1, t, 0.03);
      let cut = E.tone.base + E.tone.rpm * r + E.tone.load * s.load;
      if (v.air) cut = Math.min(cut, v.air);
      glide(tone.frequency, cut, t, 0.03);
      const L = SOUND.layers, on = v.on ?? 1, lvl = on * (full ? L.engine : 1) * (E.gain.idle + E.gain.load * s.load + E.gain.rpm * r);
      glide(level.gain, lvl, t, 0.03);
      if (!full) { s.thr = thr; return; }
      glide(limiter.sq.frequency, E.limiterHz, t, 0.05); glide(extras.iLp.frequency, E.intake.cutoff, t, 0.05);
      glide(drive.gain, E.drive.coast + (E.drive.load - E.drive.coast) * s.load, t, 0.04);
      const onLimit = v.limiter && thr > 0.5;
      glide(limiter.lim.gain, onLimit ? 0.55 : 1, t, 0.01); glide(limiter.depth.gain, onLimit ? 0.45 : 0, t, 0.01);
      // airbox: induction pulses + rush of air, mostly on the throttle
      const ia = on * L.intake * E.intake.gain * (0.2 + 0.8 * s.load) * (0.35 + 0.65 * r);
      glide(extras.iG.gain, ia, t, 0.03); glide(extras.rG.gain, ia * 0.35 * s.load, t, 0.05);
      glide(extras.rBand.frequency, 500 + 900 * r, t, 0.05);
      // turbo: boost spools up with throttle and revs, a chirp when lifting off at boost
      const T = E.turbo, target = thr * clamp01((rpm - 5500) / 5500);
      s.boost += (target - s.boost) * (1 - Math.exp(-dt / (target > s.boost ? T.spoolUp : T.spoolDown)));
      glide(extras.tOsc.frequency, T.low + (T.high - T.low) * s.boost, t, 0.05); glide(extras.tG.gain, on * L.turbo * T.gain * s.boost, t, 0.05);
      if (on > 0.5 && s.thr > 0.4 && thr < 0.1 && s.boost > 0.5) burst(ctx, extras.turboOut, t, { freq: 4200, to: 1600, Q: 5, decay: 0.25, level: L.turbo * T.chirp * s.boost });
      // ERS (MGU-K, geared to the crank): deploying on the throttle, harvesting under braking
      glide(extras.eOsc.frequency, rpm / 60 * E.ers.ratio, t, 0.02);
      glide(extras.eG.gain, on * L.ers * (E.ers.gain * s.load * r + E.ers.harvest * clamp01(v.brk) * clamp01((v.speed || 0) / 30)), t, 0.05);
      // overrun pops: off the throttle at high revs
      const C = E.crackle;
      if (thr < 0.05 && rpm > C.minRpm && on > 0.5 && L.pops > 0) {
        const rate = C.rate * (rpm - C.minRpm) / (LIMIT - C.minRpm) + 0.5;
        if (s.nextPop < t) s.nextPop = t;
        while (s.nextPop < t + 0.05) {
          burst(ctx, out, s.nextPop, { freq: 900 + Math.random() * 1800, Q: 1.5, decay: 0.012 + Math.random() * 0.025, level: L.pops * C.gain * (0.3 + Math.random() * 0.7) });
          s.nextPop += -Math.log(1 - Math.random()) / rate;
        }
      } else s.nextPop = t + 0.15;
      s.thr = thr;
    },
    stop(t = ctx.currentTime) { glide(level.gain, 0, t, 0.05); for (const n of nodes) n.stop(t + 0.3); },
  };
}
