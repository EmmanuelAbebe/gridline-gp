// The racing line on the road (2026-10-20, user: "a racing line with colour code showing the most optimal line, where
// the colour shows the braking path, like established sim games"). Drawn from the ALIEN's best lap (ai-ghosts.js
// aiLap: the fastest the AI drives the circuit, on the race's active-aero setting): a ribbon of forward chevrons along
// where that car really went, green on the throttle, amber lifting / coasting, red on the brakes (deeper red = harder).
// Modes (pref racingLine): full = the whole lap; braking = only the braking zones, fading in before them; off.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';

export const LINE = Object.freeze({
  width: 0.9,           // m
  y: 0.055,             // above the rubber and tyre marks
  repeat: 2.6,          // m per chevron
  alpha: 0.85,
  smooth: 3,            // samples averaged each side (the bot's pedals pulse: no flicker)
  brakeFrom: 5,         // m/s² of deceleration that counts as braking (red) ...
  brakeFull: 35,        // ... darkest red here
  colours: { gas: [0.18, 0.86, 0.36], lift: [1, 0.76, 0.1], brake: [0.95, 0.12, 0.08], hard: [0.75, 0, 0.05] },
  lead: 45,             // braking mode: m of fade-in before a braking zone
  after: 8,             // ... and m of fade-out after it
});

// Per sample of the lap: colour [r, g, b] and braking 0..1. Braking comes from the car's deceleration along the lap
// (its pedal pulses on and off; the speed it lost doesn't), lifting from its throttle, both smoothed.
export function lineColours(line, ds) {
  const C = LINE.colours, N = line.kmh.length, s = LINE.smooth, v = new Float32Array(N), out = [];
  for (let i = 0; i < N; i++) { let a = 0; for (let k = -s; k <= s; k++) a += line.kmh[SIM.wrapIdx(i + k, N)]; v[i] = a / (2 * s + 1) / 3.6; }
  const brake = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = v[i], b = v[SIM.wrapIdx(i + 1, N)], dec = (a * a - b * b) / (2 * ds);
    brake[i] = dec > LINE.brakeFrom ? Math.min(1, (dec - LINE.brakeFrom) / (LINE.brakeFull - LINE.brakeFrom)) + 1e-3 : 0;
  }
  for (let i = 0; i < N; i++) {
    let thr = 0; for (let k = -s; k <= s; k++) thr += line.thr[SIM.wrapIdx(i + k, N)];
    thr /= 2 * s + 1;
    const u = brake[i];
    out.push(u > 0 ? { rgb: C.brake.map((c, k) => c + (C.hard[k] - c) * u), brake: u }
      : { rgb: C.lift.map((c, k) => c + (C.gas[k] - c) * Math.min(1, thr) ** 2), brake: 0 });
  }
  return out;
}

export function createRacingLine(scene) {
  let mesh = null, mode = 'full', built = null;
  const tex = chevronTexture();

  function clear() { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; } }
  function build() {
    clear();
    if (!built || mode === 'off') return;
    const { track, line } = built, N = track.N, L = LINE, w = L.width / 2;
    // braking mode: alpha by distance to the nearest braking sample (ahead: lead-in; behind: fade out)
    const cols = lineColours(line, track.ds), brakeAt = i => cols[i].brake > 0;
    const mask = new Float32Array(N).fill(mode === 'full' ? 1 : 0);
    if (mode === 'braking') {
      const lead = Math.round(L.lead / track.ds), after = Math.round(L.after / track.ds);
      for (let i = 0; i < N; i++) if (brakeAt(i)) {
        mask[i] = 1;
        for (let k = 1; k <= lead; k++) { const j = SIM.wrapIdx(i - k, N); mask[j] = Math.max(mask[j], 1 - k / lead); }
        for (let k = 1; k <= after; k++) { const j = SIM.wrapIdx(i + k, N); mask[j] = Math.max(mask[j], 1 - k / after); }
      }
    }
    const pos = new Float32Array((N + 1) * 6), col = new Float32Array((N + 1) * 8), uv = new Float32Array((N + 1) * 4), idx = [];
    let d = 0;
    for (let n = 0; n <= N; n++) {
      const i = n % N, a = SIM.wrapIdx(i - 1, N), b = SIM.wrapIdx(i + 1, N);
      const tx = line.x[b] - line.x[a], tz = line.z[b] - line.z[a], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      if (n) d += Math.hypot(line.x[i] - line.x[SIM.wrapIdx(i - 1, N)], line.z[i] - line.z[SIM.wrapIdx(i - 1, N)]);
      const lat = (line.x[i] - track.PX[i]) * track.NX[i] + (line.z[i] - track.PZ[i]) * track.NZ[i];
      const ya = L.y + SIM.surfaceY(track, i, lat - w), yb = L.y + SIM.surfaceY(track, i, lat + w);   // (a hill: sim elevation.js)
      pos.set([line.x[i] - nx * w, ya, line.z[i] - nz * w, line.x[i] + nx * w, yb, line.z[i] + nz * w], n * 6);
      const [r, g, bl] = cols[i].rgb, al = L.alpha * mask[i];
      col.set([r, g, bl, al, r, g, bl, al], n * 8);
      uv.set([0, d / L.repeat, 1, d / L.repeat], n * 4);
      if (n < N) idx.push(n * 2, n * 2 + 2, n * 2 + 1, n * 2 + 1, n * 2 + 2, n * 2 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 2; mesh.frustumCulled = false;
    scene.add(mesh);
  }

  return {
    // track + the ALIEN's lap line (null: nothing to draw)
    set(track, line) { built = line ? { track, line } : null; build(); },
    setMode(m) { if (m !== mode) { mode = m; build(); } },
    get mode() { return mode; },
    dispose() { clear(); tex.dispose(); },
  };
}

// white chevrons pointing along the track (+v) on a faint white band: the vertex colour tints both
function chevronTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.62)'; x.fillRect(0, 0, 64, 128);
  x.fillStyle = '#fff';
  x.beginPath(); x.moveTo(0, 108); x.lineTo(32, 44); x.lineTo(64, 108); x.lineTo(64, 72); x.lineTo(32, 8); x.lineTo(0, 72); x.closePath(); x.fill();   // (canvas top = +v = forward)
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
