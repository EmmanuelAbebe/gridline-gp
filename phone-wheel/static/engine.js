// The hot path: tilt -> steering, pedal/button state, and the 60 Hz WebSocket feed to the PC.
// Kept outside Preact on purpose; the UI only reads `state` (and writes pedals/buttons).
import { steerCurve, bitOf } from "./settings.js";

export const state = { steer: 0, gas: 0, brake: 0, connected: false, paired: null, gotMotion: false, paused: false };

// Pairing code from the QR link (?t=...). Remembered so opening the bare address later still works.
let token = new URLSearchParams(location.search).get("t") || "";
try {
  if (token) localStorage.setItem("pw-token", token);
  else token = localStorage.getItem("pw-token") || "";
} catch (_) {}
export const hasToken = () => !!token;

let cfg = null;
let fullLockDeg = 45, follow = 0.8;
let rawDeg = 0, smoothDeg = 0, offsetDeg = 0;
let flipped = false, lastOrientation = 0;
const held = new Map(); // on-screen button index -> bit it presses
let buttonsKey = "";
let ws = null, started = false;
const PING_EVERY = 500; // ms between round-trip probes
const statusListeners = new Set();

export function setConfig(c) {
  cfg = c;
  fullLockDeg = 85 - c.steer.sensitivity; // higher sensitivity = less tilt for full lock
  follow = 1 - c.steer.smoothing / 100;   // 0 smoothing = raw sensor angle
  const key = JSON.stringify(c.buttons);
  if (key !== buttonsKey) { buttonsKey = key; held.clear(); } // bindings changed, let go of everything
}

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}
function setLink(connected, paired) {
  state.connected = connected;
  state.paired = paired;
  statusListeners.forEach((fn) => fn({ connected, paired }));
}

export function setButton(index, down) {
  if (down && cfg.buttons[index]) held.set(index, bitOf(cfg.buttons[index].bind));
  else held.delete(index);
}
// Button taps (flick to shift): each is held PULSE_MS so the PC's game sees it for several frames; taps of the same
// button in quick succession are spaced PULSE_GAP_MS apart so each one is a separate press.
const PULSE_MS = 80, PULSE_GAP_MS = 50;
let pulses = []; // { bit, start, end }
export function tap(id) {
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

// ---------- tilt -> steering angle
const wrap = (d) => ((d + 540) % 360) - 180; // keep math continuous across the +/-180 seam

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
  return typeof window.orientation === "number" ? window.orientation : 90;
}

function tiltDegrees(ax, ay) {
  const a = ((screenAngle() % 360) + 360) % 360;
  // "Up" direction for a level wheel in this orientation, in phone sensor axes.
  let ux = 0, uy = 1;                       // portrait fallback
  if (a === 90)  { ux = 1;  uy = 0; }       // landscape, top of phone on the left
  if (a === 270) { ux = -1; uy = 0; }       // landscape, top of phone on the right
  // Some Android builds report gravity with the opposite sign. Only re-decide while the
  // phone is near level, so a big tilt past 90 degrees can't flip it.
  const dot = ax * ux + ay * uy;
  if (Math.abs(dot) > 0.7 * Math.hypot(ax, ay)) flipped = dot < 0;
  if (flipped) { ux = -ux; uy = -uy; }
  return Math.atan2(ux * ay - uy * ax, ux * ax + uy * ay) * (180 / Math.PI);
}

function updateSteer(ux, uy, smoothing) {
  state.gotMotion = true;
  rawDeg = tiltDegrees(ux, uy);
  smoothDeg = wrap(smoothDeg + wrap(rawDeg - smoothDeg) * smoothing);
  let v = wrap(smoothDeg - offsetDeg) / fullLockDeg;
  v = steerCurve(Math.max(-1, Math.min(1, v)), cfg.steer);
  state.steer = cfg.steer.invert ? -v : v;
}

