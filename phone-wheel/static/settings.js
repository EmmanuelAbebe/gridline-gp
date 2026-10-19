// Settings: defaults, saving them on this phone, profiles, and the curve math they drive.

// Bit order is the wire protocol: bit i of `k` = BUTTONS[i]. The server maps the same order.
export const BUTTONS = [
  ["A", "A"], ["B", "B"], ["X", "X"], ["Y", "Y"],
  ["LB", "Left bumper"], ["RB", "Right bumper"],
  ["BACK", "Back / View"], ["START", "Start / Menu"], ["GUIDE", "Guide (Xbox)"],
  ["LS", "Left stick click"], ["RS", "Right stick click"],
  ["UP", "D-pad up"], ["DOWN", "D-pad down"], ["LEFT", "D-pad left"], ["RIGHT", "D-pad right"],
];
export const bitOf = (id) => Math.max(0, BUTTONS.findIndex((b) => b[0] === id));
export const KEYBOARD_KEYS = "1234567890-"; // keyboard mode: A..RS press these keys; the D-pad isn't sent
export const MAX_BUTTONS = 8;

export const DEFAULTS = {
  steer: { sensitivity: 40, smoothing: 20, deadzone: 0, curve: 1, invert: false },
  gas:   { mode: "ramp", rampTime: 1.5, min: 0.2, curve: 1, max: 1 },
  brake: { mode: "ramp", rampTime: 1.5, min: 0.2, curve: 1, max: 1 },
  buttons: [
    { label: "1", bind: "A", toggle: false },
    { label: "2", bind: "B", toggle: false },
    { label: "3", bind: "X", toggle: false },
  ],
  // flick a thumb sideways toward the screen centre while on a pedal to shift: brake = down, gas = up
  // (`distance` px within `time` ms, mostly sideways); each flick taps the bound button once
  flick: { on: true, distance: 40, time: 160, down: "LB", up: "RB" },
  layout: { swapPedals: false, pedalSize: 1, buttonSize: "m", showWheel: true, quickSliders: true, haptics: true },
};

export const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d, lo, hi) => (typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : d);
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const pick = (v, options, d) => (options.includes(v) ? v : d);

function pedal(p, d) {
  p = p || {};
  return {
    mode: pick(p.mode, ["ramp", "slide", "instant"], d.mode),
    rampTime: num(p.rampTime, d.rampTime, 0.1, 5),
    min: num(p.min, d.min, 0, 1),
    curve: num(p.curve, d.curve, 0.3, 3),
    max: num(p.max, d.max, 0.1, 1),
  };
}

// Fill in anything missing or out of range, so old or hand-edited profiles always load.
export function sanitize(s) {
  s = s || {};
  const D = DEFAULTS, st = s.steer || {}, l = s.layout || {}, f = s.flick || {};
  const ids = BUTTONS.map((b) => b[0]);
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
    buttons: (Array.isArray(s.buttons) ? s.buttons : D.buttons).slice(0, MAX_BUTTONS).map((b, i) => ({
      label: b && typeof b.label === "string" ? b.label.slice(0, 4) : String(i + 1),
      bind: pick(b && b.bind, ids, "A"),
      toggle: bool(b && b.toggle, false),
    })),
    flick: {
      on: bool(f.on, D.flick.on),
      distance: num(f.distance, D.flick.distance, 15, 120),
      time: num(f.time, D.flick.time, 80, 400),
      down: pick(f.down, ids, D.flick.down),
      up: pick(f.up, ids, D.flick.up),
    },
    layout: {
      swapPedals: bool(l.swapPedals, D.layout.swapPedals),
      pedalSize: num(l.pedalSize, D.layout.pedalSize, 0.6, 1.6),
      buttonSize: pick(l.buttonSize, ["s", "m", "l"], D.layout.buttonSize),
      showWheel: bool(l.showWheel, D.layout.showWheel),
      quickSliders: bool(l.quickSliders, D.layout.quickSliders),
      haptics: bool(l.haptics, D.layout.haptics),
    },
  };
}

// ---------- storage: { active: name, profiles: { name: settings } }
const STORE_KEY = "pw-store";

export function loadStore() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) {}
  if (raw && raw.profiles && typeof raw.profiles === "object") {
    const profiles = {};
    for (const [name, p] of Object.entries(raw.profiles)) profiles[name] = sanitize(p);
    const names = Object.keys(profiles);
    if (names.length) return { active: profiles[raw.active] ? raw.active : names[0], profiles };
  }
  const first = clone(DEFAULTS);
  // Carry over the two sliders saved by the previous version of the page.
  try {
    const sens = localStorage.getItem("pw-sens"), smooth = localStorage.getItem("pw-smooth");
    if (sens !== null) first.steer.sensitivity = Number(sens);
    if (smooth !== null) first.steer.smoothing = Number(smooth);
  } catch (_) {}
  return { active: "Default", profiles: { Default: sanitize(first) } };
}

export function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
}

// ---------- curves
// p = how far the pedal is pushed, 0..1 (hold time for "ramp", finger height for "slide").
export function pedalValue(p, c) {
  if (c.mode === "instant") return c.max;
  const t = clamp(p, 0, 1);
  return (c.min + (1 - c.min) * Math.pow(t, c.curve)) * c.max;
}

// v = raw steering -1..1. Curve > 1 gives finer control near center, < 1 makes it twitchier.
export function steerCurve(v, c) {
  const a = Math.abs(v), dz = c.deadzone / 100;
  if (a <= dz) return 0;
  return Math.sign(v) * Math.pow((a - dz) / (1 - dz), c.curve);
}

// ---------- flick to shift
// One pointer's recent positions -> true when it has just moved `distance` px toward `dir` (+1 right, -1 left)
// within `time` ms, at least twice as far sideways as up/down. After a flick the history restarts, so the thumb
// can come back and flick again.
export function createFlick() {
  let pts = [];
  return {
    reset() { pts = []; },
    add(x, y, t, dir, c) {
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
