// The player's choices as data: the race setup (start menu + Settings → Driving) and the prefs (Settings screen),
// validated on load, plus what they turn into for a race (format, grid, assists). Pure functions: no DOM, no
// storage (main.js reads and writes localStorage through Settings and passes the saved JSON in), so they are tested
// in Node (tests/setup-store.test.js).
import { SIM } from '../sim/index.js';
import { RACE_SETUP, PREFS, GFX_PROFILES, choiceWord } from './config.js';

const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };

// saved JSON (or null) → a complete setup; anything missing or unknown falls back to RACE_SETUP.defaults
export function loadSetup(json) {
  const d = RACE_SETUP.defaults, s = parse(json);
  const oneOf = key => RACE_SETUP.choices[key].some(([v]) => v === s[key]) ? s[key] : d[key];
  return {
    cars: Math.min(SIM.DRIVERS.length, Math.max(1, Math.round(+s.cars) || d.cars)),
    type: oneOf('type'),
    laps: Math.min(RACE_SETUP.maxLaps, Math.max(1, Math.round(+s.laps) || d.laps)),
    minutes: RACE_SETUP.minutes.includes(+s.minutes) ? +s.minutes : d.minutes,
    gearbox: oneOf('gearbox'),
    assists: oneOf('assists'),
    custom: Object.fromEntries(Object.entries(RACE_SETUP.customDefault).map(([k, v]) =>
      [k, Object.hasOwn(RACE_SETUP.customLevels, s.custom?.[k] || '') ? s.custom[k] : v])),
    ai: oneOf('ai'),
    fuel: oneOf('fuel'),
    tyres: oneOf('tyres'),
    damage: oneOf('damage'),
    aero: oneOf('aero'),
    overtake: oneOf('overtake'),
    track: Object.hasOwn(SIM.CIRCUITS, s.track || '') ? s.track : SIM.track.id,
  };
}

// saved JSON (or null) → every pref: booleans as saved, numbers clamped to PREFS.limits, text from PREFS.options (any
// string where there is no list), else PREFS.defaults
export function loadPrefs(json) {
  const s = parse(json), out = {};
  for (const [k, d] of Object.entries(PREFS.defaults)) {
    const lim = PREFS.limits[k];
    const opts = PREFS.options[k];
    if (typeof d === 'string') { out[k] = typeof s[k] === 'string' && (!opts || opts.includes(s[k])) ? s[k] : d; continue; }
    out[k] = typeof d === 'boolean' ? (typeof s[k] === 'boolean' ? s[k] : d)
      : Number.isFinite(+s[k]) && s[k] !== null && s[k] !== '' ? Math.min(lim[1], Math.max(lim[0], +s[k])) : d;
  }
  return out;
}

// controller steering smoothing level → how fast the car's steering may follow (SIM drivePlayer steerRate)
export const steerRate = prefs => prefs.smoothing ? PREFS.smoothingRate / prefs.smoothing : Infinity;

// (time trial: alone on track, laps until you stop, chasing a ghost: ghost.js)
export const raceFormat = s => s.type === 'timed' ? { type: 'timed', minutes: s.minutes }
  : s.type === 'unlimited' || s.type === 'trial' ? { type: 'unlimited' } : { type: 'laps', laps: s.laps };

// fuel / tyre / damage choices → createRace's wear option
// (time trial: none, so every lap is comparable)
export const raceWear = s => s.type === 'trial' ? {} : { fuel: s.fuel, tyres: s.tyres, damage: s.damage === 'on' };
// active aero / overtake mode choices → createRace's options
export const raceAero = s => ({ activeAero: s.aero === 'on', overtake: s.aero === 'on' && s.overtake !== 'off' });

// The grid: the fastest `cars - 1` rivals in skill order, with you about three-quarters of the way back.
// time trial: you alone
export function buildField(cars, trial = false) {
  if (trial) return SIM.DRIVERS.filter(d => d.player);
  const you = SIM.DRIVERS.find(d => d.player), rivals = SIM.DRIVERS.filter(d => !d.player).slice(0, cars - 1);
  rivals.splice(Math.round((cars - 1) * 0.78), 0, you);
  return rivals;
}
export const playerSlotOf = (cars, trial = false) => buildField(cars, trial).findIndex(d => d.player);

// The player's assists: a preset, or CUSTOM = each assist off / low / on (on = the medium preset's strength).
export function assistsOf(s) {
  if (s.assists !== 'custom') return SIM.ASSISTS[s.assists];
  const M = SIM.ASSISTS.medium, L = RACE_SETUP.customLevels, c = s.custom;
  return { steer: M.steer * L[c.steer], stability: M.stability * L[c.stability], damping: 0, tc: M.tc * L[c.tc], abs: M.abs * L[c.abs] };
}

// The start menu's line about the Settings-screen choices (gfx = GFX_PROFILES key, may be null while booting).
export function setupSummary(s, prefs, gfx) {
  const tc = assistsOf(s).tc, tcText = tc >= 1 ? '' : tc > 0 ? ' (traction control low)' : ' (no traction control)';
  return `${choiceWord('gearbox', s.gearbox)} gearbox · ${choiceWord('assists', s.assists)} assists${tcText} · ${GFX_PROFILES[gfx]?.label.replace(' mode', '') ?? ''} graphics`
    + ` · fuel ${s.fuel} · tyre wear ${s.tyres} · damage ${s.damage}`
    + (s.aero === 'on' ? ` · active aero${s.overtake === 'off' ? '' : ` + overtake ${s.overtake}`}` : ' · active aero off')
    + ` · controller smoothing ${prefs.smoothing ? prefs.smoothing : 'off'}`;
}
