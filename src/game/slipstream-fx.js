// Slipstream wakes: a soft, fuzzy band on the road behind each car ahead of the player, showing where the tow is.
// Drawn from the same data the physics uses (each car's trail and SIM.wakeHalfWidth), so the band is exactly the
// region that gives a tow. The wake the player is in glows brighter.
// In a tow, air streaks (2026-10-20, the user asked for GTA-like slipstream lines): thin white lines flowing back from
// the car ahead, along its wake (its trail, so they follow it round corners), past and around your car; more and
// brighter the stronger the tow (player.slip). STREAKS = their tunables.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';

const FX = Object.freeze({
  color: 0xcdeeff,
  opacity: 0.2,         // a wake you are not in
  active: 0.45,         // the wake you are in, at full strength (the streaks show the rest)
  lookAhead: 160,       // m: wakes of cars up to this far ahead of the player are drawn
  maxAge: 3,            // s: older trail samples are not part of the wake any more
  y: 0.1,               // just above the road paint
});

function wakeTexture() {
  const W = 64, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), img = x.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1);                                    // 0 at the car, 1 at the end of the wake
    const along = Math.min(1, v / 0.08) * Math.pow(1 - v, 1.3);
    for (let i = 0; i < W; i++) {
      const u = (i / (W - 1) - 0.5) / 0.5;                      // -1..1 across
      const across = Math.exp(-u * u * 2.6);
      const streak = 0.6 + 0.4 * Math.sin(i * 0.9 + Math.sin(j * 0.21) * 2);     // flow lines: the fuzzy look
      const a = along * across * streak, k = (j * W + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(a * 255);
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export const STREAKS = Object.freeze({
  count: 110,           // lines in the pool
  from: 2.5, past: 9,   // m behind the car ahead they start / m past your car they end
  flow: [16, 30],       // m/s they stream back (relative to the car ahead)
  length: [1.6, 0.045], // m: base + per m/s of your speed
  height: [0.12, 1.35], // m above the road
  width: 1.15,          // × the wake's half-width they spread over
  fadeIn: 0.12, fadeOut: 0.3,   // s, and the share of the run at the end where they fade
  alpha: 0.85,          // brightest line at full tow
  rise: 6, fall: 2.5,   // /s: how fast the streaks come with a tow and go without
  color: [0.85, 0.94, 1],
});

// The pool of streak lines behind the car whose tow the player is in.
function createStreaks(scene) {
  const S = STREAKS, n = S.count, pos = new Float32Array(n * 6), col = new Float32Array(n * 8);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));       // RGBA: each line fades along its length
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(g, mat); lines.frustumCulled = false; lines.renderOrder = 3; lines.visible = false;
  scene.add(lines);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const P = Array.from({ length: n }, () => ({ s: 0, u: 0, h: 0, flow: 0, age: 0, k: 0, end: 0 }));   // (end 0: not placed yet)
  const spawn = (p, end, first) => {
    p.s = first ? rnd(S.from, end) : rnd(S.from, S.from + 4); p.u = rnd(-1, 1); p.h = rnd(...S.height);
    p.flow = rnd(...S.flow); p.age = 0; p.k = rnd(0.35, 1); p.end = end;
  };
  let level = 0, by = null;
  return {
    // track, the car ahead (or null), your car, its distance behind (m), tow strength 0..1, frame dt
    update(track, lead, me, gap, slip, dt) {
      const want = lead ? slip : 0;
      level += (want - level) * Math.min(1, dt * (want > level ? S.rise : S.fall));
      if (lead) by = lead;
      if (level < 0.01 || !by) { lines.visible = false; return; }
      lines.visible = true;
      const { N, ds, PX, PZ, NX, NZ, TX, TZ } = track, end = Math.max(S.from + 6, gap + S.past), len = S.length[0] + S.length[1] * Math.max(0, me.v);
      const [r, gg, b] = S.color;
      P.forEach((p, k) => {
        if (p.end === 0) spawn(p, end, true);
        p.s += p.flow * dt; p.age += dt;
        if (p.s > end) spawn(p, end, false);
        // its place in the wake: the trail of the car ahead, `s` m behind it
        const i = SIM.wrapIdx(by.idx - Math.round(p.s / ds), N), lat = by.trailLat[i] ?? by.lat;
        const hw = (SIM.wakeHalfWidth(p.s) + 0.3) * S.width, side = lat + p.u * hw;
        const x = PX[i] + NX[i] * side, z = PZ[i] + NZ[i] * side;
        const a = level * S.alpha * p.k * Math.min(1, p.age / S.fadeIn) * Math.min(1, (end - p.s) / (end * S.fadeOut)) * Math.min(1, (p.s - S.from) / 2 + 0.2);
        // head toward the car ahead, tail streaming back toward you
        const y = p.h + SIM.surfaceY(track, i, side);                   // (a hill: sim elevation.js)
        pos.set([x, y, z, x - TX[i] * len, y, z - TZ[i] * len], k * 6);
        col.set([r, gg, b, Math.max(0, a), r, gg, b, 0], k * 8);
      });
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    },
    hide() { level = 0; lines.visible = false; },
  };
}

