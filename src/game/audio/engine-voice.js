// One engine, synthesised (see SOUND.engine for the V6 orders). Full voice (the player's car):
//   two oscillators (on-throttle and off-throttle waves, cross-faded by throttle) with a slow random pitch wander,
//   + combustion noise pulsing at the firing rate → tanh saturation (rasp grows with throttle) → exhaust low-pass
//   → rev-limiter cut → out; separate outputs for the airbox roar, turbo whistle and ERS whine (the mix scales
//   them per camera); overrun pops and the lift-off turbo chirp as one-shots.
// Light voice (rivals): the two oscillators and the low-pass only; the caller adds Doppler (pitch) and air absorption.
import { SOUND } from './audio-config.js';
import { noise, filter, gain, chain, glide, engineWaves, shaper, burst } from './synth.js';

const E = SOUND.engine, IDLE = 4000, LIMIT = 12500;
const clamp01 = x => Math.max(0, Math.min(1, x));

export function createEngineVoice(ctx, out, { full = true } = {}) {
  const t0 = ctx.currentTime;
  let W = engineWaves(ctx);
  const osc = w => { const o = ctx.createOscillator(); o.setPeriodicWave(w); o.frequency.value = IDLE / 60 * E.order; o.start(t0); return o; };
  const oLoad = osc(W.load), oCoast = osc(W.coast), gLoad = gain(ctx, 0), gCoast = gain(ctx, 1), sum = gain(ctx, 1);
  oLoad.connect(gLoad).connect(sum); oCoast.connect(gCoast).connect(sum);
  const tone = filter(ctx, 'lowpass', 2000, 0.8), level = gain(ctx, 0), nodes = [oLoad, oCoast];
  const s = { load: 0, boost: 0, thr: 0, lastT: t0, nextPop: t0 };
  let jitter = null, drive = null, tex = null, limiter = null, extras = null;

  if (full) {
    // pitch wander: low-passed noise into both oscillators' detune
    // (white noise low-passed to 22 Hz keeps ~1/55 of its level, hence the large gain)
    const n = noise(ctx, t0), lp = filter(ctx, 'lowpass', 22, 0.5), amt = gain(ctx, E.jitterCents * 55);
    chain(n, lp, amt); amt.connect(oLoad.detune); amt.connect(oCoast.detune); nodes.push(n); jitter = amt;
    // combustion texture: band-passed noise, amplitude-modulated at the firing rate
    const tn = noise(ctx, t0), band = filter(ctx, 'bandpass', 1600, 1.2), am = gain(ctx, 0), mod = ctx.createOscillator(), modAmt = gain(ctx, 0);
    mod.start(t0); chain(mod, modAmt); modAmt.connect(am.gain); chain(tn, band, am, sum); nodes.push(tn, mod);
    tex = { band, am, mod, modAmt };
    // saturation, then the exhaust tone
    drive = gain(ctx, E.drive.coast);
    // rev limiter: a square wave pulling the level down at limiterHz while on the limiter
    const lim = gain(ctx, 1), sq = ctx.createOscillator(), depth = gain(ctx, 0);
    sq.type = 'square'; sq.frequency.value = E.limiterHz; sq.start(t0); chain(sq, depth); depth.connect(lim.gain); nodes.push(sq);
    limiter = { lim, depth, sq };
    chain(sum, drive, shaper(ctx), tone, lim, level, out);
    // airbox, turbo, ERS: own outputs
    const intakeOut = gain(ctx, 1), turboOut = gain(ctx, 1), ersOut = gain(ctx, 1);
    const iOsc = ctx.createOscillator(); iOsc.type = 'triangle'; iOsc.start(t0);
    const iLp = filter(ctx, 'lowpass', E.intake.cutoff, 0.9), iG = gain(ctx, 0);
    const rush = noise(ctx, t0), rBand = filter(ctx, 'bandpass', 700, 0.8), rG = gain(ctx, 0);
    chain(iOsc, iLp, iG, intakeOut); chain(rush, rBand, rG, intakeOut);
    const tOsc = ctx.createOscillator(); tOsc.start(t0); const tG = gain(ctx, 0); chain(tOsc, tG, turboOut);
    const eOsc = ctx.createOscillator(); eOsc.type = 'triangle'; eOsc.start(t0); const eG = gain(ctx, 0); chain(eOsc, eG, ersOut);
    nodes.push(iOsc, rush, tOsc, eOsc);
    extras = { intakeOut, turboOut, ersOut, iOsc, iLp, iG, rG, rBand, tOsc, tG, eOsc, eG };
  } else chain(sum, tone, level, out);

  return {
    outputs: extras && { intake: extras.intakeOut, turbo: extras.turboOut, ers: extras.ersOut },
    // v: rpm, thr 0..1, brk 0..1, speed m/s, on 0..1 (overall level), pitch (Doppler ratio, rivals), air (low-pass cap),
    // limiter (on the rev limiter)
    update(v, t) {
      const dt = Math.max(0, t - s.lastT); s.lastT = t;
      const rpm = Math.max(1500, v.rpm || IDLE), thr = clamp01(v.thr), r = clamp01((rpm - IDLE) / (LIMIT - IDLE));
      const pitch = v.pitch ?? 1, base = rpm / 60 * E.order * pitch;
      const w = engineWaves(ctx); if (w !== W) { W = w; oLoad.setPeriodicWave(W.load); oCoast.setPeriodicWave(W.coast); }   // settings changed
      s.load += (thr - s.load) * (1 - Math.exp(-dt / 0.04));
      glide(oLoad.frequency, base, t, 0.012); glide(oCoast.frequency, base, t, 0.012);
      glide(gLoad.gain, s.load, t, 0.02); glide(gCoast.gain, 1 - s.load * 0.85, t, 0.02);
      let cut = E.tone.base + E.tone.rpm * r + E.tone.load * s.load;
      if (v.air) cut = Math.min(cut, v.air);
      glide(tone.frequency, cut, t, 0.03);
      const on = v.on ?? 1, lvl = on * (E.gain.idle + E.gain.load * s.load + E.gain.rpm * r);
      glide(level.gain, lvl, t, 0.03);
      if (!full) { s.thr = thr; return; }
      glide(jitter.gain, E.jitterCents * 55, t, 0.1); glide(limiter.sq.frequency, E.limiterHz, t, 0.05);
      glide(extras.iLp.frequency, E.intake.cutoff, t, 0.05);
      glide(drive.gain, E.drive.coast + (E.drive.load - E.drive.coast) * s.load, t, 0.04);
      // texture pulses at the firing rate (3 per revolution)
      const fire = rpm / 60 * 3;
      glide(tex.mod.frequency, fire, t, 0.012); glide(tex.band.frequency, Math.min(6000, fire * 4), t, 0.03);
      const tx = on * E.texture * (0.25 + 0.75 * s.load);
      glide(tex.am.gain, tx, t, 0.03); glide(tex.modAmt.gain, tx, t, 0.03);
      const onLimit = v.limiter && thr > 0.5;
      glide(limiter.lim.gain, onLimit ? 0.55 : 1, t, 0.01); glide(limiter.depth.gain, onLimit ? 0.45 : 0, t, 0.01);
      // airbox: low pulses + rush of air, mostly on the throttle
      glide(extras.iOsc.frequency, base, t, 0.012);
      const ia = on * E.intake.gain * (0.2 + 0.8 * s.load) * (0.35 + 0.65 * r);
      glide(extras.iG.gain, ia, t, 0.03); glide(extras.rG.gain, ia * 0.35 * s.load, t, 0.05);
      glide(extras.rBand.frequency, 500 + 900 * r, t, 0.05);
      // turbo: boost spools up with throttle and revs, a chirp when lifting off at boost
      const T = E.turbo, target = thr * clamp01((rpm - 5500) / 5500);
      s.boost += (target - s.boost) * (1 - Math.exp(-dt / (target > s.boost ? T.spoolUp : T.spoolDown)));
      glide(extras.tOsc.frequency, T.low + (T.high - T.low) * s.boost, t, 0.05); glide(extras.tG.gain, on * T.gain * s.boost, t, 0.05);
      if (on > 0.5 && s.thr > 0.4 && thr < 0.1 && s.boost > 0.5) burst(ctx, extras.turboOut, t, { freq: 4200, to: 1600, Q: 5, decay: 0.25, level: T.chirp * s.boost });
      // ERS (MGU-K, geared to the crank): deploying on the throttle, harvesting under braking
      glide(extras.eOsc.frequency, rpm / 60 * E.ers.ratio, t, 0.02);
      glide(extras.eG.gain, on * (E.ers.gain * s.load * r + E.ers.harvest * clamp01(v.brk) * clamp01((v.speed || 0) / 30)), t, 0.05);
      // overrun pops: off the throttle at high revs
      const C = E.crackle;
      if (thr < 0.05 && rpm > C.minRpm && on > 0.5) {
        const rate = C.rate * (rpm - C.minRpm) / (LIMIT - C.minRpm) + 0.5;
        if (s.nextPop < t) s.nextPop = t;
        while (s.nextPop < t + 0.05) {
          burst(ctx, out, s.nextPop, { freq: 900 + Math.random() * 1800, Q: 1.5, decay: 0.012 + Math.random() * 0.025, level: C.gain * (0.3 + Math.random() * 0.7) });
          s.nextPop += -Math.log(1 - Math.random()) / rate;
        }
      } else s.nextPop = t + 0.15;
      s.thr = thr;
    },
    stop(t = ctx.currentTime) { glide(level.gain, 0, t, 0.05); for (const n of nodes) n.stop(t + 0.3); },
    jitter,
  };
}
