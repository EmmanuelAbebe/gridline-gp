// The hot path: tilt → steering, pedal / button state, and the 60 Hz WebSocket feed to the PC. Kept outside React on
// purpose: the UI reads `state` / `link` every animation frame and writes pedals and buttons, so rendering can never
// delay an input. The wire protocol is unchanged from the old page (desktop/phone-link.cjs, phonewheel/webapp.py):
//   phone → PC  {s, g, b, k} at ~60 Hz (steer −1..1, gas 0..1, brake 0..1, button bitmask), every 500 ms plus
//               p (probe sequence) and r (our last round trip); a = 1 away (presence.ts: on a table / left alone 10 s), sent with
//               everything else at 0 until the driver taps "I'm here"
//   PC → phone  {pong, hz, gap} for each probe, and {fx} = force feedback (haptics.ts);  GET /check?t= tells a refused socket "wrong pairing code" apart
import { steerCurve, bitOf, type Config, type ButtonId } from '../settings/settings.ts';
import { idlePlan, planFeedback, type Fx } from './haptics.ts';
import { createPresence, type Away } from './presence.ts';

export type Phase = 'idle' | 'connecting' | 'connected' | 'lost' | 'unpaired';
export interface Status { phase: Phase; retryAt: number; attempts: number }

export const state = { steer: 0, gas: 0, brake: 0, gotMotion: false, paused: false, preview: false, away: 0 as Away };
export const link = { rtt: null as number | null, rttMax: null as number | null, hz: 0, gap: 0, sendGap: 0, quality: '' as '' | 'good' | 'fair' | 'poor' | 'stalled' };
let status: Status = { phase: 'idle', retryAt: 0, attempts: 0 };
export const getStatus = () => status;

// Pairing code from the QR link (?t=...), remembered so opening the bare address later still works.
// (read on first use, so the module also loads in Node for the tests)
let token: string | null = null;
function getToken() {
  if (token !== null) return token;
  token = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('t') || '';
  try {
    if (token) localStorage.setItem('pw-token', token);
    else token = localStorage.getItem('pw-token') || '';
  } catch { /* storage blocked */ }
  return token;
}
export const hasToken = () => !!getToken();

let cfg: Config | null = null;
let fullLockDeg = 45, follow = 0.8;
let rawDeg = 0, smoothDeg = 0, offsetDeg = 0;
let lastOrientation = 0, lastGravity = 0;
const held = new Map<number, number>();       // on-screen button index → bit it presses
let buttonsKey = '';
let ws: WebSocket | null = null, started = false, retryTimer = 0;
const PING_EVERY = 500;                        // ms between round-trip probes
const listeners = new Set<(s: Status) => void>();

export function setConfig(c: Config) {
  cfg = c;
  fullLockDeg = 85 - c.steer.sensitivity;      // higher sensitivity = less tilt for full lock
  follow = 1 - c.steer.smoothing / 100;        // 0 smoothing = raw sensor angle
  const key = JSON.stringify(c.buttons);
  if (key !== buttonsKey) { buttonsKey = key; held.clear(); }   // bindings changed: let go of everything
}

