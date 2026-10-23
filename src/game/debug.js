// window.gridlineDebug: hooks for the desktop smoke test and `--track-shots` (desktop/main.cjs): put the camera
// anywhere on any circuit, find the current circuit's pits and corners. `setTrack(id)` switches circuit and returns
// the track; `current()` is the circuit shown now.
import { SIM } from '../sim/index.js';
import { createGround } from './ground.js';
import { Display } from './display.js';
import { Sound } from './sound.js';
import { Input } from './input.js';

export function installDebug(setTrack, current, player = () => null, toMenu = () => {}, loadGhost = () => {}, autopilot = () => {}, showLine = () => {}, setPref = () => {}) {
  window.gridlineDebug = { soundReady: () => Sound.ready,
    autopilot,                                                         // autopilot(skill): the AI drives your car (0 = you)
    playerState: () => { const c = player(); return c && { slip: +c.slip.toFixed(2), slideR: +c.slideR.toFixed(2), lockF: c.lockF, kmh: Math.round(c.v * 3.6), idx: c.idx, lap: c.lap }; },
    toMenu, loadGhost, showLine, setPref,                              // (setPref(key, value): a Settings choice, e.g. hudMirror)
                                          // (showLine: the racing line on this circuit, no race needed)
    shadows: () => Display.shadowInfo(),                                // sun shadows on? map size, casters                                                 // back to the start menu; load a ghost file's text (smoke test)
    input: () => ({ ...Input.drive, device: Input.pad.label, kind: Input.pad.kind }),   // what drives the car right now
    // the player's car: speed (km/h), wings open (active aero), overtake mode
    car: () => { const c = player(); return c && { kmh: Math.round(SIM.speedOf(c) * 3.6), aeroOpen: c.aeroOpen, boostLeft: c.boostLeft, boostOn: c.boostOn }; },
    view(id, at, lat, height, ahead, side = 0) {
      const track = setTrack(id);
      const { N, PX, PZ, NX, NZ } = track, i = Math.round(at * N) % N, j = SIM.wrapIdx(i + ahead, N);
      Display.camera.position.set(PX[i] + NX[i] * lat, height + SIM.surfaceY(track, i, lat), PZ[i] + NZ[i] * lat);   // (heights over the road)
      Display.camera.lookAt(PX[j] + NX[j] * side, SIM.surfaceY(track, j, side), PZ[j] + NZ[j] * side);
      return track.name;
    },
    // put your car in the fast lane `metres` before its box at 60 km/h, with a damaged wing and floor (pit stop shots);
    // from there you drive it (pit.js drivePitLane picks it up)
    pitNow(metres = 40) {
      const c = player(), track = current(), L = track.pit; if (!c || !L) return false;
      const box = L.boxes[SIM.DRIVERS.findIndex(d => d.code === c.code)], i = SIM.wrapIdx(Math.round(box - metres / track.ds), track.N);
      Object.assign(c, { idx: i, lat: L.lane, x: track.PX[i] + track.NX[i] * L.lane, z: track.PZ[i] + track.NZ[i] * L.lane,
        h: Math.atan2(track.TZ[i], track.TX[i]), v: 60 / 3.6, vy: 0, yawRate: 0, pit: null, pitRequest: true });
      if (c.damage) Object.assign(c.damage, { wing: 0.5, floor: 0.2 });
      return true;
    },
    pitState: () => { const c = player(); return c?.pit ? { phase: c.pit.phase, done: c.pit.done, kmh: Math.round(c.v * 3.6) } : null; },
    // a hilly circuit: where it climbs and drops the most (fractions of the lap), or null on the flat
    hills() { const E = current().elev; if (!E) return null; let up = 0, down = 0;
      for (let i = 0; i < E.SX.length; i++) { if (E.SX[i] > E.SX[up]) up = i; if (E.SX[i] < E.SX[down]) down = i; }
      return [up, down].map(i => i / E.SX.length); },
    circuit: () => current().id,                                        // the circuit shown now
    // the most banked sample (fraction of the lap) and its bank (rad), or null below 3°
    banked() { const E = current().elev; if (!E) return null; let b = 0; for (let i = 0; i < E.BANK.length; i++) if (Math.abs(E.BANK[i]) > Math.abs(E.BANK[b])) b = i;
      return Math.abs(E.BANK[b]) > 0.05 ? [b / E.BANK.length, E.BANK[b]] : null; },
    // a bridge: [the middle of the upper road's bridge, the road below it] (fractions of the lap), or null
    bridge() { const T = current(), b = createGround(T).bridge, on = []; for (let i = 0; i < T.N; i++) if (b[i]) on.push(i);
      if (!on.length) return null; const m = on[on.length >> 1]; let best = Infinity, lo = 0;
      for (let j = 0; j < T.N; j++) if (!b[j] && Math.min(SIM.wrapIdx(j - m, T.N), SIM.wrapIdx(m - j, T.N)) > 100) { const d = Math.hypot(T.PX[j] - T.PX[m], T.PZ[j] - T.PZ[m]); if (d < best) { best = d; lo = j; } }
      return [m / T.N, lo / T.N]; },
    pit() { const track = current(), P = track.pit, N = track.N; return P && [P.entry, P.from, P.to].map(p => SIM.wrapIdx(p, N) / N); },
    corners() { const track = current(), { N, VP } = track, out = [];   // where the speed profile bottoms out (apexes)
      for (let i = 0; i < N; i++) if (VP[i] < VP[(i + N - 1) % N] && VP[i] <= VP[(i + 1) % N] && VP[i] < 60) out.push(i / N);
      return out; },
  };
}
