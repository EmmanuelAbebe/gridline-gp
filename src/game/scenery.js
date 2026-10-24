import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { COLORS, BRANDS } from './config.js';
import { Models, LEAF_CUT } from './models.js';
import { buildStand } from './stands.js';

// a truss across the track on two lattice posts (the sponsor bridge, the start gantry; Blender: trackside.py `post` /
// `truss`), in a group placed along the track: posts at z0 / z1 standing at foot(z) (a banked road's edges), the truss's
// underside at y, its 2 m sections stretched a little to fill the span exactly
export function spanTruss(g, T, mat, z0, z1, foot, y) {
  for (const z of [z0, z1]) { const f = foot(z), p = new THREE.Mesh(T.post.solid, mat); p.position.set(0, f, z); p.scale.y = (y + 1.6 - f) / 10; g.add(p); }
  const n = Math.max(1, Math.round((z1 - z0) / 2)), seg = (z1 - z0) / n, m = new THREE.InstancedMesh(T.truss.solid, mat, n), m4 = new THREE.Matrix4();
  for (let k = 0; k < n; k++) m.setMatrixAt(k, m4.compose(new THREE.Vector3(0, y, z0 + k * seg), new THREE.Quaternion(), new THREE.Vector3(1, 1, seg / 2)));
  g.add(m);
}

// the Blender trees (models.js): scale range per kind (the spruces are 15 / 19 m, the broadleaf 13 / 15 m tall), how far
// they lean (rad), how deep they sink into the ground (m), the leaves' tint per tree (brightness lo, hi, warmth ±)
const TREES = Object.freeze({ scale: { cone: [0.75, 1.25], ball: [0.8, 1.2] }, lean: 0.06, sink: 0.25, tint: [0.82, 1.08, 0.12], alphaTest: LEAF_CUT });

