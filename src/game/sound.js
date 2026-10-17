// Live sound: the AudioContext (started on the first user gesture, as browsers require) around the sound engine
// (audio/sound-engine.js), plus mute, volumes and the test scenes. Without a context every call is a no-op.
import { createSoundEngine } from './audio/sound-engine.js';
import { loadEngineWorklet } from './audio/engine-worklet.js';
import { playScenario } from './audio/scenarios.js';

export const Sound = (() => {
  let ctx = null, engine = null, muted = false, stopTest = null, crowdAt = null, bench = false;
  const vol = { master: 0.8, engine: 1, fx: 1, ambience: 1 };
  const apply = () => engine && engine.setVolumes({ ...vol, master: muted ? 0 : vol.master });
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      // the engine model runs on the audio thread: load it, then build the sound
      loadEngineWorklet(ctx).then(() => {
        engine = createSoundEngine(ctx); apply();
        if (crowdAt) engine.setCrowd(...crowdAt);
      }).catch(() => { engine = null; });
    } catch (e) { ctx = engine = null; }
  }
  return {
    init,
    get ready() { return !!engine; },
    beep(freq, dur) { if (engine && !muted) engine.beep(freq, dur); },
    impact(strength, kind) { if (engine && !muted) engine.impact(strength, kind); },
    whoosh(side, strength) { if (engine && !muted) engine.whoosh(side, strength); },
    frame(state) { if (engine && !stopTest && !bench) engine.frame(state); },
    // Sound Studio test bench: while on, the studio drives the sound instead of the race
    bench(on) { bench = !!on; if (on) init(); },
    benchFrame(state) { if (engine && bench && !stopTest) engine.frame(state); },
    refresh() { engine?.refresh(); },   // after editing SOUND
    setCrowd(x, y, z) { crowdAt = [x, y, z]; if (engine) engine.setCrowd(x, y, z); },
    // volumes 0..1: master, engine, fx, ambience
    setVolumes(v) { Object.assign(vol, v); apply(); },
    setMuted(m) { muted = !!m; apply(); },
    get muted() { return muted; },
    // test scenes (audio/scenarios.js); the game's own sound pauses while one plays
    test(name, onEnd) {
      init(); if (!engine) { setTimeout(() => engine && this.test(name, onEnd), 300); return; }
      stopTest?.();
      const done = () => { stopTest = null; onEnd?.(); };
      const end = playScenario(engine, name, ctx.currentTime, true, done);
      stopTest = () => { end(); done(); };
    },
    stopTest() { stopTest?.(); },
  };
})();
