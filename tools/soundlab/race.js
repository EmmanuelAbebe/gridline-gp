// Offline render of a real race start (SIM physics, 10 cars, the player driven by the AI) through the sound
// engine, exactly as race-audio.js feeds it, listening from the cockpit. Used by soundlab ?race to find which layer
// makes a sound: renders with all layers, then with each layer off, and reports tonal peaks above 1.5 kHz.
import { SIM } from '../../src/sim/index.js';
import { createSoundEngine } from '../../src/game/audio/sound-engine.js';
import { SOUND, SOUND_DEFAULTS } from '../../src/game/audio/audio-config.js';
import { createProximity } from '../../src/game/proximity.js';
import { loadEngineWorklet } from '../../src/game/audio/engine-worklet.js';

const SR = 44100, DT = 1 / 120, SECONDS = 14;
export async function renderRace(layersOff = []) {
  for (const k of Object.keys(SOUND.layers)) SOUND.layers[k] = layersOff.includes(k) ? 0 : 1;
  const real = Math.random; let seed = 7; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ctx = new OfflineAudioContext(2, SR * (SECONDS + 0.5), SR); await loadEngineWorklet(ctx);
  const eng = createSoundEngine(ctx), prox = createProximity();
  eng.setVolumes({ master: 0.8 }, 0);
  const race = SIM.createRace(3, { aiPace: 0.95 }), player = race.cars.find(c => c.player);
  const V = SIM.VEHICLE;
  for (let step = 0, frame = 0; step < SECONDS * 120; step++) {
    race.t += DT;
    for (const c of race.cars) SIM.driveAI(race, c, DT, c.player ? 0.9 : 0);
    SIM.collide(race);
    for (const c of race.cars) { c.events.length = 0; c.rx = c.x; c.rz = c.z; c.rh = c.h; }
    if (step % 2) continue;
    const t = frame++ / 60, P = player, fx = Math.cos(P.h), fz = Math.sin(P.h);
    const rivals = race.cars.filter(c => c !== P).map(c => ({ id: c.code, x: c.x, y: 0.6, z: c.z,
      vx: Math.cos(c.h) * c.v - Math.sin(c.h) * c.vy, vz: Math.sin(c.h) * c.v + Math.cos(c.h) * c.vy, rpm: c.rpm, thr: c.thr, gear: c.gear }));
    eng.frame({ mix: 'driver', active: true, doppler: true, shiftBeep: false, dt: 1 / 60,
      listener: { x: P.x - fx * 0.33, y: 0.77, z: P.z - fz * 0.33, fx, fy: 0, fz, ux: 0, uy: 1, uz: 0, vx: fx * P.v, vy: 0, vz: fz * P.v },
      player: { rpm: P.rpm, thr: P.thr, brk: P.brake, speed: Math.abs(P.v), gear: P.gear, limiter: P.rpm >= V.limiter - 120, slideF: P.slideF, slideR: P.slideR,
        lockF: P.lockF, spinR: P.spinR, surface: P.surface, onKerb: P.onKerb, slip: P.slip, beepRpm: 0 }, rivals }, t);
    for (const e of prox.update(race, P)) eng.whoosh(e.side, e.strength, t);
  }
  Math.random = real;
  const buf = await ctx.startRendering();
  for (const k of Object.keys(SOUND.layers)) SOUND.layers[k] = SOUND_DEFAULTS.layers[k];
  return buf;
}
// tonal peaks: spectrum of the whole render (8192-point frames averaged), peaks above 1.5 kHz standing ≥ 12 dB over
// their neighbourhood; plus the share of energy above 2 kHz
export function analyse(buf) {
  const x = buf.getChannelData(0).map((v, i) => (v + buf.getChannelData(1)[i]) / 2), N = 8192, acc = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let a = 0; a + N < x.length; a += N) {
    for (let i = 0; i < N; i++) { re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im); for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const hz = k => k * SR / N, db = k => 10 * Math.log10(acc[k] + 1e-20);
  let tot = 0, hi = 0; for (let k = 1; k < N / 2; k++) { tot += acc[k]; if (hz(k) > 2000) hi += acc[k]; }
  const peaks = [];
  for (let k = Math.ceil(1500 * N / SR); k < N / 2 - 40; k++) {
    if (acc[k] < acc[k - 1] || acc[k] < acc[k + 1]) continue;
    const around = []; for (let j = k - 40; j <= k + 40; j++) if (Math.abs(j - k) > 3) around.push(db(j));
    around.sort((a, b) => a - b); const prom = db(k) - around[around.length >> 1];
    if (prom > 12) peaks.push({ hz: Math.round(hz(k)), db: +(db(k) - 10 * Math.log10(tot)).toFixed(1), prom: +prom.toFixed(1) });
  }
  peaks.sort((a, b) => b.db - a.db);
  return { above2k: +(100 * hi / tot).toFixed(2), peaks: peaks.slice(0, 6) };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
      const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
      re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