// the leaves' material: alpha-tested cards, both faces lit by the normals the model gives them (they point out of the
// crown, so the cards light like one leafy volume; the usual back-face flip would turn half of them dark)
function foliage(map) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: TREES.alphaTest, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    const f = sh.fragmentShader;
    sh.fragmentShader = f.replace('( gl_FrontFacing ) ? vIndirectFront : vIndirectBack', 'vIndirectFront').replace('( gl_FrontFacing ) ? vLightFront : vLightBack', 'vLightFront');
    if (sh.fragmentShader === f) console.warn('foliage: the Lambert shader changed, leaves light per face');
  };
  return m;
}

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
  const spots = { tv: [], bridge: null };          // where the TV towers and the sponsor bridge went (fractions of the lap; --track-shots)

  // ---- the corners that matter: apex, turn-in, speed scrubbed, outside side ----
  const corners = [];
  for (let i = 0; i < N; i++) {
    if (Math.abs(CK[i]) <= KERB_K || VP[i] > VP[at(i - 1)] || VP[i] > VP[at(i + 1)]) continue;   // local minimum of the profile
    let hi = 0; for (let o = 1; o <= 160; o++) hi = Math.max(hi, VP[at(i - o)]);
    let t = i; while (Math.abs(K[at(t - 1)]) > KERB_K && i - t < 120) t--;
    if (corners.some(c => Math.min(at(c.apex - i), at(i - c.apex)) < 60)) continue;
    corners.push({ apex: i, turnIn: at(t), scrub: hi - VP[i], side: CK[i] > 0 ? 0 : 1 });
  }

  // the Blender models (tools/blender/trackside.py, Models.trackside): one instanced mesh per model and role, each copy's
  // matrix from placeAlong (a model faces the track at −z, so the left side's turn round)
  const T = Models.trackside, solid = lambert({ vertexColors: true }), glass = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x444a50, shininess: 60 });
  const where = (i, lat, turn = lat < 0) => { const o = new THREE.Object3D(); placeAlong(o, i, lat, 0); if (turn) o.rotation.y += Math.PI;
    o.updateMatrix(); scene.remove(o); return o.matrix.clone(); };
  const instances = (geo, mat, list) => { if (!list.length) return null; const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((x, k) => m.setMatrixAt(k, x)); scene.add(m); return m; };

  // ---- braking boards: 300 / 200 / 100 m before the turn-in of every corner that needs real braking ----
  const boardTex = n => canvasTexture(64, 96, (x, w, h) => {
    x.fillStyle = '#1d4fa8'; x.fillRect(0, 0, w, h); x.fillStyle = '#f4f4f0'; x.fillRect(5, 5, w - 10, h - 10);
    x.fillStyle = '#111'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n, w / 2, h / 2);
  }, false, false);
  { const boards = { 100: [], 200: [], 300: [] };
    for (const c of corners) {
      if (c.scrub < 20) continue;
      const s = c.side ? 1 : -1, R = sideOf(s);
      for (const m of [100, 200, 300]) {
        const i = at(c.turnIn - Math.round(m / ds)); if (Math.abs(K[i]) > KERB_K * 2) continue;
        boards[m].push(where(i, s * Math.min(R.wall[i] - 1, HW + 5), false));   // facing the oncoming cars
      }
    }
    for (const m of [100, 200, 300]) instances(T.brakeboard.panel, lambert({ map: boardTex(String(m)) }), boards[m]);
    instances(T.brakeboard.solid, solid, [...boards[100], ...boards[200], ...boards[300]]);
  }

  // ---- marshal posts every ~280 m, alternating sides, behind the barrier ----
  { const step = Math.round(280 / ds), list = [];
    for (let k = 0, i = Math.round(60 / ds); i < N - 30; i += step, k++) { const s = k % 2 ? 1 : -1; list.push(where(i, s * (sideOf(s).wall[i] + 3))); }
    instances(T.marshal.solid, solid, list); instances(T.marshal.glass, glass, list);
  }

  // ---- advertising boards behind the barrier on the straights ----
  { const mats = BRANDS.map(([name, bg, fg]) => lambert({ map: canvasTexture(256, 40, (x, w, h) => {
      x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = 'bold 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name, w / 2, h / 2 + 1);
    }, false, false) }));
    const step = Math.round(70 / ds), byBrand = mats.map(() => []), all = [];
    let n = 0;
    for (let i = 10; i < N; i += step) for (const s of [-1, 1]) {
      const R = sideOf(s); if (Math.abs(CK[i]) > KERB_K || R.barrier[i] === SIM.BARRIER.concrete && R.wall[i] < HW + 5) continue;
      const m = where(i, s * (R.wall[i] + 0.9)); byBrand[n++ % mats.length].push(m); all.push(m);
    }
    mats.forEach((mat, k) => instances(T.advert.panel, mat, byBrand[k])); instances(T.advert.solid, solid, all);
  }

  // ---- sponsor bridge over the straightest stretch away from the start ----
  { let best = -1, bestLen = 0;
    for (let i = Math.round(N * 0.2); i < N * 0.85; i++) {
      let len = 0; while (len < 200 && Math.abs(K[at(i + len)]) < KERB_K * 0.5 && Math.abs(K[at(i - len)]) < KERB_K * 0.5) len++;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best >= 0 && bestLen > 20) {
      const wl = runoff[0].wall[best] + 1.5, wr = runoff[1].wall[best] + 1.5, g = new THREE.Group();
      // (on a banked road the feet stand at the road edges' heights; the beam stays level over the higher one)
      const foot = lat => SIM.surfaceY(track, best, lat) - SIM.surfaceY(track, best, 0), lift = Math.max(0, foot(-wl), foot(wr));
      spanTruss(g, T, solid, -wl, wr, foot, 7.9 + lift);
      const tex = canvasTexture(512, 64, (x, w, h) => { x.fillStyle = '#111'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffc21a'; x.fillRect(0, h - 8, w, 8);
        x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#f4f4f0'; x.fillText('GRIDLINE GP', w / 2, h / 2 - 3); }, false);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(wl + wr - 2, 2.4), lambert({ map: tex, side: THREE.DoubleSide }));
      banner.position.set(0, 6.6 + lift, (wr - wl) / 2); banner.rotation.y = -Math.PI / 2; g.add(banner);   // (facing the oncoming cars: it read backwards)
      placeAlong(g, best, 0, 0); spots.bridge = best / N;
    }
  }

  // ---- TV camera towers and grandstands at the biggest stops ----
  const big = corners.slice().sort((a, b) => b.scrub - a.scrub);
  { instances(T.tvtower.solid, solid, big.slice(0, 4).map(c => { const s = c.side ? 1 : -1, i = at(c.apex - 10); spots.tv.push([i / N, s * (sideOf(s).wall[i] + 5)]);
      return where(i, s * (sideOf(s).wall[i] + 5)); }));
    for (const [k, c] of big.slice(0, 2).entries()) {     // corner stands (stands.js): 7 bays, 6 m behind the barrier
      const s = c.side ? 1 : -1, i = at(c.apex - 6), R = sideOf(s), lat = s * (R.wall[i] + 6);
      if (!free(PX[i] + track.NX[i] * lat, PZ[i] + track.NZ[i] * lat, 3)) continue;
      const st = buildStand(track, { kind: 'small', at: i, side: s, front: R.wall[i] + 6, n: 7, hy: (j, l) => SIM.surfaceY(track, j, l), brand: 3 + k * 5 });
      scene.add(st.group); toggles.crowds.push(...st.crowd);
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
  // trees: spruces ('cone') and broadleaf trees ('ball'), as the theme mixes them; the models are made in Blender
  // (tools/blender/trees.py, models.js), each variant one instanced bark mesh + one instanced leaves mesh
  { const max = theme.trees, kinds = theme.kinds, maps = Models.treeMaps, gs = track.landmarks.grandstand;
    const barkMat = lambert({ map: maps.bark, vertexColors: true }), leafMat = foliage(maps.leaves);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: maps.leaves, alphaTest: TREES.alphaTest, side: THREE.DoubleSide });
    const sets = {};
    for (const kind of new Set(kinds)) sets[kind] = Models.trees[kind].map(v => {
      const bark = new THREE.InstancedMesh(v.bark, barkMat, max), leaves = new THREE.InstancedMesh(v.leaves, leafMat, max);
      leaves.customDepthMaterial = depth;            // (the cards' shadows are cut out like the cards)
      return { bark, leaves, n: 0 };
    });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    scatter(max, 10, (x, z) => {
      if (gs !== undefined && Math.hypot(x - PX[gs], z - PZ[gs]) < 110) return false;
      const kind = kinds[(Math.random() * kinds.length) | 0], list = sets[kind], t = list[(Math.random() * list.length) | 0];
      const [lo, hi] = TREES.scale[kind], s = lo + Math.random() * (hi - lo);
      e.set((Math.random() - 0.5) * TREES.lean, Math.random() * Math.PI * 2, (Math.random() - 0.5) * TREES.lean);
      sc.set(s, s * (0.92 + Math.random() * 0.16), s); p.set(x, groundAt(x, z) - TREES.sink, z); m4.compose(p, q.setFromEuler(e), sc);
      t.bark.setMatrixAt(t.n, m4); t.leaves.setMatrixAt(t.n, m4);
      const b = TREES.tint[0] + Math.random() * (TREES.tint[1] - TREES.tint[0]), w = (Math.random() - 0.5) * TREES.tint[2];   // brightness, warmth
      t.leaves.setColorAt(t.n++, col.setRGB(b * (1 + w), b, b * (1 - w)));
    });
    for (const list of Object.values(sets)) for (const t of list) {
      t.bark.count = t.leaves.count = t.n; scene.add(t.bark, t.leaves);
      toggles.trees.push({ mesh: t.bark, max: t.n }, { mesh: t.leaves, max: t.n });
    }
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
    spots,
    applyProfile(p) {
      for (const t of toggles.trees) t.mesh.count = Math.floor(t.max * p.treeFraction);
      for (const t of toggles.crowds) t.mesh.count = Math.round(t.max * p.crowd);
      for (const h of toggles.hills) h.visible = p.hills;
    },
  };
}