// Works on any circuit: the track comes from the race each frame (every circuit samples about every 2 m).
export function createSlipstreamFx(scene, cars) {
  const { range, edge } = SIM.SLIP;
  const ROWS = Math.ceil(range / 2) + 1, tex = wakeTexture();
  let track = null;
  const wakes = new Map(), streaks = createStreaks(scene);
  for (const d of cars) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(ROWS * 2 * 3), uv = new Float32Array(ROWS * 2 * 2), idx = [];
    for (let k = 0; k < ROWS; k++) {
      const v = k / (ROWS - 1); uv.set([0, v, 1, v], k * 4);
      if (k < ROWS - 1) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: FX.color, transparent: true, opacity: FX.opacity, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.visible = false;
    scene.add(mesh);
    wakes.set(d.code, { mesh, pos, mat });
  }

  // Rebuild the band behind `c` from its trail; returns false when there is nothing to draw.
  function shape(w, c, t) {
    const p = w.pos, { N, ds, PX, PZ, NX, NZ } = track;
    let last = null;
    for (let k = 0; k < ROWS; k++) {
      const i = SIM.wrapIdx(c.idx - k, N), fresh = c.trailT[i] >= 0 && t - c.trailT[i] < FX.maxAge;
      if (!fresh && k < 2) return false;
      if (fresh) last = { i, lat: c.trailLat[i], hw: SIM.wakeHalfWidth(k * ds) + edge * 0.5 };
      const { i: j, lat, hw } = last, w0 = fresh ? hw : 0;     // past the fresh part the band closes to nothing
      const cx = PX[j] + NX[j] * lat, cz = PZ[j] + NZ[j] * lat;
      p.set([cx - NX[j] * w0, FX.y + SIM.surfaceY(track, j, lat - w0), cz - NZ[j] * w0, cx + NX[j] * w0, FX.y + SIM.surfaceY(track, j, lat + w0), cz + NZ[j] * w0], k * 6);
    }
    w.mesh.geometry.attributes.position.needsUpdate = true;
    return true;
  }

  return {
    update(race, player, dt = 1 / 60) {
      track = race.track;
      const myP = SIM.progress(race, player), { ds } = track;
      const lead = player.slipBy && player.slip > 0.02 && !player.pit ? player.slipBy : null;
      streaks.update(track, lead, player, lead ? (SIM.progress(race, lead) - myP) * ds : 0, player.slip || 0, dt);
      for (const c of race.cars) {
        const w = wakes.get(c.code); if (!w) continue;
        const ahead = (SIM.progress(race, c) - myP) * ds;
        const show = c !== player && ahead > 0 && ahead < FX.lookAhead && c.v > 8 && shape(w, c, race.t);
        w.mesh.visible = show;
        if (show) w.mat.opacity = player.slipBy === c ? FX.opacity + (FX.active - FX.opacity) * player.slip : FX.opacity;
      }
    },
    hideAll() { for (const w of wakes.values()) w.mesh.visible = false; streaks.hide(); },
  };
}