// Chrome's deviceorientation is fused from gyro + accelerometer by Android, so it reacts
// much faster than raw accelerometer data. devicemotion is only the fallback.
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  lastOrientation = performance.now();
  // "Up" (opposite of gravity) in phone axes, from the beta/gamma Euler angles.
  const R = Math.PI / 180, b = e.beta * R, c = e.gamma * R;
  updateSteer(-Math.cos(b) * Math.sin(c), Math.sin(b), follow);
}
function onMotion(e) {
  if (performance.now() - lastOrientation < 250) return; // fused data is flowing, use that
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  updateSteer(g.x, g.y, Math.min(follow, 0.35)); // accelerometer is noisy, always smooth it some
}

// ---------- link quality
// Every PING_EVERY ms an input message carries `p` (a sequence number); the server answers {pong, hz, gap}
// at once, so the round trip is measured on the same socket and path as the steering. hz = messages the server
// received in the last second, gap = the longest pause between them in the last 5 s (Wi-Fi stalls show up there).
// `r` (our latest round trip) rides along so the PC page can show it too.
export const link = { rtt: null, rttMax: null, hz: 0, gap: 0, sendGap: 0, quality: "" };
const pingSent = new Map(), rtts = [], sendTimes = [];
let pingSeq = 0, lastPing = 0, lastPong = 0;

function grade() {
  if (!state.connected) return "";
  if (performance.now() - lastPong > 2000 && lastPing - lastPong > 1500) return "stalled";
  const r = link.rtt ?? 999, gap = Math.max(link.gap, link.sendGap);
  return r <= 25 && gap <= 60 ? "good" : r <= 60 && gap <= 150 ? "fair" : "poor";
}
function onPong(d, now) {
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
// Longest pause between our own sends in the last 2 s: Android slows timers when the page is throttled.
function noteSend(now) {
  sendTimes.push(now);
  while (sendTimes.length && now - sendTimes[0] > 2000) sendTimes.shift();
  let g = 0; for (let i = 1; i < sendTimes.length; i++) g = Math.max(g, sendTimes[i] - sendTimes[i - 1]);
  link.sendGap = Math.round(g);
}

// ---------- connection
function connect() {
  const t = encodeURIComponent(token);
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?t=${t}`);
  ws.onopen = () => { rtts.length = 0; pingSent.clear(); link.rtt = link.rttMax = null; lastPong = performance.now(); setLink(true, true); };
  ws.onmessage = (e) => {
    let d = null; try { d = JSON.parse(e.data); } catch (_) { return; }
    if (d && typeof d.pong === "number") onPong(d, performance.now());
  };
  ws.onclose = async () => {
    // A browser can't see why a WebSocket failed, so ask whether the pairing code is the problem.
    let paired = null;
    try { paired = (await fetch(`/check?t=${t}`, { cache: "no-store" })).ok; } catch (_) {}
    setLink(false, paired);
    setTimeout(connect, paired === false ? 3000 : 1000);
  };
  ws.onerror = () => ws.close();
}

export function start() {
  if (started) return;
  started = true;
  window.addEventListener("deviceorientation", onOrientation);
  window.addEventListener("devicemotion", onMotion);
  connect();
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    const p = state.paused; // settings open: pedals and buttons are let go, steering stays live
    const now = performance.now(), msg = {
      s: +state.steer.toFixed(3),
      g: p ? 0 : +state.gas.toFixed(3),
      b: p ? 0 : +state.brake.toFixed(3),
      k: p ? 0 : keys(),
    };
    if (now - lastPing >= PING_EVERY) {
      msg.p = ++pingSeq; pingSent.set(pingSeq, now); lastPing = now;
      if (link.rtt !== null) msg.r = link.rtt;
    }
    ws.send(JSON.stringify(msg));
    noteSend(now);
    link.quality = grade();
  }, 16);
  setTimeout(center, 400); // treat the starting position as center
}
