// Telemetry: the car's whole state at every track sample of a lap or a practice run (pure; tests/telemetry.test.js).
// 2026-11-12, user: laps and practice runs should record "car properties state such as tyres, fuel, steering angles, gas
// and brake pedals, downforce experienced and all the information that a car would need to drive it".
// The lap traces (lap-analysis.js) keep t / kmh / thr / brk / x / z / h / gear as before; this adds the rest as
// channels: `createTelemetry(n)` → { [id]: Float32Array(n) }, `writeTelemetry(tel, i, c)` fills sample i from a car,
// `packTelemetry` / `unpackTelemetry` = the saved form (per channel: quantised, delta, zigzag varint bytes in base64;
// runs of samples not reached as [from, count]). Nothing here writes into the car (the sim never sees it).
// Downforce isn't kept on the car (src/sim stays as it is: the leaderboard's SIM_VERSION): it is worked out here from the
// same terms chassis.js uses (speed², the car's downforce factor, dirty air, the wings stalling in a slide, damage,
// straight mode); only an off-stock suspension's floor height is left out.
import { SIM } from '../sim/index.js';

const G = 9.81, DEG = 180 / Math.PI;
const SURF = ['track', 'kerb', 'sausage', 'turf', 'tarmac', 'grass', 'gravel', 'pit'];
const nz = v => Number.isFinite(v) ? v : NaN;
// the car's downforce now, N
export function downforceOf(c) {
  const s = c.spec, cls = s.cls, OT = SIM.OFFTRACK, v = c.v, beta = Math.atan2(Math.abs(c.vy), Math.abs(v) || 1e-6);
  const stall = Math.min(1, Math.max(0, (beta - OT.spinFrom) / (OT.spinTo - OT.spinFrom)));
  const yaw = 1 - (1 - OT.spinFloor) * stall * stall * (3 - 2 * stall), cond = SIM.carCondition(c);
  return s.dfK * v * v * (1 - cls.chassis.dirtyAir * (c.slip || 0)) * yaw * cond.aero * (1 - cls.activeAero.downforceCut * (c.aeroOpen || 0)) * s.mass;
}
// the road wheels' angle, ° (+ = right): the steering through the lock the car has at this speed with its assists
const wheelOf = c => c.steer * SIM.steerLock(c.v, (c.assists || SIM.ASSISTS.medium).steer, c.spec, c.maxSteer) * DEG;
const tyre = (c, layer, k) => c.tyreT ? c.tyreT[layer][k] : NaN;

// [id, label, unit, quantum (units per stored step), value from the car]
export const CHANNELS = Object.freeze([
  ['steer', 'Steering input', '%', 0.1, c => (c.steerIn ?? c.steer) * 100],
  ['wheel', 'Road-wheel angle', '°', 0.01, wheelOf],
  ['rpm', 'Engine / motor', 'rpm', 10, c => c.rpm],
  ['glat', 'Lateral g', 'g', 0.01, c => c.ay / G],
  ['glong', 'Longitudinal g', 'g', 0.01, c => c.ax / G],
  ['yaw', 'Yaw rate', '°/s', 0.1, c => c.yawRate * DEG],
  ['slipAng', 'Slip angle', '°', 0.1, c => Math.atan2(c.vy, Math.abs(c.v) || 1e-6) * DEG],
  ['df', 'Downforce', 'kN', 0.01, c => downforceOf(c) / 1000],
  ['tFL', 'Tyre FL surface', '°C', 0.1, c => tyre(c, 's', 0)], ['tFR', 'Tyre FR surface', '°C', 0.1, c => tyre(c, 's', 1)],
  ['tRL', 'Tyre RL surface', '°C', 0.1, c => tyre(c, 's', 2)], ['tRR', 'Tyre RR surface', '°C', 0.1, c => tyre(c, 's', 3)],
  ['kFL', 'Tyre FL core', '°C', 0.1, c => tyre(c, 'k', 0)], ['kFR', 'Tyre FR core', '°C', 0.1, c => tyre(c, 'k', 1)],
  ['kRL', 'Tyre RL core', '°C', 0.1, c => tyre(c, 'k', 2)], ['kRR', 'Tyre RR core', '°C', 0.1, c => tyre(c, 'k', 3)],
  ['wear', 'Tyre wear', '%', 0.01, c => c.tyreWear * 100],
  ['fuel', 'Fuel', 'kg', 0.01, c => Number.isFinite(c.fuel) ? c.fuel : NaN],
  ['soc', 'Battery', 'MJ', 0.001, c => c.soc / 1e6],
  ['ers', 'ERS power', 'kW', 1, c => c.ersKw],
  ['aero', 'Straight mode', '%', 1, c => (c.aeroOpen || 0) * 100],
  ['tow', 'Slipstream', '%', 1, c => (c.slip || 0) * 100],
  ['lat', 'Across the road', 'm', 0.01, c => c.lat],
  ['slideF', 'Front sliding', '%', 1, c => c.slideF * 100], ['slideR', 'Rear sliding', '%', 1, c => c.slideR * 100],
  ['lockF', 'Front lock-up', '%', 1, c => (c.frontLock || 0) * 100], ['lockR', 'Rear lock-up', '%', 1, c => (c.rearLock || 0) * 100],
  ['spin', 'Wheelspin', '%', 1, c => (c.rearSpin || 0) * 100],
  ['surface', 'Surface', '', 1, c => Math.max(0, SURF.indexOf(c.surface))],
  ['boost', 'Overtake / attack', '', 1, c => (c.boostOn ? 1 : 0) + (c.attackOn ? 2 : 0)],
  ['ecu', 'ECU map', '', 1, c => c.ecuMode ? c.ecuMap : NaN],
]);
export const CHANNEL = Object.freeze(Object.fromEntries(CHANNELS.map(([id, label, unit, q]) => [id, { id, label, unit, q }])));
export const SURFACE_NAMES = SURF;

