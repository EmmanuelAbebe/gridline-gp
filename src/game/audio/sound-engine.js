// The whole soundscape on one AudioContext (live or offline; call after loadEngineWorklet(ctx) has resolved). No game imports: main.js feeds it plain numbers each
// frame (frame(state, t)), so tools/sound-check can drive it with scripted scenes.
//
// Buses: engine / effects / ambience → master → compressor → output. Sounds that come from the player's own car
// (engine, airbox, shifts, tyres, surfaces) go through the `cabin` EQ, which is the mix: driver (helmet, earplugs)
// or tv (outside microphone), see SOUND.mix. Rivals: a pool of light engine voices on the nearest cars, each on an
// HRTF panner, with Doppler computed from the real relative velocity (Web Audio has none built in) and air absorption.
import { SOUND } from './audio-config.js';
import { createEngineVoice } from './engine-voice.js';
import { noise, filter, gain, chain, glide, burst, thump, ring, beep, panner, place, setNoiseColour } from './synth.js';

const clamp01 = x => Math.max(0, Math.min(1, x));

export function createSoundEngine(ctx) {
  const t0 = ctx.currentTime;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
  const master = gain(ctx, 0.8), engineBus = gain(ctx, 1), fxBus = gain(ctx, 1), ambBus = gain(ctx, 1);
  engineBus.connect(master); fxBus.connect(master); ambBus.connect(master); chain(master, comp, ctx.destination);

  // the cabin EQ: everything heard from inside / on the player's car
  const low = filter(ctx, 'lowshelf', SOUND.eq.lowHz, 0.7), high = filter(ctx, 'highshelf', SOUND.eq.highHz, 0.7), cabin = gain(ctx, 1);
  chain(cabin, low, high, engineBus);
  const cabinFx = gain(ctx, 1); chain(cabinFx, filter(ctx, 'highshelf', 3000, 0.7), fxBus);   // tyres, surfaces
  const player = createEngineVoice(ctx, cabin, { full: true, seed: 1 });
  const intakeMix = gain(ctx, 1), turboMix = gain(ctx, 1);
  player.outputs.intake.connect(intakeMix).connect(cabin);
  // turbo and ERS through the cabin EQ too, so the treble setting reaches every high sound of the car
  player.outputs.turbo.connect(turboMix).connect(cabin);
  player.outputs.ers.connect(cabin);

  // rivals
  const R = SOUND.rivals, rivalsEq = filter(ctx, 'highshelf', 2500, 0.7); rivalsEq.connect(engineBus);
  const voices = Array.from({ length: R.voices }, (_, i) => {
    const p = panner(ctx, R.refDistance, R.rolloff), g = gain(ctx, 0);
    chain(g, p, rivalsEq);
    return { voice: createEngineVoice(ctx, g, { full: false, seed: 2 + i }), out: g, panner: p, id: null, gear: 0 };   // each engine a little different
  });

  // continuous effects: tyres, surfaces, wind (each a noise source → filter → level)
  const layer = (type, f, Q, dest = cabinFx) => { const n = noise(ctx, t0), fl = filter(ctx, type, f, Q), g = gain(ctx, 0); chain(n, fl, g, dest); return { f: fl, g }; };
  const squeal = layer('bandpass', 1100, 7), lock = layer('lowpass', 900, 1.5), spin = layer('bandpass', 650, 2);
  const grass = layer('lowpass', 260, 0.8), wind = layer('bandpass', 400, 0.4, fxBus), hiss = layer('highpass', 3500, 0.5, fxBus);
  // kerb: low rumble amplitude-modulated by a square wave at the ridge rate
  const kerb = layer('lowpass', 210, 1); const kAm = gain(ctx, 0.5), kSq = ctx.createOscillator(), kAmt = gain(ctx, 0.5);
  kerb.g.disconnect(); kerb.g.connect(kAm).connect(cabinFx); kSq.type = 'square'; kSq.start(t0); chain(kSq, kAmt); kAmt.connect(kAm.gain);
  // gravel: crunchy band of noise, its level wobbling with slow noise
  const sand = layer('bandpass', 2300, 0.7); const sAm = gain(ctx, 0.6), sMod = noise(ctx, t0, true, { fixed: true }), sLp = filter(ctx, 'lowpass', 14, 0.5), sAmt = gain(ctx, 18);
  sand.g.disconnect(); sand.g.connect(sAm).connect(cabinFx); chain(sMod, sLp, sAmt); sAmt.connect(sAm.gain);
  // dirty-air buffeting: slow noise wobbling the wind
  const wAm = gain(ctx, 1), bMod = noise(ctx, t0, true, { fixed: true }), bLp = filter(ctx, 'lowpass', 7, 0.5), bAmt = gain(ctx, 0);
  wind.g.disconnect(); wind.g.connect(wAm).connect(fxBus); chain(bMod, bLp, bAmt); bAmt.connect(wAm.gain);

  // crowd at the grandstand
  const crowd = (() => {
    const C = SOUND.crowd, p = panner(ctx, C.refDistance, 1.2), n = noise(ctx, t0), b = filter(ctx, 'bandpass', 950, 0.5), g = gain(ctx, 0);
    const am = gain(ctx, 0.8), m = noise(ctx, t0, true, { fixed: true }), lp = filter(ctx, 'lowpass', 1.5, 0.5), amt = gain(ctx, 12);
    chain(n, b, am, g, p, ambBus); chain(m, lp, amt); amt.connect(am.gain);
    return { p, g };
  })();
  const crowdPanner = crowd.p;

  const st = { mix: null, gear: 0, rpm: 0, lastRivalIds: '' };
  function setMix(name, t) {
    if (st.mix === name) return; st.mix = name;
    const M = SOUND.mix[name];
    glide(low.gain, M.low, t, 0.05); glide(high.gain, M.high, t, 0.05); glide(intakeMix.gain, M.intake, t, 0.05);
    glide(turboMix.gain, M.turbo, t, 0.05); glide(rivalsEq.gain, M.rivalsHigh, t, 0.05);
  }
  setMix('tv', t0);

  // ---- one-shots ----
  function shiftFx(up, t) {
    const S = SOUND.shift, cockpit = st.mix === 'driver', k = SOUND.layers.shifts;
    if (!k) return;
    if (up) {   // ignition cut: a crack from the exhaust, a clunk from the gearbox behind you
      burst(ctx, cabin, t, { type: 'highpass', freq: 1800, Q: 0.7, decay: 0.035, level: k * S.crack });
      thump(ctx, cabin, t, { freq: 120, to: 60, decay: 0.07, level: k * S.clunk * (cockpit ? 1 : 0.4) });
    } else {    // throttle blip on the downshift: a short "brap"
      burst(ctx, cabin, t, { freq: 700, to: 1500, Q: 1.2, attack: 0.01, decay: 0.07, level: k * S.blip });
      thump(ctx, cabin, t + 0.02, { freq: 95, to: 55, decay: 0.06, level: k * S.clunk * (cockpit ? 0.9 : 0.35) });
    }
  }

  return {
    ctx,
    setMix,
    // SOUND was edited (Sound Studio): re-apply what is only set on change or at creation
    refresh(t = ctx.currentTime) {
      const mix = st.mix; st.mix = null; setMix(mix, t);
      glide(low.frequency, SOUND.eq.lowHz, t, 0.05); glide(high.frequency, SOUND.eq.highHz, t, 0.05);
      player.configure();
      for (const vc of voices) { vc.voice.configure(); vc.panner.refDistance = R.refDistance; vc.panner.rolloffFactor = R.rolloff; }
      crowdPanner.refDistance = SOUND.crowd.refDistance;
      setNoiseColour(ctx, t);
    },
    setVolumes({ master: m = 0.8, engine = 1, fx = 1, ambience = 1 }, t = ctx.currentTime) {
      glide(master.gain, m, t, 0.02); glide(engineBus.gain, engine, t, 0.02); glide(fxBus.gain, fx, t, 0.02); glide(ambBus.gain, ambience, t, 0.02);
    },
    setCrowd(x, y, z, t = ctx.currentTime) { place(crowd.p, t, x, y, z); },
    beep(freq, dur, t = ctx.currentTime) { beep(ctx, fxBus, t, freq, dur); },
    // strength 0..1; kind { cutoff, thump } (SFX.wall / SFX.contact): noise crunch + low thump + metal ring + debris
    impact(strength, kind, t = ctx.currentTime) {
      const I = SOUND.impact, vol = 0.05 + 0.3 * strength, dur = 0.12 + 0.28 * strength;
      burst(ctx, fxBus, t, { type: 'lowpass', freq: kind.cutoff * (0.7 + 0.6 * strength), Q: 0.7, decay: dur, level: vol });
      thump(ctx, fxBus, t, { freq: kind.thump * 1.6, to: kind.thump * 0.6, decay: dur, level: vol * 1.2 });
      if (strength > 0.15) ring(ctx, fxBus, t, I.ring, vol * 0.25, 0.25 + 0.4 * strength);
      for (let k = 0; k < Math.round(I.debris * strength); k++) {
        burst(ctx, fxBus, t + 0.04 + Math.random() * 0.45, { type: 'highpass', freq: 2500 + Math.random() * 3000, decay: 0.008 + Math.random() * 0.012, level: vol * 0.25 * Math.random() });
      }
    },
    // a car passing close: a burst of air sweeping down, on its side (side −1 left, +1 right), strength 0..1
    whoosh(side, strength, t = ctx.currentTime) {
      const P = SOUND.passBy, k = SOUND.layers.whoosh; if (!k) return;
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, side * 0.75)); pan.connect(fxBus);
      burst(ctx, pan, t, { freq: 2400, to: 380, Q: 0.8, attack: 0.06, decay: 0.38, level: k * P.gain * strength });
      thump(ctx, pan, t + 0.03, { freq: 70, to: 40, decay: 0.2, level: k * P.gain * 0.7 * strength });
    },
    // Everything continuous, once per frame. state: { mix, active, playerOn (default true), doppler, shiftBeep,
    //   listener { x, y, z, fx, fy, fz, ux, uy, uz, vx, vy, vz }, player { rpm, thr, brk, speed, gear, limiter,
    //   slideF, slideR, lockF, spinR, surface, onKerb, slip, beepRpm }, rivals [{ id, x, y, z, vx, vz, rpm, thr, gear }] }
    frame(s, t = ctx.currentTime) {
      setMix(s.mix, t);
      const on = s.active ? 1 : 0, p = s.player, L = s.listener, M = SOUND.mix[st.mix], Y = SOUND.layers;
      // listener = the camera
      const li = ctx.listener;
      if (li.positionX) {
        li.positionX.setValueAtTime(L.x, t); li.positionY.setValueAtTime(L.y, t); li.positionZ.setValueAtTime(L.z, t);
        li.forwardX.setValueAtTime(L.fx, t); li.forwardY.setValueAtTime(L.fy, t); li.forwardZ.setValueAtTime(L.fz, t);
        li.upX.setValueAtTime(L.ux, t); li.upY.setValueAtTime(L.uy, t); li.upZ.setValueAtTime(L.uz, t);
      } else { li.setPosition(L.x, L.y, L.z); li.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz); }

      // player's car
      player.update({ ...p, on: s.playerOn === false ? 0 : on }, t);
      if (s.active && st.gear > 0 && p.gear > 0 && p.gear !== st.gear) shiftFx(p.gear > st.gear, t);
      if (s.active && s.shiftBeep && p.beepRpm && st.rpm < p.beepRpm && p.rpm >= p.beepRpm) beep(ctx, fxBus, t, SOUND.shift.beepHz, 0.07, 0.08);
      st.gear = p.gear; st.rpm = p.rpm;
      // tyres
      const T = SOUND.tyres, ty = on * Y.tyres, moving = clamp01(p.speed / 15), slide = Math.max(p.slideF, p.slideR);
      glide(squeal.g.gain, ty * T.squeal * clamp01(slide - 0.05) * moving * (p.lockF || p.spinR ? 0.4 : 1), t, 0.04);
      glide(squeal.f.frequency, 950 + 700 * slide, t, 0.08);
      glide(lock.g.gain, ty * (p.lockF ? T.lock : 0) * moving, t, 0.03);
      glide(spin.g.gain, ty * (p.spinR ? T.spin : 0) * moving, t, 0.03);
      // surfaces
      const U = SOUND.surface, v = p.speed, su = on * Y.surfaces;
      glide(kerb.g.gain, su * (p.onKerb ? U.kerb * clamp01(v / 25) * (p.surface === 'sausage' ? 1.8 : 1) : 0), t, 0.03);
      glide(kSq.frequency, Math.max(4, Math.min(90, v / U.ridge)), t, 0.03);
      glide(grass.g.gain, su * (p.surface === 'grass' ? 1 : p.surface === 'turf' ? 0.5 : 0) * U.grass * clamp01(v / 20), t, 0.05);
      glide(sand.g.gain, su * (p.surface === 'gravel' ? U.sand * clamp01(v / 15) : 0), t, 0.05);
      // wind (kept down in the helmet), dirty-air buffeting when close behind someone
      const Wd = SOUND.wind, w = clamp01(v / Wd.vmax);
      glide(wind.g.gain, on * Y.wind * Wd.gain * M.wind * w * w, t, 0.1); glide(wind.f.frequency, 250 + 900 * w, t, 0.1);
      glide(hiss.g.gain, on * Y.wind * Wd.gain * 0.25 * M.wind * w * w * w, t, 0.1);
      glide(bAmt.gain, on * 25 * clamp01(p.slip) * w, t, 0.2);
      glide(crowd.g.gain, on * Y.crowd * SOUND.crowd.gain, t, 0.5);

      // rivals: the nearest few get a voice; voices stay on their car while it is still among them
      const near = s.rivals.map(r => ({ r, d: Math.hypot(r.x - L.x, r.y - L.y, r.z - L.z) }))
        .filter(o => o.d < R.maxDistance).sort((a, b) => a.d - b.d).slice(0, R.voices);
      const want = new Set(near.map(o => o.r.id));
      for (const vc of voices) if (vc.id !== null && !want.has(vc.id)) { vc.id = null; glide(vc.out.gain, 0, t, 0.03); }
      for (const { r, d } of near) {
        let vc = voices.find(x => x.id === r.id);
        if (!vc) { vc = voices.find(x => x.id === null); if (!vc) continue; vc.id = r.id; vc.gear = r.gear; vc.out.gain.cancelScheduledValues(t); vc.out.gain.setValueAtTime(0, t); }
        place(vc.panner, t, r.x, r.y, r.z);
        // Doppler: f' = f (c + v_listener toward source) / (c + v_source away from listener)
        let pitch = 1;
        if (s.doppler && d > 0.5) {
          const nx = (r.x - L.x) / d, ny = (r.y - L.y) / d, nz = (r.z - L.z) / d, c = SOUND.speedOfSound;
          const away = r.vx * nx + r.vz * nz, toward = L.vx * nx + (L.vy || 0) * ny + L.vz * nz;
          pitch = Math.max(0.5, Math.min(2, (c + toward) / (c + away)));
        }
        const air = Math.max(R.air.min, R.air.full * Math.exp(-d / R.air.perMetre));
        vc.voice.update({ rpm: r.rpm, thr: r.thr, on, pitch, air }, t);
        glide(vc.out.gain, on * Y.rivals * R.gain, t, 0.05);
        if (r.gear > vc.gear && d < 40) burst(ctx, vc.out, t, { type: 'highpass', freq: 1800, decay: 0.03, level: 0.2 });
        vc.gear = r.gear;
      }
    },
  };
}
