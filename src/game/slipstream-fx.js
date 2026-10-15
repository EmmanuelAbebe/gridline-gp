// Slipstream wakes: a soft, fuzzy band on the road behind each car ahead of the player, showing where the tow is.
// Drawn from the same data the physics uses (each car's trail and SIM.wakeHalfWidth), so the band is exactly the
// region that gives a tow. The wake the player is in glows brighter.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';

const FX = Object.freeze({
  color: 0xcdeeff,
  opacity: 0.32,        // a wake you are not in
  active: 0.8,          // the wake you are in, at full strength
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

// Works on any circuit: the track comes from the race each frame (every circuit samples about every 2 m).
export function createSlipstreamFx(scene, cars) {
  const { range, edge } = SIM.SLIP;
  const ROWS = Math.ceil(range / 2) + 1, tex = wakeTexture();
  let track = null;
  const wakes = new Map();
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
      const i = (c.idx - k + N) % N, fresh = c.trailT[i] >= 0 && t - c.trailT[i] < FX.maxAge;
      if (!fresh && k < 2) return false;
      if (fresh) last = { i, lat: c.trailLat[i], hw: SIM.wakeHalfWidth(k * ds) + edge * 0.5 };
      const { i: j, lat, hw } = last, w0 = fresh ? hw : 0;     // past the fresh part the band closes to nothing
      const cx = PX[j] + NX[j] * lat, cz = PZ[j] + NZ[j] * lat;
      p.set([cx - NX[j] * w0, FX.y, cz - NZ[j] * w0, cx + NX[j] * w0, FX.y, cz + NZ[j] * w0], k * 6);
    }
    w.mesh.geometry.attributes.position.needsUpdate = true;
    return true;
  }

  return {
    update(race, player) {
      track = race.track;
      const myP = SIM.progress(race, player), { ds } = track;
      for (const c of race.cars) {
        const w = wakes.get(c.code); if (!w) continue;
        const ahead = (SIM.progress(race, c) - myP) * ds;
        const show = c !== player && ahead > 0 && ahead < FX.lookAhead && c.v > 8 && shape(w, c, race.t);
        w.mesh.visible = show;
        if (show) w.mat.opacity = player.slipBy === c ? FX.opacity + (FX.active - FX.opacity) * player.slip : FX.opacity;
      }
    },
    hideAll() { for (const w of wakes.values()) w.mesh.visible = false; },
  };
}