export const createTelemetry = n => Object.fromEntries(CHANNELS.map(([id]) => [id, new Float32Array(n).fill(NaN)]));
export function writeTelemetry(tel, i, c) {
  for (const [id, , , , of] of CHANNELS) { let v; try { v = of(c); } catch (e) { v = NaN; } tel[id][i] = nz(v); }
}
// sample i's values copied to j (the samples passed in one sim step get the same values)
export const copyTelemetry = (tel, from, to) => { for (const [id] of CHANNELS) tel[id][to] = tel[id][from]; };

// ---- saved form ----
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => { const s = atob(str), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
function packChannel(arr, q) {
  const bytes = [], gaps = []; let last = 0, gap = -1, any = false;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) { if (gap < 0) gap = i; continue; }
    if (gap >= 0) { gaps.push(gap, i - gap); gap = -1; }
    any = true;
    const k = Math.round(v / q), d = k - last; last = k;
    let z = d >= 0 ? d * 2 : -d * 2 - 1;                     // zigzag, then 7 bits a byte
    while (z >= 128) { bytes.push((z % 128) | 128); z = Math.floor(z / 128); }
    bytes.push(z);
  }
  if (gap >= 0) gaps.push(gap, arr.length - gap);
  return any ? { d: b64(Uint8Array.from(bytes)), ...(gaps.length ? { g: gaps } : {}) } : null;
}
function unpackChannel(p, q, n) {
  const out = new Float32Array(n).fill(NaN);
  if (!p || typeof p.d !== 'string') return out;
  let bytes; try { bytes = unb64(p.d); } catch (e) { return out; }
  const skip = new Uint8Array(n), g = Array.isArray(p.g) ? p.g : [];
  for (let j = 0; j + 1 < g.length; j += 2) for (let i = g[j]; i < Math.min(n, g[j] + g[j + 1]); i++) skip[i] = 1;
  let b = 0, last = 0;
  for (let i = 0; i < n && b < bytes.length; i++) {
    if (skip[i]) continue;
    let z = 0, m = 1, x;
    do { x = bytes[b++]; z += (x & 127) * m; m *= 128; } while (x & 128 && b < bytes.length);
    last += z % 2 ? -(z + 1) / 2 : z / 2;
    out[i] = last * q;
  }
  return out;
}
// one array on its own (quantum q): the practice runs' speed, pedals, positions
export const packSeries = (arr, q) => arr ? packChannel(arr, q) : null;
export const unpackSeries = (p, q, n) => p ? unpackChannel(p, q, n) : null;
// (one already packed is passed on as it is)
export const packTelemetry = tel => !tel || tel.v === 1 && tel.ch ? tel ?? null : { v: 1, n: tel.steer.length, ch: Object.fromEntries(CHANNELS.map(([id, , , q]) => [id, tel[id] ? packChannel(tel[id], q) : null])) };
// back to arrays of n (null when it isn't a saved telemetry of that length); channels it doesn't have are NaN
export function unpackTelemetry(p, n) {
  if (!p || p.v !== 1 || p.n !== n || !p.ch || typeof p.ch !== 'object') return null;
  return Object.fromEntries(CHANNELS.map(([id, , , q]) => [id, unpackChannel(p.ch[id], q, n)]));
}
