// window.gridlineDebug: hooks for the desktop smoke test and `--track-shots` (desktop/main.cjs): put the camera
// anywhere on any circuit, find the current circuit's pits and corners. `setTrack(id)` switches circuit and returns
// the track; `current()` is the circuit shown now.
import { SIM } from '../sim/index.js';
import { Display } from './display.js';
import { Sound } from './sound.js';
import { Input } from './input.js';

export function installDebug(setTrack, current, player = () => null, toMenu = () => {}, loadGhost = () => {}, autopilot = () => {}, showLine = () => {}) {
  window.gridlineDebug = { soundReady: () => Sound.ready,
    autopilot,                                                         // autopilot(skill): the AI drives your car (0 = you)
    playerState: () => { const c = player(); return c && { slip: +c.slip.toFixed(2), slideR: +c.slideR.toFixed(2), lockF: c.lockF, kmh: Math.round(c.v * 3.6), idx: c.idx, lap: c.lap }; },
    toMenu, loadGhost, showLine,                                       // (showLine: the racing line on this circuit, no race needed)
    shadows: () => Display.shadowInfo(),                                // sun shadows on? map size, casters                                                 // back to the start menu; load a ghost file's text (smoke test)
    input: () => ({ ...Input.drive, device: Input.pad.label, kind: Input.pad.kind }),   // what drives the car right now
    // the player's car: speed (km/h), wings open (active aero), overtake mode
    car: () => { const c = player(); return c && { kmh: Math.round(SIM.speedOf(c) * 3.6), aeroOpen: c.aeroOpen, boostLeft: c.boostLeft, boostOn: c.boostOn }; },
    view(id, at, lat, height, ahead, side = 0) {
      const track = setTrack(id);
      const { N, PX, PZ, NX, NZ } = track, i = Math.round(at * N) % N, j = SIM.wrapIdx(i + ahead, N);
      Display.camera.position.set(PX[i] + NX[i] * lat, height, PZ[i] + NZ[i] * lat);
      Display.camera.lookAt(PX[j] + NX[j] * side, 0, PZ[j] + NZ[j] * side);
      return track.name;
    },
    // put your car in the pit lane `metres` before its box at 60 km/h, with a damaged wing and floor (pit stop shots)
    pitNow(metres = 40) {
      const c = player(), track = current(), L = track.pit; if (!c || !L) return false;
      const box = L.boxes[SIM.DRIVERS.findIndex(d => d.code === c.code)];
      c.pit = { p: box - metres / track.ds, p0: L.from - 1, lat0: L.lane, box, phase: 'in', at: 0, until: 0, service: null, done: false };
      c.v = 60 / 3.6; if (c.damage) Object.assign(c.damage, { wing: 0.5, floor: 0.2 });
      return true;
    },
    pitState: () => { const c = player(); return c?.pit ? { phase: c.pit.phase, done: c.pit.done, kmh: Math.round(c.v * 3.6) } : null; },
    pit() { const track = current(), P = track.pit, N = track.N; return P && [P.entry, P.from, P.to].map(p => SIM.wrapIdx(p, N) / N); },
    corners() { const track = current(), { N, VP } = track, out = [];   // where the speed profile bottoms out (apexes)
      for (let i = 0; i < N; i++) if (VP[i] < VP[(i + N - 1) % N] && VP[i] <= VP[(i + 1) % N] && VP[i] < 60) out.push(i / N);
      return out; },
  };
}