export function onStatus(fn: (s: Status) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setStatus(next: Partial<Status>) { status = { ...status, ...next }; listeners.forEach((fn) => fn(status)); }

export function setButton(index: number, down: boolean) {
  const b = cfg?.buttons[index];
  if (down && b) held.set(index, bitOf(b.bind)); else held.delete(index);
}
// Button taps (flick to shift): each is held PULSE_MS so the game sees it for several frames; taps of the same
// button in quick succession are spaced PULSE_GAP_MS apart so each one is a separate press.
const PULSE_MS = 80, PULSE_GAP_MS = 50;
let pulses: { bit: number; start: number; end: number }[] = [];
export function tap(id: ButtonId) {
  const bit = bitOf(id), now = performance.now();
  const last = pulses.filter((p) => p.bit === bit).reduce((m, p) => Math.max(m, p.end), -Infinity);
  const start = Math.max(now, last + PULSE_GAP_MS);
  pulses.push({ bit, start, end: start + PULSE_MS });
}
function keys() {
  let k = 0;
  for (const bit of held.values()) k |= 1 << bit;
  const now = performance.now();
  pulses = pulses.filter((p) => p.end > now);
  for (const p of pulses) if (p.start <= now) k |= 1 << p.bit;
  return k;
}

// straight ahead = where the phone is now (and which way up it is held is decided again)
export function center() {
  if (base !== null) { const b = baseFor(lastUp, lastAngle); smoothDeg = rawDeg = wrap(smoothDeg + base - b); base = b; farSince = 0; }
  offsetDeg = smoothDeg;
}

// ---------- force feedback: the game's {fx} → vibration (not while Settings is open, unless it is a test)
let fxPlan = idlePlan(), testUntil = 0, testTimer = 0;
const vibrate = (p: number[]) => { try { navigator.vibrate?.(p.length ? p : 0); } catch { /* not allowed yet */ } };
// Full lock is felt from the phone's own steering (2026-10-26): at once, with any game or server, and never cut short by
// the wheel's own reading folding back. The game's l / ls are ignored; the rest of its message is kept for 150 ms.
const LOCK = { on: 0.98, off: 0.94, renew: 50, fresh: 150 };
let locked = false, gameFx: Fx = {}, gameFxAt = -Infinity, lockSent = 0;
function withLock(fx: Fx, knock = false): Fx { return { ...fx, l: locked ? 1 : 0, ls: knock ? 1 : undefined }; }
function lockTick(now: number) {
  const a = Math.abs(state.steer), was = locked;
  locked = !state.away && !state.preview && (locked ? a >= LOCK.off : a >= LOCK.on);
  const fx = now - gameFxAt < LOCK.fresh ? gameFx : {};
  if (locked && !was) { feedback(withLock(fx, true), false, true); lockSent = now; }
  else if (locked && now - lockSent >= LOCK.renew && now - gameFxAt >= LOCK.renew) { feedback(withLock(fx), false, true); lockSent = now; }
  else if (!locked && was) feedback(withLock(fx), false, true);
}
export function feedback(fx: Fx, test = false, local = false) {
  if (!cfg || (!test && (state.paused || performance.now() < testUntil))) return;
  if (!test && !local) { gameFx = fx; gameFxAt = performance.now(); fx = withLock(fx); }
  const r = planFeedback(fx, cfg.feedback, performance.now(), fxPlan);
  fxPlan = r.state;
  if (r.pattern) vibrate(r.pattern);
}
// a touch buzz (screen.ts) took over the motor for `ms`: the game's rumble starts again after it
export function feedbackInterrupted(ms: number) { fxPlan = { ...idlePlan(), busyUntil: performance.now() + ms }; }
export function stopFeedback() { clearInterval(testTimer); testUntil = 0; feedback({}, true); }
// Settings → Feedback test buttons: play `fx` the way the game would send it (20 per second) for `ms`
export function testFeedback(fx: Fx, ms = 1500) {
  clearInterval(testTimer);
  testUntil = performance.now() + ms;
  feedback(fx, true);
  const once = { ...fx, h: undefined, g: undefined };   // one-off moments only in the first message
  testTimer = window.setInterval(() => {
    if (performance.now() >= testUntil) { clearInterval(testTimer); testUntil = 0; feedback({}, true); return; }
    feedback(once, true);
  }, 50);
}

// ---------- tilt → steering angle
const wrap = (d: number) => ((d + 540) % 360) - 180;   // keep the math continuous across the ±180 seam

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  const w = window as unknown as { orientation?: number };
  return typeof w.orientation === 'number' ? w.orientation : 90;
}
// Which way "up" points in the phone's own x-y plane when it is held straight (degrees: 0 = +x, landscape with the top on
// the left; 180 = landscape the other way round, or a phone that reports gravity with the opposite sign; ±90 portrait).
// Decided from the phone's position at the start and on every re-centre, then kept while driving (2026-10-26): it used
// to follow the screen's rotation and re-decide whenever the phone looked nearly level, so turning the wheel past 90°
// (the phone upright: the screen turns to portrait) or past 135° switched the steering round.
let base: number | null = null, farSince = 0, lastUp = 0, lastAngle = 90;
const TILT = { far: 150, farMs: 1500 };   // held further round than this for this long = the phone is held the other way up now
function baseFor(up: number, angle: number) {
  const a = ((angle % 360) + 360) % 360, portrait = a === 0 || a === 180;
  const options = portrait ? [90, -90] : [0, 180];
  return options.reduce((b, o) => (Math.abs(wrap(up - o)) < Math.abs(wrap(up - b)) ? o : b));
}
// The steering angle (degrees) of "up" (ax, ay: the opposite of gravity in phone axes).
export function tiltDegrees(ax: number, ay: number, angle = screenAngle(), now = performance.now()) {
  const up = Math.atan2(ay, ax) * (180 / Math.PI);
  lastUp = up; lastAngle = angle;
  if (base === null) base = baseFor(up, angle);
  if (Math.abs(wrap(up - base)) > TILT.far) {
    if (!farSince) farSince = now;
    else if (now - farSince > TILT.farMs) { base = baseFor(up, angle); farSince = 0; }
  } else farSince = 0;
  return wrap(up - base);
}
export function resetTilt() { base = null; farSince = 0; }
function steerFromDegrees(deg: number, smoothing: number) {
  if (!cfg) return;
  state.gotMotion = true;
  rawDeg = deg;
  smoothDeg = wrap(smoothDeg + wrap(rawDeg - smoothDeg) * smoothing);
  let v = wrap(smoothDeg - offsetDeg) / fullLockDeg;
  v = steerCurve(Math.max(-1, Math.min(1, v)), cfg.steer);
  state.steer = cfg.steer.invert ? -v : v;
}
// Best: Chrome's GravitySensor = the fused gravity vector itself (no angles to fold over when the phone stands upright).
interface GravityReading { x: number | null; y: number | null; start(): void; addEventListener(t: string, f: () => void): void }
function startGravity() {
  const G = (window as unknown as { GravitySensor?: new (o: { frequency: number }) => GravityReading }).GravitySensor;
  if (!G) return;
  try {
    const sensor = new G({ frequency: 60 });
    sensor.addEventListener('reading', () => {
      if (state.preview || sensor.x == null || sensor.y == null) return;
      lastGravity = lastOrientation = performance.now();
      steerFromDegrees(tiltDegrees(sensor.x, sensor.y), follow);
    });
    sensor.addEventListener('error', () => { lastGravity = 0; });
    sensor.start();
  } catch { /* not allowed: the orientation events do it */ }
}
// Chrome's deviceorientation is fused from gyro + accelerometer by Android, so it reacts much faster than raw
// accelerometer data; devicemotion is only the fallback.
function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null || state.preview || performance.now() - lastGravity < 250) return;
  lastOrientation = performance.now();
  const R = Math.PI / 180, b = e.beta * R, c = e.gamma * R;      // "up" in phone axes from the beta / gamma angles
  steerFromDegrees(tiltDegrees(-Math.cos(b) * Math.sin(c), Math.sin(b)), follow);
}
// ---------- put down (presence.ts): stop sending inputs and ask "are you there?"
const presence = createPresence();
const awayListeners = new Set<(a: Away) => void>();
export function onAway(fn: (a: Away) => void) { awayListeners.add(fn); return () => { awayListeners.delete(fn); }; }
function watchPresence(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity, r = e.rotationRate;
  if (!g || g.x == null || g.y == null || g.z == null || state.paused || state.preview || !cfg?.layout.putDown) return;
  const before = state.away;
  state.away = presence.sample({ ax: g.x, ay: g.y, az: g.z, rate: r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) : 0 }, performance.now());
  if (state.away && !before) { held.clear(); pulses = []; try { navigator.vibrate?.([120, 80, 120]); } catch { /* no motor */ } awayListeners.forEach((fn) => fn(state.away)); }
}
// "I'm here": straight ahead is where the phone is now, and the inputs flow again
// Settings → Layout preview of the screen (and the desktop preview, which has no sensors)
export function testAway() { state.away = 1; held.clear(); awayListeners.forEach((fn) => fn(1)); }
export function back() { presence.back(); state.away = 0; center(); awayListeners.forEach((fn) => fn(0)); }

