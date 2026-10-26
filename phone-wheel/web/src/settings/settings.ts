// Settings: defaults, saving them on this phone (profiles), and the curve math they drive. Pure (localStorage only in
// loadStore / saveStore), tested in test/settings.test.ts. (Same storage key as the first pages: their profiles load.)

// Bit order is the wire protocol: bit i of `k` = BUTTONS[i] (phonewheel/protocol.py BUTTON_NAMES and
// desktop/phone-link.cjs BUTTONS use the same order).
export const BUTTONS = [
  ['A', 'A'], ['B', 'B'], ['X', 'X'], ['Y', 'Y'],
  ['LB', 'Left bumper'], ['RB', 'Right bumper'],
  ['BACK', 'Back / View'], ['START', 'Start / Menu'], ['GUIDE', 'Guide (Xbox)'],
  ['LS', 'Left stick click'], ['RS', 'Right stick click'],
  ['UP', 'D-pad up'], ['DOWN', 'D-pad down'], ['LEFT', 'D-pad left'], ['RIGHT', 'D-pad right'],
] as const;
export type ButtonId = (typeof BUTTONS)[number][0];
const IDS: readonly ButtonId[] = BUTTONS.map((b) => b[0]);
export const bitOf = (id: ButtonId) => Math.max(0, IDS.indexOf(id));
export const KEYBOARD_KEYS = '1234567890-'; // keyboard mode (server.py --keyboard): A..RS press these keys
export const MAX_BUTTONS = 8;

export type PedalMode = 'ramp' | 'slide' | 'instant';
export interface PedalCfg { mode: PedalMode; rampTime: number; min: number; curve: number; max: number }
export interface SteerCfg { sensitivity: number; smoothing: number; deadzone: number; curve: number; invert: boolean }
export interface ButtonCfg { label: string; bind: ButtonId; toggle: boolean }
export interface FlickCfg { on: boolean; distance: number; time: number; down: ButtonId; up: ButtonId }
export type ButtonSize = 's' | 'm' | 'l';
// shiftButtons: the UPSHIFT / DOWNSHIFT keys beside the pedals (they send flick.up / flick.down); swapShift puts
// upshift beside the gas instead of the brake.
// putDown: stop sending and ask "are you there?" when the phone is put down flat or dropped (engine/presence.ts)
export interface LayoutCfg { swapPedals: boolean; pedalSize: number; buttonSize: ButtonSize; showWheel: boolean; haptics: boolean; shiftButtons: boolean; swapShift: boolean; putDown: boolean; dash: boolean }
// force feedback from the game (engine/haptics.ts): strength × every effect, and which effects play
export interface FeedbackCfg { on: boolean; strength: number; hits: boolean; kerbs: boolean; offTrack: boolean; slides: boolean; shifts: boolean; lock: boolean }
export interface Config { steer: SteerCfg; gas: PedalCfg; brake: PedalCfg; buttons: ButtonCfg[]; flick: FlickCfg; layout: LayoutCfg; feedback: FeedbackCfg }
// v: store format; 2 (2026-10-21) = profiles have been given the REAR (look back) button once
export interface Store { active: string; profiles: Record<string, Config>; v?: number }
export const STORE_VERSION = 2;

export const DEFAULTS: Config = {
  steer: { sensitivity: 40, smoothing: 20, deadzone: 0, curve: 1, invert: false },
  gas: { mode: 'ramp', rampTime: 1.5, min: 0.2, curve: 1, max: 1 },
  brake: { mode: 'ramp', rampTime: 1.5, min: 0.2, curve: 1, max: 1 },
  // Gridline GP: X = box this lap, RS (held) = look back (shifting has its own keys)
  buttons: [{ label: 'BOX', bind: 'X', toggle: false }, { label: 'REAR', bind: 'RS', toggle: false }],
  // flick a thumb sideways toward the screen centre while on a pedal to shift: brake = down, gas = up
  // (`distance` px within `time` ms, mostly sideways); each flick taps the bound button once
  flick: { on: true, distance: 40, time: 160, down: 'LB', up: 'RB' },
  layout: { swapPedals: false, pedalSize: 1, buttonSize: 'm', showWheel: true, haptics: true, shiftButtons: true, swapShift: false, putDown: true, dash: true },
  feedback: { on: true, strength: 1, hits: true, kerbs: true, offTrack: true, slides: true, shifts: false, lock: true },
};

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Loose = Record<string, unknown> | undefined | null;
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function pedal(raw: unknown, d: PedalCfg): PedalCfg {
  const p = obj(raw);
  return {
    mode: pick(p.mode, ['ramp', 'slide', 'instant'] as const, d.mode),
    rampTime: num(p.rampTime, d.rampTime, 0.1, 5),
    min: num(p.min, d.min, 0, 1),
    curve: num(p.curve, d.curve, 0.3, 3),
    max: num(p.max, d.max, 0.1, 1),
  };
}

