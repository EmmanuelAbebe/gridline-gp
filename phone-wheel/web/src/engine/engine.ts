// The hot path: tilt → steering, pedal / button state, and the 60 Hz WebSocket feed to the PC. Kept outside React on
// purpose: the UI reads `state` / `link` every animation frame and writes pedals and buttons, so rendering can never
// delay an input. The wire protocol is unchanged from the old page (desktop/phone-link.cjs, phonewheel/webapp.py):
//   phone → PC  {s, g, b, k} at ~60 Hz (steer −1..1, gas 0..1, brake 0..1, button bitmask), every 500 ms plus
//               p (probe sequence) and r (our last round trip); a = away (presence.ts: 1 put down, 2 dropped), sent with
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
let flipped = false, lastOrientation = 0;
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

export function center() { offsetDeg = smoothDeg; }

// ---------- force feedback: the game's {fx} → vibration (not while Settings is open, unless it is a test)
let fxPlan = idlePlan(), testUntil = 0, testTimer = 0;
const vibrate = (p: number[]) => { try { navigator.vibrate?.(p.length ? p : 0); } catch { /* not allowed yet */ } };
export function feedback(fx: Fx, test = false) {
  if (!cfg || (!test && (state.paused || performance.now() < testUntil))) return;
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
// The steering angle (degrees) of "up" (ax, ay: the opposite of gravity in phone axes) for the current screen rotation.
export function tiltDegrees(ax: number, ay: number, angle = screenAngle()) {
  const a = ((angle % 360) + 360) % 360;
  let ux = 0, uy = 1;                          // portrait fallback
  if (a === 90) { ux = 1; uy = 0; }            // landscape, top of the phone on the left
  if (a === 270) { ux = -1; uy = 0; }          // landscape, top of the phone on the right
  // Some Android builds report gravity with the opposite sign. Only re-decide while the phone is near level, so a big
  // tilt past 90 degrees can't flip it.
  const dot = ax * ux + ay * uy;
  if (Math.abs(dot) > 0.7 * Math.hypot(ax, ay)) flipped = dot < 0;
  if (flipped) { ux = -ux; uy = -uy; }
  return Math.atan2(ux * ay - uy * ax, ux * ax + uy * ay) * (180 / Math.PI);
}
function steerFromDegrees(deg: number, smoothing: number) {
  if (!cfg) return;
  state.gotMotion = true;
  rawDeg = deg;
  smoothDeg = wrap(smoothDeg + wrap(rawDeg - smoothDeg) * smoothing);
  let v = wrap(smoothDeg - offsetDeg) / fullLockDeg;
  v = steerCurve(Math.max(-1, Math.min(1, v)), cfg.steer);
  state.steer = cfg.steer.invert ? -v : v;
}
// Chrome's deviceorientation is fused from gyro + accelerometer by Android, so it reacts much faster than raw
// accelerometer data; devicemotion is only the fallback.
function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null || state.preview) return;
  lastOrientation = performance.now();
  const R = Math.PI / 180, b = e.beta * R, c = e.gamma * R;      // "up" in phone axes from the beta / gamma angles
  steerFromDegrees(tiltDegrees(-Math.cos(b) * Math.sin(c), Math.sin(b)), follow);
}
// ---------- put down / dropped (presence.ts): stop sending inputs and ask "are you there?"
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
    link.quality = grade();
  }, 16);
  setTimeout(center, 400);                      // the starting position is straight ahead
}