function onMotion(e: DeviceMotionEvent) {
  watchPresence(e);
  if (state.preview || performance.now() - lastOrientation < 250) return;   // fused data is flowing: use that
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  steerFromDegrees(tiltDegrees(g.x, g.y), Math.min(follow, 0.35));          // the accelerometer is noisy: always smooth it
}
// Desktop preview (preview.ts): a fake tilt in degrees, through the same smoothing and curve as the real one.
export function previewTilt(deg: number) { state.preview = true; steerFromDegrees(deg, follow); }

// ---------- link quality
// hz = messages the PC received in the last second, gap = its longest pause between them in the last 5 s (Wi-Fi
// stalls show up there), sendGap = our own longest pause in the last 2 s (Android throttling the page's timers).
const pingSent = new Map<number, number>(), rtts: number[] = [], sendTimes: number[] = [];
let pingSeq = 0, lastPing = 0, lastPong = 0;
function grade(): typeof link.quality {
  if (status.phase !== 'connected') return '';
  if (performance.now() - lastPong > 2000 && lastPing - lastPong > 1500) return 'stalled';
  const r = link.rtt ?? 999, gap = Math.max(link.gap, link.sendGap);
  return r <= 25 && gap <= 60 ? 'good' : r <= 60 && gap <= 150 ? 'fair' : 'poor';
}
function onPong(d: { pong: number; hz?: number; gap?: number }, now: number) {
  const sent = pingSent.get(d.pong);
  if (sent === undefined) return;
  for (const k of pingSent.keys()) if (k <= d.pong) pingSent.delete(k);
  rtts.push(now - sent); if (rtts.length > 10) rtts.shift();
  const sorted = [...rtts].sort((a, b) => a - b);
  link.rtt = Math.round(sorted[sorted.length >> 1]);
  link.rttMax = Math.round(sorted[sorted.length - 1]);
  link.hz = d.hz || 0; link.gap = d.gap || 0;
  lastPong = now;
}
function noteSend(now: number) {
  sendTimes.push(now);
  while (sendTimes.length && now - sendTimes[0] > 2000) sendTimes.shift();
  let g = 0; for (let i = 1; i < sendTimes.length; i++) g = Math.max(g, sendTimes[i] - sendTimes[i - 1]);
  link.sendGap = Math.round(g);
}

