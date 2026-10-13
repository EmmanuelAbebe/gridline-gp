// WebAudio "engine" (saw + square through a low-pass) plus one-shot beeps. Starts on a user gesture.
export const Sound = (() => {
  let ctx = null, osc1, osc2, filter, gain, noiseBuf = null, muted = false;
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
      osc2 = ctx.createOscillator(); osc2.type = 'square';
      filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1100; filter.Q.value = 3;
      gain = ctx.createGain(); gain.gain.value = 0;
      osc1.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      osc1.start(); osc2.start();
    } catch (e) { ctx = null; }
  }
  function beep(freq, dur) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  }
  // Crash/contact: a burst of filtered noise plus a falling low thump, both scaled by strength (0..1).
  function impact(strength, { cutoff, thump }) {
    if (!ctx || muted) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime, vol = 0.05 + 0.25 * strength, dur = 0.12 + 0.25 * strength;
    const envelope = peak => { const g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); g.connect(ctx.destination); return g; };
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter();
    src.buffer = noiseBuf; lp.type = 'lowpass'; lp.frequency.value = cutoff * (0.7 + 0.6 * strength);
    src.connect(lp); lp.connect(envelope(vol)); src.start(t); src.stop(t + dur);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(thump * 1.6, t); o.frequency.exponentialRampToValueAtTime(thump * 0.6, t + dur);
    o.connect(envelope(vol * 1.2)); o.start(t); o.stop(t + dur);
  }
  function engine(rpm, thr, active) {
    if (!ctx) return;
    const t = ctx.currentTime, f = 55 + rpm * 230;
    osc1.frequency.setTargetAtTime(f, t, 0.03); osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    filter.frequency.setTargetAtTime(600 + thr * 1400 + rpm * 600, t, 0.05);
    gain.gain.setTargetAtTime(muted || !active ? 0 : 0.018 + thr * 0.03, t, 0.06);
  }
  return { init, beep, impact, engine, toggleMute() { muted = !muted; return muted; } };
})();