// Fill in anything missing or out of range, so old or hand-edited profiles always load.
export function sanitize(input: unknown): Config {
  const s = obj(input), D = DEFAULTS, st = obj(s.steer), l = obj(s.layout), f = obj(s.flick), fb = obj(s.feedback);
  const buttons = Array.isArray(s.buttons) ? s.buttons : D.buttons;
  return {
    steer: {
      sensitivity: num(st.sensitivity, D.steer.sensitivity, -35, 70),
      smoothing: num(st.smoothing, D.steer.smoothing, 0, 90),
      deadzone: num(st.deadzone, D.steer.deadzone, 0, 20),
      curve: num(st.curve, D.steer.curve, 0.3, 3),
      invert: bool(st.invert, D.steer.invert),
    },
    gas: pedal(s.gas, D.gas),
    brake: pedal(s.brake, D.brake),
    buttons: buttons.slice(0, MAX_BUTTONS).map((raw: unknown, i: number) => {
      const b = obj(raw);
      return { label: typeof b.label === 'string' ? b.label.slice(0, 4) : String(i + 1), bind: pick(b.bind, IDS, 'A'), toggle: bool(b.toggle, false) };
    }),
    flick: {
      on: bool(f.on, D.flick.on),
      distance: num(f.distance, D.flick.distance, 15, 120),
      time: num(f.time, D.flick.time, 80, 400),
      down: pick(f.down, IDS, D.flick.down),
      up: pick(f.up, IDS, D.flick.up),
    },
    layout: {
      swapPedals: bool(l.swapPedals, D.layout.swapPedals),
      pedalSize: num(l.pedalSize, D.layout.pedalSize, 0.6, 1.6),
      buttonSize: pick(l.buttonSize, ['s', 'm', 'l'] as const, D.layout.buttonSize),
      showWheel: bool(l.showWheel, D.layout.showWheel),
      haptics: bool(l.haptics, D.layout.haptics),
      shiftButtons: bool(l.shiftButtons, D.layout.shiftButtons),
      dash: bool(l.dash, D.layout.dash),
      swapShift: bool(l.swapShift, D.layout.swapShift),
      putDown: bool(l.putDown, D.layout.putDown),
    },
    feedback: {
      on: bool(fb.on, D.feedback.on),
      strength: num(fb.strength, D.feedback.strength, 0.3, 2),
      hits: bool(fb.hits, D.feedback.hits),
      kerbs: bool(fb.kerbs, D.feedback.kerbs),
      offTrack: bool(fb.offTrack, D.feedback.offTrack),
      slides: bool(fb.slides, D.feedback.slides),
      shifts: bool(fb.shifts, D.feedback.shifts),
      lock: bool(fb.lock, D.feedback.lock),
    },
  };
}

// ---------- storage: { active: name, profiles: { name: settings } }
const STORE_KEY = 'pw-store';

// raw: the saved JSON (tests pass it in); in the page it comes from localStorage
export function loadStore(raw: string | null = readStorage(STORE_KEY)): Store {
  let data: Loose = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  const profiles: Record<string, Config> = {};
  for (const [name, p] of Object.entries(obj(data?.profiles))) profiles[name] = sanitize(p);
  // older stores: add the REAR button to every profile that has room and doesn't use RS yet (once; removing it sticks)
  if (!(Number(data?.v) >= 2)) for (const c of Object.values(profiles))
    if (c.buttons.length < MAX_BUTTONS && !c.buttons.some((b) => b.bind === 'RS')) c.buttons.push({ label: 'REAR', bind: 'RS', toggle: false });
  const names = Object.keys(profiles);
  if (names.length) return { active: typeof data?.active === 'string' && profiles[data.active] ? data.active : names[0], profiles, v: STORE_VERSION };
  return { active: 'Default', profiles: { Default: sanitize(clone(DEFAULTS)) }, v: STORE_VERSION };
}
export function saveStore(store: Store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode: not saved */ }
}
function readStorage(key: string): string | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}

// ---------- curves
// p = how far the pedal is pushed, 0..1 (hold time for "ramp", finger height for "slide").
export function pedalValue(p: number, c: PedalCfg) {
  if (c.mode === 'instant') return c.max;
  const t = clamp(p, 0, 1);
  return (c.min + (1 - c.min) * Math.pow(t, c.curve)) * c.max;
}
// v = raw steering -1..1. Curve > 1 gives finer control near center, < 1 makes it twitchier.
export function steerCurve(v: number, c: SteerCfg) {
  const a = Math.abs(v), dz = c.deadzone / 100;
  if (a <= dz) return 0;
  return Math.sign(v) * Math.pow((a - dz) / (1 - dz), c.curve);
}

// ---------- flick to shift
// One pointer's recent positions → true when it has just moved `distance` px toward `dir` (+1 right, -1 left)
// within `time` ms, at least twice as far sideways as up/down. After a flick the history restarts, so the thumb
// can come back and flick again.
export function createFlick() {
  let pts: { x: number; y: number; t: number }[] = [];
  return {
    reset() { pts = []; },
    add(x: number, y: number, t: number, dir: number, c: FlickCfg) {
      pts.push({ x, y, t });
      while (pts.length && t - pts[0].t > c.time) pts.shift();
      for (const p of pts) {
        const dx = (x - p.x) * dir, dy = Math.abs(y - p.y);
        if (dx >= c.distance && dx >= 2 * dy) { pts = [{ x, y, t }]; return true; }
      }
      return false;
    },
  };
}
