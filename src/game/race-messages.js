// What the player is told during a race: a HUD toast ({ toast, kind?, secs? }) or a team-radio line ({ radio, secs }).
// EVENT_MESSAGES turns a player car's SIM event into one (or null); SAY holds the other race messages. Pure data and
// functions (tests/setup-store.test.js covers them); main.js shows them with showMessage. The sounds and camera shake
// that go with some events stay in main.js.
import { SIM } from '../sim/index.js';
import { fmtTime } from './util.js';

const { EV, LIMITS } = SIM;
const DAMAGE = {
  wing: 'Front wing damage: you will have understeer. Box for a new nose.',
  floor: 'Floor damage, we are losing downforce. We can fix it in the pits.',
  susp: 'Suspension damage: the car will pull to one side. Box when you can.',
};

// type → (event, car, race) → message | null
export const EVENT_MESSAGES = {
  [EV.LAP]: (e, c, race) => {
    const lap = 'Lap ' + (c.lap - 1) + '  ' + fmtTime(e.time);
    if (e.invalid) return { toast: lap + '  invalid', kind: 'warn' };
    if (race.fastestBy === c && c.events.some(f => f.type === EV.FASTEST)) return { toast: 'Fastest lap  ' + fmtTime(e.time), kind: 'purple' };
    return { toast: lap };
  },
  // track limits: a cut invalidates the lap; past the warnings each cut is a time penalty (SIM.LIMITS)
  [EV.CUT]: (e, c) => c.cuts <= LIMITS.warnings
    ? { toast: `Track limits${e.wide ? ' (ran wide)' : ''}  warning ${c.cuts}/${LIMITS.warnings}  ·  lap invalid`, kind: 'warn', secs: 3 } : null,
  [EV.PENALTY]: e => ({ toast: `+${e.seconds} s penalty  ·  track limits  (total +${e.total} s)`, kind: 'warn', secs: 3.5 }),
  [EV.BEACHED]: () => ({ toast: 'Beached in the gravel  ·  the marshals are recovering the car', kind: 'warn', secs: SIM.OFFTRACK.recoverTime }),
  [EV.RECOVERED]: () => ({ toast: 'Back on track  ·  dirty tyres, take it easy' }),
  // pit stops and the car's condition: the team on the radio
  [EV.PIT_IN]: () => ({ radio: 'Pit limiter on. Box, box.', secs: 3 }),
  [EV.PIT_STOP]: e => {
    const s = e.service, jobs = ['tyres'];
    if (s.fuel > 0.5) jobs.push(`${Math.round(s.fuel)} kg of fuel`);
    if (s.wing) jobs.push('a new front wing');
    if (s.repair) jobs.push('repairs');
    return { radio: `Stop: ${jobs.join(', ')}. ${s.time.toFixed(1)} s.`, secs: s.time + 0.5 };
  },
  [EV.PIT_GO]: () => ({ radio: 'Go, go, go!', secs: 2 }),
  [EV.PIT_OUT]: (e, c, race) => ({ radio: `Limiter off. You're P${SIM.order(race).indexOf(c) + 1}.`, secs: 3 }),
  [EV.FUEL_LOW]: () => ({ radio: 'Fuel is getting low: about 2 laps left, not enough for the finish. Box when you can (B / pad X).', secs: 6 }),
  [EV.FUEL_BOX]: () => ({ radio: 'Box this lap or you will run out of fuel!', secs: 5 }),
  [EV.FUEL_OUT]: () => ({ radio: 'We are out of fuel: limp mode. Bring it into the pits.', secs: 6 }),
  [EV.TYRES_WORN]: () => ({ radio: 'The tyres are going off. Box for fresh ones when you are ready.', secs: 5 }),
  [EV.DAMAGE]: e => ({ radio: DAMAGE[e.part], secs: 5 }),
  // overtake mode (active-aero.js)
  [EV.BOOST_READY]: (e, c) => ({ radio: `${e.gap.toFixed(1)} s to the car ahead: overtake mode this lap.`
    + (c.boostAuto ? ' It deploys on the straights.' : ' Press X / pad View when you want it.'), secs: 4 }),
  [EV.BOOST]: (e, c) => c.boostAuto ? null : e.on ? { toast: `Overtake mode ON  ·  ${e.left.toFixed(1)} s`, secs: 1.5 }
    : e.left > 0.05 ? { toast: `Overtake mode off  ·  ${e.left.toFixed(1)} s left`, secs: 1.5 } : { toast: 'Overtake mode used up', secs: 1.5 },
};
export const messageFor = (e, c, race) => EVENT_MESSAGES[e.type]?.(e, c, race) ?? null;

// the other things said during a race
export const SAY = {
  boxOn: { radio: 'Copy, box this lap. The car takes over at the pit entry.', secs: 3 },
  boxOff: { radio: 'Understood, stay out.', secs: 3 },
  timeUp: { toast: 'Time up: the leader\'s next lap is the last' },
  autoShift: { toast: 'Automatic gearbox: pick SEMI-AUTO or MANUAL in Settings (O) to shift yourself' },
  downQueued: { toast: 'Too fast for that gear: the downshift goes in as you slow down' },
  noHud: { toast: 'Start a race to arrange the HUD' },
  boostNone: { toast: 'No overtake mode this lap: cross the line within 1 s of the car ahead' },
  boostAuto: { toast: 'Overtake mode is on AUTO: pick BUTTON in Settings → Driving to fire it yourself' },
};
