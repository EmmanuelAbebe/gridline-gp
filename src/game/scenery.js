import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { COLORS, BRANDS } from './config.js';

// Everything beyond the barriers: the circuit's theme (trees, hills, lakes or a harbour with buildings, rocks) and
// the trackside furniture real circuits have: braking boards (300 / 200 / 100 m before the big stops), marshal posts,
// advertising boards (invented brands), a sponsor bridge over the track, TV camera towers and grandstands at the
// heaviest braking zones. Placement comes from the track and its run-off layout, so every circuit gets its own.
// groundAt(x, z) = the ground's height (ground.js; 0 on a flat circuit)
export function buildScenery(scene, track, theme, { lambert, canvasTexture, placeAlong, groundAt = () => 0 }) {
  const { N, ds, HW, PX, PZ, K, CK, KERB_K, VP, runoff, bounds } = track;
  const { minX, maxX, minZ, maxZ, cx, cz } = bounds;
  const at = i => SIM.wrapIdx(i, N);
  const sideOf = s => runoff[s < 0 ? 0 : 1];
  const reach = new Float32Array(N); for (let i = 0; i < N; i++) reach[i] = Math.max(runoff[0].wall[i], runoff[1].wall[i]);
  // a point is free if it is further than the barrier (+ margin) from every part of the track
  const free = (x, z, margin) => { for (let i = 0; i < N; i += 3) { const dx = x - PX[i], dz = z - PZ[i], r = reach[i] + margin; if (dx*dx + dz*dz < r*r) return false; } return true; };
  const toggles = { trees: [], hills: [], crowds: [] };

  // ---- the corners that matter: apex, turn-in, speed scrubbed, outside side ----
  const corners = [];
  for (let i = 0; i < N; i++) {
    if (Math.abs(CK[i]) <= KERB_K || VP[i] > VP[at(i - 1)] || VP[i] > VP[at(i + 1)]) continue;   // local minimum of the profile
    let hi = 0; for (let o = 1; o <= 160; o++) hi = Math.max(hi, VP[at(i - o)]);
    let t = i; while (Math.abs(K[at(t - 1)]) > KERB_K && i - t < 120) t--;
    if (corners.some(c => Math.min(at(c.apex - i), at(i - c.apex)) < 60)) continue;
    corners.push({ apex: i, turnIn: at(t), scrub: hi - VP[i], side: CK[i] > 0 ? 0 : 1 });
  }

  // ---- braking boards: 300 / 200 / 100 m before the turn-in of every corner that needs real braking ----
  const boardTex = n => canvasTexture(64, 96, (x, w, h) => {
    x.fillStyle = '#1d4fa8'; x.fillRect(0, 0, w, h); x.fillStyle = '#f4f4f0'; x.fillRect(5, 5, w - 10, h - 10);
    x.fillStyle = '#111'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n, w / 2, h / 2);
  }, false);
  const boardMats = { 100: lambert({ map: boardTex('100') }), 200: lambert({ map: boardTex('200') }), 300: lambert({ map: boardTex('300') }) };
  const boardGeo = new THREE.PlaneGeometry(1.2, 1.8), poleGeo = new THREE.BoxGeometry(0.12, 1, 0.12), poleMat = lambert({ color: 0x8a9096 });
  for (const c of corners) {
    if (c.scrub < 20) continue;
    const s = c.side ? 1 : -1, R = sideOf(s);
    for (const m of [100, 200, 300]) {
      const i = at(c.turnIn - Math.round(m / ds)); if (Math.abs(K[i]) > KERB_K * 2) continue;
      const g = new THREE.Group(), b = new THREE.Mesh(boardGeo, boardMats[m]); b.position.y = 1.9; b.rotation.y = -Math.PI / 2; g.add(b);
      const p = new THREE.Mesh(poleGeo, poleMat); p.position.y = 0.5; g.add(p);
      placeAlong(g, i, s * Math.min(R.wall[i] - 1, HW + 5), 0);   // facing the oncoming cars
    }
  }

  // ---- marshal posts every ~280 m, alternating sides, behind the barrier ----
  { const hutGeo = new THREE.BoxGeometry(2.4, 2.2, 2.2), hutMat = lambert({ color: 0xf2f2ee }), bandGeo = new THREE.BoxGeometry(2.45, 0.35, 2.25), bandMat = lambert({ color: COLORS.marshal });
    const roofGeo = new THREE.BoxGeometry(2.8, 0.15, 2.6), flagGeo = new THREE.PlaneGeometry(0.7, 0.5), flagMat = lambert({ color: 0x2fae4a, side: THREE.DoubleSide });
    const step = Math.round(280 / ds);
    for (let k = 0, i = Math.round(60 / ds); i < N - 30; i += step, k++) {
      const s = k % 2 ? 1 : -1, R = sideOf(s), g = new THREE.Group();
      const hut = new THREE.Mesh(hutGeo, hutMat); hut.position.y = 1.1; g.add(hut);
      const band = new THREE.Mesh(bandGeo, bandMat); band.position.y = 1.6; g.add(band);
      const roof = new THREE.Mesh(roofGeo, lambert({ color: 0x9aa0a6 })); roof.position.y = 2.28; g.add(roof);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.06), poleMat); pole.position.set(1.4, 1.3, s * -1.2); g.add(pole);
      const flag = new THREE.Mesh(flagGeo, flagMat); flag.position.set(1.75, 2.35, s * -1.2); g.add(flag);
      placeAlong(g, i, s * (R.wall[i] + 3), 0);
    }
  }

  // ---- advertising boards behind the barrier on the straights ----
  { const mats = BRANDS.map(([name, bg, fg]) => lambert({ map: canvasTexture(256, 40, (x, w, h) => {
      x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = 'bold 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name, w / 2, h / 2 + 1);
    }, false), side: THREE.DoubleSide }));
    const geo = new THREE.PlaneGeometry(8, 1.25), legGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1), step = Math.round(70 / ds);
    let n = 0;
    for (let i = 10; i < N; i += step) for (const s of [-1, 1]) {
      const R = sideOf(s); if (Math.abs(CK[i]) > KERB_K || R.barrier[i] === SIM.BARRIER.concrete && R.wall[i] < HW + 5) continue;
      const g = new THREE.Group(), b = new THREE.Mesh(geo, mats[n++ % mats.length]); b.position.y = 1.05; b.rotation.y = s > 0 ? Math.PI : 0; g.add(b);
      for (const x of [-3.6, 3.6]) { const l = new THREE.Mesh(legGeo, poleMat); l.position.set(x, 0.2, 0); g.add(l); }
      placeAlong(g, i, s * (R.wall[i] + 0.9), 0);
    }
  }

  // ---- sponsor bridge over the straightest stretch away from the start ----
  { let best = -1, bestLen = 0;
    for (let i = Math.round(N * 0.2); i < N * 0.85; i++) {
      let len = 0; while (len < 200 && Math.abs(K[at(i + len)]) < KERB_K * 0.5 && Math.abs(K[at(i - len)]) < KERB_K * 0.5) len++;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best >= 0 && bestLen > 20) {
      const wl = runoff[0].wall[best] + 1.5, wr = runoff[1].wall[best] + 1.5, g = new THREE.Group(), steel = lambert({ color: 0x3a4048 });
      // (on a banked road the feet stand at the road edges' heights; the beam stays level over the higher one)
      const foot = lat => SIM.surfaceY(track, best, lat) - SIM.surfaceY(track, best, 0), lift = Math.max(0, foot(-wl), foot(wr));
      for (const z of [-wl, wr]) { const f = foot(z), p = new THREE.Mesh(new THREE.BoxGeometry(1, 9 + lift - f, 1), steel); p.position.set(0, (9 + lift + f) / 2, z); g.add(p); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, wl + wr + 1), steel); beam.position.set(0, 8.4 + lift, (wr - wl) / 2); g.add(beam);
      const tex = canvasTexture(512, 64, (x, w, h) => { x.fillStyle = '#111'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffc21a'; x.fillRect(0, h - 8, w, 8);
        x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#f4f4f0'; x.fillText('GRIDLINE GP', w / 2, h / 2 - 3); }, false);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(wl + wr - 2, 2.4), lambert({ map: tex, side: THREE.DoubleSide }));
      banner.position.set(0, 6.6 + lift, (wr - wl) / 2); banner.rotation.y = Math.PI / 2; g.add(banner);
      placeAlong(g, best, 0, 0);
    }
  }

  // ---- TV camera towers and grandstands at the biggest stops ----
  const big = corners.slice().sort((a, b) => b.scrub - a.scrub);
  { const steel = lambert({ color: 0x8d949b }), cam = lambert({ color: 0x1b1d22 });
    for (const c of big.slice(0, 4)) {
      const s = c.side ? 1 : -1, i = at(c.apex - 10), R = sideOf(s), g = new THREE.Group();
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 7, 0.12), steel); p.position.set(x, 3.5, z); g.add(p); }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), steel); deck.position.y = 7; g.add(deck);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.4), cam); box.position.set(0, 7.6, -s * 0.6); g.add(box);
      placeAlong(g, i, s * (R.wall[i] + 5), 0);
    }
    const standMat = lambert({ color: COLORS.stand }), roofMat = lambert({ color: COLORS.roof });
    for (const c of big.slice(0, 2)) {
      const s = c.side ? 1 : -1, i = at(c.apex - 6), R = sideOf(s), lat = s * (R.wall[i] + 6);
      const x = PX[i] + track.NX[i] * lat, z = PZ[i] + track.NZ[i] * lat;
      if (!free(x, z, 3)) continue;
      const g = new THREE.Group(), rows = 4, len = 60;
      for (let k = 0; k < rows; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2 * (k + 1), 2.6), standMat); b.position.set(0, 0.6 * (k + 1), s * k * 2.6); g.add(b); }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, 12), roofMat); roof.position.set(0, 7.5, s * 4); g.add(roof);
      const n = 360, crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.9, 0.5), lambert(), n), m4 = new THREE.Matrix4(), col = new THREE.Color();
      for (let k = 0; k < n; k++) { const r = k % rows; m4.makeTranslation((Math.random() - 0.5) * (len - 3), 1.2 * (r + 1) + 0.45, s * (r * 2.6 + (Math.random() - 0.5)));
        crowd.setMatrixAt(k, m4); crowd.setColorAt(k, col.setHex(COLORS.crowd[(Math.random() * COLORS.crowd.length) | 0])); }
      g.add(crowd); toggles.crowds.push({ mesh: crowd, max: n });
      placeAlong(g, i, lat, 0);
    }
  }

  // ---- the theme: water, buildings, rocks, trees, hills ----
  const water = lambert({ color: COLORS.water });
  if (theme.sea) {                                    // a harbour along one side of the circuit
    const edge = maxZ + 60, sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000).rotateX(-Math.PI / 2), water);
    sea.position.set(cx, -0.02, edge + 1500); scene.add(sea);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(6000, 1, 4), lambert({ color: 0x8e9196 })); quay.position.set(cx, 0.2, edge); scene.add(quay);
  }
  if (theme.lakes && !track.elev) {                   // (lakes need flat ground)
    const [count, radius] = theme.lakes;
    for (let k = 0, tries = 0; k < count && tries < 400; tries++) {
      const x = minX - 150 + Math.random() * (maxX - minX + 300), z = minZ - 150 + Math.random() * (maxZ - minZ + 300), r = radius * (0.7 + Math.random() * 0.6);
      if (!free(x, z, r + 15)) continue;
      const lake = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), water); lake.scale.set(1.4, 1, 1); lake.rotation.y = Math.random() * 3;
      lake.position.set(x, -0.02, z); scene.add(lake); k++;
    }
  }
  const scatter = (count, margin, fn) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = minX - 260 + Math.random() * (maxX - minX + 520), z = minZ - 260 + Math.random() * (maxZ - minZ + 520);
      if (theme.sea && z > maxZ + 55) continue;
      if (!free(x, z, margin)) continue;
      if (fn(x, z, placed) !== false) placed++;
    }
    return placed;
  };
  if (theme.buildings) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(), theme.buildings), m4 = new THREE.Matrix4(), col = new THREE.Color();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pal = [0xc9c2b4, 0xa9adb2, 0xd8d2c4, 0x8c9399, 0xb7a58c, 0xe2e0da];
    const n = scatter(theme.buildings, 10, (x, z, k) => {
      const w = 14 + Math.random() * 22, d = 14 + Math.random() * 22, h = 8 + Math.random() * Math.random() * 45;
      q.setFromAxisAngle(up, Math.round(Math.random() * 4) * Math.PI / 2 + 0.05); m4.compose(new THREE.Vector3(x, h / 2 + groundAt(x, z) - 1, z), q, new THREE.Vector3(w, h + 2, d));
      mesh.setMatrixAt(k, m4); mesh.setColorAt(k, col.setHex(pal[k % pal.length]));
    });
    mesh.count = n; scene.add(mesh);
  }
  if (theme.rocks) {
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), lambert({ color: 0x8b8a84 }), theme.rocks), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const n = scatter(theme.rocks, 6, (x, z, k) => { const s = 0.6 + Math.random() * 2.2;
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random())); m4.compose(new THREE.Vector3(x, s * 0.3 + groundAt(x, z), z), q, new THREE.Vector3(s * 1.3, s, s)); mesh.setMatrixAt(k, m4); });
    mesh.count = n; scene.add(mesh);
  }
  // trees: pines (cones) and broadleaf (balls), as the theme mixes them
  { const max = theme.trees, kinds = theme.kinds;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.45, 3, 6), lambert({ color: COLORS.trunk }), max);
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 9, 7), lambert({ color: 0xffffff }), max);
    const balls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.6, 1), lambert({ color: 0xffffff }), max);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const gs = track.landmarks.grandstand;
    let nc = 0, nb = 0;
    const n = scatter(max, 10, (x, z, k) => {
      if (gs !== undefined && Math.hypot(x - PX[gs], z - PZ[gs]) < 110) return false;
      const s = 0.7 + Math.random() * 0.8, kind = kinds[(Math.random() * kinds.length) | 0], y = groundAt(x, z) - 0.3;
      sc.set(s, s, s); p.set(x, 1.5 * s + y, z); m4.compose(p, q, sc); trunks.setMatrixAt(k, m4);
      if (kind === 'cone') { p.set(x, 7.5 * s + y, z); m4.compose(p, q, sc); cones.setMatrixAt(nc, m4); cones.setColorAt(nc++, col.setHSL(0.27 + Math.random() * 0.07, 0.45, 0.2 + Math.random() * 0.1)); }
      else { p.set(x, 6 * s + y, z); sc.set(s * 1.1, s * 0.95, s * 1.1); m4.compose(p, q, sc); balls.setMatrixAt(nb, m4); balls.setColorAt(nb++, col.setHSL(0.22 + Math.random() * 0.08, 0.42, 0.24 + Math.random() * 0.1)); }
    });
    trunks.count = n; cones.count = nc; balls.count = nb;
    scene.add(trunks, cones, balls);
    toggles.trees.push({ mesh: trunks, max: n }, { mesh: cones, max: nc }, { mesh: balls, max: nb });
  }
  // distant hills: pointed (default), low and broad (downs), close (woods)
  { const mat = lambert({ color: COLORS.hill }), H = theme.hills;
    for (let k = 0; k < H.count; k++) {
      const a = k / H.count * Math.PI * 2, r = (H.near ? 1300 : 1700) + Math.random() * 300;
      const geo = H.low ? new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.ConeGeometry(1, 1, 6);
      const h = new THREE.Mesh(geo, mat), w = (260 + Math.random() * 200) * H.size, ht = (90 + Math.random() * 110) * (H.low ? 0.5 : 1) * Math.sqrt(H.size);
      h.scale.set(w, ht, w * (0.8 + Math.random() * 0.4)); h.position.set(cx + Math.cos(a) * r, H.low ? 0 : ht / 2 - 15, cz + Math.sin(a) * r); h.rotation.y = Math.random();
      scene.add(h); toggles.hills.push(h);
    } }

  return {
    applyProfile(p) {
      for (const t of toggles.trees) t.mesh.count = Math.floor(t.max * p.treeFraction);
      for (const t of toggles.crowds) t.mesh.count = Math.floor(t.max * Math.min(1, p.crowd / 1500));
      for (const h of toggles.hills) h.visible = p.hills;
    },
  };
}
