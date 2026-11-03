// A car's performance spec: every per-car number the physics reads (vehicle.js, chassis.js, driving.js). STOCK is the
// shared car (CAR, CHASSIS) that every AI car races; the player's comes from the garage: carSpec(setup, mods), with
// SETUP (race setup, trade-offs) and MODS (open mods) in tuning.js. With the defaults every value is computed exactly
// as the stock one (same operations, × 1 / + 0), so the physics stays bit-identical (sim-trace).
import { TUNING, CAR, CHASSIS, SETUP, MODS, PRESSURE as PR } from './tuning.js';

const TAU = 2 * Math.PI, R_WHEEL = TUNING.WHEEL_RADIUS, { aero, engine, gearbox } = CAR;
const ITEMS = { setup: SETUP, mods: MODS };

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
export const validSetup = v => valid(SETUP, v);
export const validMods = v => valid(MODS, v);
export const defaults = group => valid(ITEMS[group]);
// true when any open mod is off its default
export const isModified = mods => Object.entries(validMods(mods)).some(([k, v]) => v !== MODS[k].def);

// a tyre pressure off stock (psi, + = higher): its grip, peak slip angle and flexing heat factors (all exactly 1 at 0)
function pressure(dp) {
  const under = Math.max(0, -dp - PR.best);
  return { grip: 1 - PR.grip * dp - PR.fold * under * under, slip: 1 - PR.slip * dp, flex: 1 - PR.flex * dp };
}
export function carSpec(setupIn, modsIn) {
  const s = validSetup(setupIn), m = validMods(modsIn);
  const pf = pressure(s.pressF - SETUP.pressF.def), pr = pressure(s.pressR - SETUP.pressR.def);
  const wing = s.wing - SETUP.wing.def, mech = s.mech - SETUP.mech.def;
  const mass = m.mass;                                   // stock = CAR.mass
  const lift = (1 + SETUP.liftPerStep * wing) * (m.downforce / 100), drag = (1 + SETUP.dragPerStep * wing) * (m.drag / 100);
  const gearK = s.gearing / gearbox.top[gearbox.top.length - 1];
  const top = gearbox.top.map(kmh => kmh * gearK);
  return Object.freeze({
    mass,
    grip: CAR.grip * (m.grip / 100),
    dfK: 0.5 * aero.rho * (aero.liftArea * lift) / mass,  // downforce / mass = dfK·v² (stock: vehicle.js DOWNFORCE_K)
    dragK: 0.5 * aero.rho * (aero.dragArea * drag) / mass,
    aeroFront: CHASSIS.aeroFront + (s.balance - SETUP.balance.def) / 100,
    frontGrip: 1 * pf.grip, rearGrip: CHASSIS.rearGrip * pr.grip,                  // (× the tyre pressures)
    peakF: CHASSIS.peakSlip * pf.slip, peakR: CHASSIS.rearPeakSlip * pr.slip,         // slip angle at the tyres' peak
    flex: Object.freeze([pf.flex, pr.flex]),                                           // × the tyres' flexing heat
    // mechanical balance = the anti-roll bars: + = a softer front (less of the sideways load transfer on it) = more front grip
    rollFront: CHASSIS.rollFront - SETUP.rollPerStep * mech,
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
  });
}
export const STOCK = carSpec();
/** @typedef {typeof STOCK} Spec */
