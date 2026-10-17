// Renders the sound test scenes (src/game/audio/scenarios.js) offline, encodes WAVs and measures them, for
// tools/sound-check.cjs. window.soundlab = { results } when done.
import { createSoundEngine } from '../../src/game/audio/sound-engine.js';
import { SCENARIOS, playScenario } from '../../src/game/audio/scenarios.js';
import { SOUND } from '../../src/game/audio/audio-config.js';

const SR = 44100;
function wav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, SR, true); out.setUint32(28, SR * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  let s = ''; const b = new Uint8Array(out.buffer); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
// fundamental by autocorrelation in a window (lo..hi Hz)
function pitch(x, at, win, lo, hi) {
  const a = Math.floor(at * SR), n = Math.floor(win * SR); let best = 0, lag = 0;
  for (let L = Math.floor(SR / hi); L <= Math.floor(SR / lo); L++) {
    let s = 0, e = 0; for (let i = 0; i < n; i++) { s += x[a + i] * x[a + i + L]; e += x[a + i + L] * x[a + i + L]; }
    const r = s / Math.sqrt(e + 1e-9); if (r > best) { best = r; lag = L; }
  }
  return lag ? SR / lag : 0;
}
import { renderRace, analyse } from './race.js';
const results = {};
if (location.search.includes('race')) {   // which layer makes which high sound, in a real race
  const colour = /colour=(\d)/.exec(location.search); if (colour) SOUND.noise.colour = +colour[1];
  const all = await renderRace(); results.race = { wav: wav(all), ...analyse(all) };
  for (const k of Object.keys(SOUND.layers)) results['no ' + k] = analyse(await renderRace([k]));
  window.soundlab = { results }; document.title = 'done';
}
else for (const [name, sc] of Object.entries(SCENARIOS)) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (sc.seconds + 0.6)), SR), eng = createSoundEngine(ctx);
  eng.setVolumes({ master: 0.8 }, 0);
  playScenario(eng, name, 0, false);
  const buf = await ctx.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), mono = L.map((v, i) => (v + R[i]) / 2);
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const rms = []; for (let s = 0; s < sc.seconds; s += 0.5) { let e = 0; const a = s * SR, n = 0.5 * SR; for (let i = a; i < a + n; i++) e += mono[i] * mono[i]; rms.push(+(20 * Math.log10(Math.sqrt(e / n) + 1e-9)).toFixed(1)); }
  const r = { peak: +peak.toFixed(3), rmsDb: rms, wav: wav(buf) };
  if (name.startsWith('pass')) {   // Doppler: rival's base tone early (approaching) vs late (leaving), against the formula
    const kmh = +name.slice(4), v = kmh / 3.6, c = SOUND.speedOfSound;
    const st = sc.at(0.6), base = st.rivals[0].rpm / 60 * SOUND.engine.order;
    const f = t => pitch(mono, t, 0.06, base * 0.5, base * 1.9);
    const cosAt = t => { const x = (t - 3) * v; return -x / Math.hypot(x, 12); };   // component of velocity toward the listener
    r.doppler = { base: +base.toFixed(1), early: +f(1.2).toFixed(1), late: +f(4.8).toFixed(1),
      theoryEarly: +(base * c / (c - v * cosAt(1.2))).toFixed(1), theoryLate: +(base * c / (c - v * cosAt(4.8))).toFixed(1) };
  }
  results[name] = r;
}
if (!location.search.includes('race')) { window.soundlab = { results }; document.title = 'done'; }
