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
  [EV.BEACHED]: e => ({ toast: `${e.flipped ? 'Over on its side' : 'Beached in the gravel'}  ·  the marshals are recovering the car`, kind: 'warn', secs: SIM.OFFTRACK.recoverTime }),
  // airborne (SIM airborne.js) and a front wing half breaking off
  [EV.LANDED]: e => e.flipped || e.impact < 2 ? null : ({ radio: `Big landing${e.impact > 5 ? ': check the floor and suspension' : ''}. Are you OK?`, secs: 4 }),
  [EV.WING_OFF]: e => ({ radio: `You've lost the ${e.side} side of the front wing: understeer. Box for a new nose.`, secs: 5 }),
  [EV.RECOVERED]: () => ({ toast: 'Back on track  ·  dirty tyres, take it easy' }),
  // pit stops and the car's condition: the team on the radio
  [EV.PIT_IN]: (e, c) => ({ radio: c.limiterAuto || c.limiterOn ? 'Pit limiter on, 80. Stop in your box for the crew.'
    : 'Limiter! Limiter! 80 in the pit lane.', secs: 3 }),
  [EV.PIT_STOP]: e => {
    const s = e.service, jobs = [s.compound ? `${s.compound}s` : 'tyres'];
    if (s.fuel > 0.5) jobs.push(`${Math.round(s.fuel)} kg of fuel`);
    if (s.wing) jobs.push('a new front wing');
    if (s.repair) jobs.push('repairs');
    return { radio: `Stop: ${jobs.join(', ')}. ${s.time.toFixed(1)} s.`, secs: s.time + 0.5 };
  },
  [EV.PIT_READY]: () => ({ radio: 'Done. Go, go, go!', secs: 2 }),
  [EV.PIT_GO]: () => ({ radio: 'Go, go, go!', secs: 2 }),
  [EV.PIT_OUT]: (e, c, race) => ({ radio: `${c.limiterAuto ? 'Limiter off. ' : c.limiterOn ? 'Limiter off now. ' : ''}You're P${SIM.order(race).indexOf(c) + 1}.`, secs: 3 }),
  // your own pit limiter and straight mode (Settings → Driving BUTTON)
  [EV.LIMITER]: e => ({ toast: e.on ? 'Pit limiter ON  ·  80 km/h' : 'Pit limiter off', secs: 1.5 }),
  [EV.PIT_SPEEDING]: e => ({ toast: `+${e.seconds} s penalty  ·  speeding in the pit lane (${Math.round(e.kmh)} km/h)  (total +${e.total} s)`, kind: 'warn', secs: 4 }),
  [EV.AERO]: e => e.press && !e.zone ? { toast: 'Straight mode only in the zones (green on the map)', secs: 1.5 } : null,
  [EV.FUEL_LOW]: () => ({ radio: 'Fuel is getting low: about 2 laps left, not enough for the finish. Box when you can (B / pad X).', secs: 6 }),
  [EV.FUEL_BOX]: () => ({ radio: 'Box this lap or you will run out of fuel!', secs: 5 }),
  [EV.FUEL_OUT]: () => ({ radio: 'We are out of fuel: limp mode. Bring it into the pits.', secs: 6 }),
  [EV.TYRES_WORN]: () => ({ radio: 'The tyres are going off. Box for fresh ones when you are ready.', secs: 5 }),
  [EV.TYRES_WARM]: () => ({ radio: 'Tyres are up to temperature. Push now.', secs: 4 }),
  [EV.TYRES_HOT]: e => ({ radio: `${e.axle === 'rear' ? 'Rears' : 'Fronts'} are overheating. Look after them: fewer slides${e.axle === 'rear' ? ' and less wheelspin' : ''}.`, secs: 5 }),
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
  coldTyres: { radio: 'Tyres are cold off the blankets: take care into the first corners.', secs: 4 },
  boxOff: { radio: 'Understood, stay out.', secs: 3 },
  timeUp: { toast: 'Time up: the leader\'s next lap is the last' },
  autoShift: { toast: 'Automatic gearbox: pick SEMI-AUTO or MANUAL in Settings (O) to shift yourself' },
  downQueued: { toast: 'Too fast for that gear: the downshift goes in as you slow down' },
  noHud: { toast: 'Start a race to arrange the HUD' },
  boostNone: { toast: 'No overtake mode this lap: cross the line within 1 s of the car ahead' },
  boostAuto: { toast: 'Overtake mode is on AUTO: pick BUTTON in Settings → Driving to fire it yourself' },
  aeroOff: { toast: 'Active aero is off for this race (Settings → Driving)' },
  aeroAuto: { toast: 'Straight mode is on AUTO: pick BUTTON in Settings → Driving to open the wings yourself' },
  limiterAuto: { toast: 'The pit limiter is on AUTO: pick BUTTON in Settings → Driving to use your own' },
};
// box this lap, with the tyres the crew has ready: the pit plan's compound, or the team's choice
export const boxMessage = plan => ({ radio: `Copy, box this lap. ${plan.tyres === 'auto' ? 'We pick the tyres' : plan.tyres === 'same' ? 'Same tyres' : `${plan.tyres[0].toUpperCase()}${plan.tyres.slice(1)}s`} ready for you.`, secs: 3 });
