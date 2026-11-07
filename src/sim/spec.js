// A car's performance spec: every per-car number the physics reads (vehicle.js, chassis.js, driving.js), made from its
// car class (classes/: the car's tables; car classes step 1, docs/car-classes-plan.md). stockOf(cls) is the class's
// shared car that every AI car races (STOCK = the 2026 F1's); the player's comes from the garage: carSpec(setup, mods,
// cls), with the class's setup (race setup, trade-offs) and mods (open mods). With the defaults every value is computed
// exactly as the stock one (same operations, × 1 / + 0), so the physics stays bit-identical (sim-trace). spec.cls = the
// class it was made from.
import { TUNING } from './tuning.js';
import { F1_2026 } from './classes/f1-2026.js';

const TAU = 2 * Math.PI, R_WHEEL = TUNING.WHEEL_RADIUS;
/** @typedef {typeof F1_2026} CarClass */

// one group's values, each clamped to its range and snapped to its step; anything missing or not a number = default
function valid(table, values = {}) {
  const out = {};
  for (const [k, r] of Object.entries(table)) {
    if (typeof r !== 'object') continue;
    const v = +values[k];
    out[k] = Number.isFinite(v) && values[k] !== null && values[k] !== '' ? Math.min(r.max, Math.max(r.min, Math.round((v - r.min) / r.step) * r.step + r.min)) : r.def;
    out[k] = +out[k].toFixed(6);       // no 57.49999999 from the step arithmetic
  }
  return out;
}
// (old saves: one `mech` −5 … +5, + = a softer front anti-roll bar, for the two anti-roll bars)
const fromMech = (v, SETUP) => v && SETUP.arbF && Number.isFinite(+v.mech) && v.mech !== null && v.arbF === undefined && v.arbR === undefined
  ? { ...v, arbF: SETUP.arbF.def - Math.round(+v.mech), arbR: SETUP.arbR.def + Math.round(+v.mech) } : v;
export const validSetup = (v, cls = F1_2026) => valid(cls.setup, fromMech(v, cls.setup));
export const validMods = (v, cls = F1_2026) => valid(cls.mods, v);
/** @param {'setup' | 'mods'} group */
export const defaults = (group, cls = F1_2026) => valid(cls[group]);
// true when any open mod is off its default
export const isModified = (mods, cls = F1_2026) => Object.entries(validMods(mods, cls)).some(([k, v]) => v !== cls.mods[k].def);

