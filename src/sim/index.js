// SIM: track geometry, driving model and race rules.
// Pure JS (no DOM, no Three.js) so it also runs headless in Node: tools/sim-test.mjs, tests/.
// Units are SI throughout: metres, seconds, m/s, m/s².
import { TUNING, EV } from './tuning.js';
import { CIRCUITS } from './circuits.js';
import { DRIVERS } from './drivers.js';
import { clamp, wrapA } from './math.js';
import { buildTrack, gridSlot, headingAt, DEFAULT_TRACK } from './track.js';
import { createRace, order, gapTo, progress } from './race.js';
import { drivePlayer, driveAI } from './driving.js';
import { collide } from './collide.js';

export const SIM = Object.freeze({ TUNING, CIRCUITS, DRIVERS, EV, track: DEFAULT_TRACK,
  buildTrack, gridSlot, headingAt, createRace, drivePlayer, driveAI, collide, order, gapTo, progress, clamp, wrapA });