// ---------- connection: connect, and after a drop retry (1 s, or 3 s when the pairing code was refused)
function connect() {
  clearTimeout(retryTimer);
  const t = encodeURIComponent(getToken());
  setStatus({ phase: 'connecting', attempts: status.attempts + 1 });
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?t=${t}`);
  ws = sock;
  sock.onopen = () => {
    rtts.length = 0; pingSent.clear(); link.rtt = link.rttMax = null; lastPong = performance.now();
    setStatus({ phase: 'connected', attempts: 0 });
  };
  sock.onmessage = (e) => {
    let d: unknown = null; try { d = JSON.parse(e.data); } catch { return; }
    if (d && typeof (d as { pong?: unknown }).pong === 'number') onPong(d as { pong: number }, performance.now());
    else if (d && typeof (d as { fx?: unknown }).fx === 'object') feedback((d as { fx: Fx }).fx);
  };
  sock.onclose = async () => {
    if (ws !== sock) return;                    // replaced by reconnect()
    feedback({});                               // nothing more is coming: let the motor stop
    // a browser can't see why a WebSocket failed, so ask whether the pairing code is the problem
    let paired: boolean | null = null;
    try { paired = (await fetch(`/check?t=${t}`, { cache: 'no-store' })).ok; } catch { paired = null; }
    if (ws !== sock) return;
    const wait = paired === false ? 3000 : 1000;
    setStatus({ phase: paired === false ? 'unpaired' : 'lost', retryAt: performance.now() + wait });
    retryTimer = window.setTimeout(connect, wait);
  };
  sock.onerror = () => sock.close();
}
// The Reconnect button: drop the socket (if any) and connect again now.
export function reconnect() {
  if (!started) return;
  const old = ws; ws = null;
  if (old) { old.onclose = null; old.close(); }
  setStatus({ attempts: 0 });
  connect();
}

export function start() {
  if (started) return;
  started = true;
  startGravity();
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  connect();
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    const p = state.paused;                     // settings open: pedals and buttons let go, steering stays live
    const now = performance.now(), a = state.away;
    const msg: Record<string, number> = a ? { s: 0, g: 0, b: 0, k: 0, a }   // put down / dropped: nothing but the reason
      : { s: +state.steer.toFixed(3), g: p ? 0 : +state.gas.toFixed(3), b: p ? 0 : +state.brake.toFixed(3), k: p ? 0 : keys() };
    if (now - lastPing >= PING_EVERY) {
      msg.p = ++pingSeq; pingSent.set(pingSeq, now); lastPing = now;
      if (link.rtt !== null) msg.r = link.rtt;
    }
    ws.send(JSON.stringify(msg));
    noteSend(now);
    if (!p) lockTick(now);
    link.quality = grade();
  }, 16);
  setTimeout(center, 400);                      // the starting position is straight ahead
}