// a tyre pressure off stock (psi, + = higher): its grip, peak slip angle and flexing heat factors (all exactly 1 at 0)
function pressure(PR, dp) {
  const under = Math.max(0, -dp - PR.best);
  return { grip: 1 - PR.grip * dp - PR.fold * under * under, slip: 1 - PR.slip * dp, flex: 1 - PR.flex * dp };
}
// the suspension off stock (SUSPENSION; chassis.js): null when it is all stock (nothing to do then)
const SUSP_KEYS = ['springF', 'springR', 'rideF', 'rideR', 'camberF', 'camberR', 'toeF', 'toeR'];
function suspension(SU, SETUP, s, step) {
  if (SUSP_KEYS.every(k => step(k) === 0)) return null;
  const C = SU.camber, camber = k => {                     // x = ° more negative than stock
    const x = -step(k), past = Math.max(0, x - C.best);
    return { lat: 1 + C.lat * x - C.over * past * past, long: 1 - C.long * x };
  };
  const cf = camber('camberF'), cr = camber('camberR');
  return Object.freeze({
    kF: SU.kF * (1 + SU.springPerStep * step('springF')), kR: SU.kR * (1 + SU.springPerStep * step('springR')),
    rideF: s.rideF, rideR: s.rideR,
    stiff: (step('springF') + step('springR')) / 2 / (SETUP.springF.max - SETUP.springF.def),
    latF: cf.lat, latR: cr.lat, longF: cf.long / cf.lat, longR: cr.long / cr.lat,     // (long: of what the lat-scaled grip gives)
    toeOut: -step('toeF'), toeIn: step('toeR'),
  });
}
// the dampers off stock (DAMPER; chassis.js): null when stock. cF / cR = each axle's roll damping vs stock (bump and
// rebound together), dive / rise = the pitch damping as the nose goes down (front bump, rear rebound) / up, bump = the bump steps over stock / 5 (kerb strikes), linger = s a kerb's grip loss stays
function dampers(DA, SETUP, step) {
  const keys = ['bumpF', 'bumpR', 'reboundF', 'reboundR'];
  if (keys.every(k => step(k) === 0)) return null;
  const c = k => 1 + DA.perStep * step(k), span = SETUP.bumpF.max - SETUP.bumpF.def;
  return Object.freeze({
    cF: (c('bumpF') + c('reboundF')) / 2, cR: (c('bumpR') + c('reboundR')) / 2,
    dive: (c('bumpF') + c('reboundR')) / 2, rise: (c('reboundF') + c('bumpR')) / 2,
    bump: (step('bumpF') + step('bumpR')) / 2 / span,
    linger: DA.linger * Math.max(0, (step('reboundF') + step('reboundR')) / 2),
  });
}
/** @param {CarClass} cls */
export function carSpec(setupIn, modsIn, cls = F1_2026) {
  const { car: CAR, chassis: CHASSIS, setup: SETUP, mods: MODS, pressure: PR, suspension: SU, damper: DA } = cls, { aero, engine, gearbox } = CAR;
  const s = validSetup(setupIn, cls), m = validMods(modsIn, cls);
  const pf = pressure(PR, s.pressF - SETUP.pressF.def), pr = pressure(PR, s.pressR - SETUP.pressR.def);
  const wing = s.wing - SETUP.wing.def, step = k => s[k] - SETUP[k].def;
  const toeOff = Math.abs(s.toeF) + Math.abs(s.toeR) - (Math.abs(SETUP.toeF.def) + Math.abs(SETUP.toeR.def));
  const mass = m.mass;                                   // stock = CAR.mass
  const lift = (1 + SETUP.liftPerStep * wing) * (m.downforce / 100), drag = (1 + SETUP.dragPerStep * wing) * (m.drag / 100);
  const gearK = s.gearing / gearbox.top[gearbox.top.length - 1];
  const top = gearbox.top.map(kmh => kmh * gearK);
  return Object.freeze({
    mass,
    grip: CAR.grip * (m.grip / 100),
    dfK: 0.5 * aero.rho * (aero.liftArea * lift) / mass,  // downforce / mass = dfK·v² (stock: vehicle.js DOWNFORCE_K)
    dragK: 0.5 * aero.rho * (aero.dragArea * drag) / mass * (1 + SU.toe.drag * toeOff),
    aeroFront: CHASSIS.aeroFront + (s.balance - SETUP.balance.def) / 100,
    frontGrip: 1 * pf.grip, rearGrip: CHASSIS.rearGrip * pr.grip,                  // (× the tyre pressures)
    peakF: CHASSIS.peakSlip * pf.slip, peakR: CHASSIS.rearPeakSlip * pr.slip,         // slip angle at the tyres' peak
    flex: Object.freeze([pf.flex, pr.flex]),                                           // × the tyres' flexing heat
    // the share of the sideways load transfer on the front: a stiffer front anti-roll bar / spring takes more (less front grip)
    rollFront: CHASSIS.rollFront + SETUP.rollPerStep * (step('arbF') - step('arbR')) / 2 + SU.rollSpring * (step('springF') - step('springR')) / 2,
    susp: suspension(SU, SETUP, s, step),
    damp: dampers(DA, SETUP, step),
    brakeBias: s.brakes / 100,                           // front share of the braking
    brakeMigration: s.migration / 100,                   // how much further forward the balance moves as the pedal comes off
    engineBrake: 1 + SETUP.engineBrakePerStep * (s.engineBrake - SETUP.engineBrake.def),   // × the engine braking and lift-off harvest
    // the differential's lock vs stock per phase (entry, mid, exit): −1 = fully open … +1 = fully locked (chassis.js, DIFF)
    diff: Object.freeze(['diffEntry', 'diffMid', 'diffExit'].map(k => (s[k] - SETUP[k].def) / (SETUP[k].max - SETUP[k].def))),
    brakeSystem: CHASSIS.brakeSystem * (m.brakes / 100),
    power: m.power / 100,
    top,                                                 // km/h at the redline per gear
    ratio: top.map(kmh => kmh ? (engine.redline * TAU / 60) / (kmh / 3.6 / R_WHEEL) : 0),
    modified: Object.entries(m).some(([k, v]) => v !== MODS[k].def),
    setup: Object.freeze(s), mods: Object.freeze(m),
    cls,                                                 // the car class it was made from
  });
}
// a class's stock car (made once per class: every car of a race shares it, so a spec can be compared by identity)
const stocks = new Map();
/** @param {CarClass} cls @returns {Spec} */
export const stockOf = cls => stocks.get(cls) || stocks.set(cls, carSpec(undefined, undefined, cls)).get(cls);
export const STOCK = stockOf(F1_2026);
/** @typedef {ReturnType<typeof carSpec>} Spec */
