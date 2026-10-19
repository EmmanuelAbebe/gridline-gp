import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { CONFIG, COLORS, GFX_PROFILES, THEMES } from './config.js';
import { hexCss } from './util.js';
import { buildScenery } from './scenery.js';

// Static track and scenery, all under one group. Returns handles for what graphics profiles and the start lights
// change, and dispose() to take it out of the scene (switching circuits).
// What lies beside the road comes from the SIM's run-off layout (track.runoff, runoff.js), so the car feels exactly
// what is drawn: kerbs, sausage kerbs, artificial grass, tarmac / grass / gravel, and the barrier (Armco, tyre wall,
// TecPro, concrete with debris fence) at its distance.
export function buildWorld(parent, track, drivers) {
  const scene = new THREE.Group(); parent.add(scene);
  const { N, HW, PX, PZ, NX, NZ, landmarks, runoff, bounds } = track;
  const { cx, cz } = bounds;
  const theme = THEMES[track.theme] || THEMES.forest;
  const lambert = opts => new THREE.MeshLambertMaterial(opts);
  // painted layers sit on the same plane as the road; polygonOffset keeps them on top without a log depth buffer
  const decal = (factor, opts) => ({ ...opts, polygonOffset: true, polygonOffsetFactor: -factor, polygonOffsetUnits: -factor * 2 });
  const val = (o, i) => typeof o === 'function' ? o(i) : o;
  const wallAt = (side, i) => runoff[side].wall[i];

  function placeAlong(obj, i, lat, y) {
    obj.position.set(PX[i] + NX[i]*lat, y, PZ[i] + NZ[i]*lat);
    obj.rotation.y = -SIM.headingAt(track, i);
    scene.add(obj); return obj;
  }
  function canvasTexture(w, h, paint, nearest = true) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv); if (nearest) tex.magFilter = THREE.NearestFilter; return tex;
  }

  // Flat ribbon between lateral offsets o1..o2 (numbers, or functions of the sample). colorFn(i) returns a hex, or
  // null to leave a gap. `mat` replaces the vertex-coloured material (overlays).
  function strip(o1, o2, y, colorFn, layer = 1, mat = null) {
    const pos = [], col = [], nor = [], c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const hex = colorFn(i); if (hex === null) continue;
      const j = (i+1) % N, a1 = val(o1, i), a2 = val(o2, i), b1 = val(o1, j), b2 = val(o2, j);
      if (a2 - a1 < 0.01 && b2 - b1 < 0.01) continue;
      const ax = PX[i]+NX[i]*a1, az = PZ[i]+NZ[i]*a1, bx = PX[i]+NX[i]*a2, bz = PZ[i]+NZ[i]*a2;
      const qx = PX[j]+NX[j]*b1, qz = PZ[j]+NZ[j]*b1, dx = PX[j]+NX[j]*b2, dz = PZ[j]+NZ[j]*b2;
      pos.push(ax,y,az, bx,y,bz, qx,y,qz, bx,y,bz, dx,y,dz, qx,y,qz);   // wound to face up
      c.setHex(hex); for (let k = 0; k < 6; k++) { col.push(c.r, c.g, c.b); nor.push(0,1,0); }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const m = new THREE.Mesh(g, mat || lambert(decal(layer, { vertexColors: true, side: THREE.DoubleSide })));
    scene.add(m); return m;
  }
  // a strip on one side (0 = left, 1 = right) between distances a..b from the centre line
  const sideStrip = (side, a, b, y, colorFn, layer, mat) => side
    ? strip(a, b, y, colorFn, layer, mat) : strip(i => -val(b, i), i => -val(a, i), y, colorFn, layer, mat);

  // Vertical ribbon at lateral offset o (number or function), from y0 to y1, on the samples where include(i).
  // UVs: u = metres along / texLen, v = 0..1 up; colorFn(i) gives vertex colours (white when there is a texture).
  function ribbon(o, y0, y1, include, { colorFn = () => 0xffffff, map = null, texLen = 4, alpha = false } = {}) {
    const pos = [], col = [], uv = [], c = new THREE.Color();
    let u = 0;
    for (let i = 0; i < N; i++) {
      const j = (i+1) % N, oi = val(o, i), oj = val(o, j);
      const ax = PX[i]+NX[i]*oi, az = PZ[i]+NZ[i]*oi, bx = PX[j]+NX[j]*oj, bz = PZ[j]+NZ[j]*oj, len = Math.hypot(bx-ax, bz-az);
      if (include(i)) {
        const u0 = u / texLen, u1 = (u + len) / texLen;
        pos.push(ax,y0,az, bx,y0,bz, ax,y1,az, ax,y1,az, bx,y0,bz, bx,y1,bz);
        uv.push(u0,0, u1,0, u0,1, u0,1, u1,0, u1,1);
        c.setHex(colorFn(i)); for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
      u += len;
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, lambert({ vertexColors: true, side: THREE.DoubleSide, map, alphaTest: alpha ? 0.5 : 0 }));
    scene.add(m); return m;
  }
  // Instanced boxes along one side (posts, blocks): every `every` samples where include(i), at distance o(i)
  function posts(side, o, every, include, size, color, y = size[1] / 2) {
    const list = []; for (let i = 0; i < N; i += every) if (include(i)) list.push(i);
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), lambert({ color }), list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const s = side ? 1 : -1;
    list.forEach((i, k) => { const d = s * val(o, i); p.set(PX[i] + NX[i]*d, y, PZ[i] + NZ[i]*d); q.setFromAxisAngle(up, -SIM.headingAt(track, i)); m4.compose(p, q, one); mesh.setMatrixAt(k, m4); });
    scene.add(mesh);
  }

  // ---- ground: natural grass (noise texture in the theme's colours) + mown stripes near the track ----
  const [g0, g1] = theme.ground;
  const grassTex = canvasTexture(256, 256, (x, w, h) => {
    x.fillStyle = hexCss(g0); x.fillRect(0, 0, w, h);
    const c0 = new THREE.Color(g0), c1 = new THREE.Color(g1);
    for (let k = 0; k < 2600; k++) {
      const t = Math.random(), c = c0.clone().lerp(c1, t).multiplyScalar(0.88 + Math.random() * 0.22);
      x.fillStyle = `rgb(${c.r*255|0},${c.g*255|0},${c.b*255|0})`; const r = 2 + Math.random() * 7;
      x.globalAlpha = 0.35; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); x.fill();
    }
  }, false);
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(90, 90);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI/2), lambert({ map: grassTex }));
  ground.position.set(cx, -0.06, cz); scene.add(ground);
  let stripes = null;
  if (theme.stripes) {
    const stripeTex = canvasTexture(64, 2, x => { for (let i = 0; i < 16; i++) { x.fillStyle = hexCss(i % 2 ? g0 : g1); x.fillRect(i*4, 0, 4, 2); } });
    stripeTex.wrapS = THREE.RepeatWrapping; stripeTex.repeat.set(6, 1);
    stripes = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900, 1, 1).rotateX(-Math.PI/2), lambert({ map: stripeTex, transparent: true, opacity: 0.5 }));
    stripes.position.set(cx, -0.03, cz); scene.add(stripes);
  }

  // ---- road, lines, racing line rubber and skid marks ----
  strip(-HW, HW, 0.03, i => COLORS.asphalt[i % 40 < 20 ? 0 : 1]);
  strip(-HW+0.25, -HW+0.55, 0.06, () => COLORS.paint, 3);
  strip(HW-0.55, HW-0.25, 0.06, () => COLORS.paint, 3);
  { const { RO, VP } = track, overlay = opacity => new THREE.MeshBasicMaterial(decal(2, { color: 0x000000, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    // rubbered-in racing line: darker where the cars run
    strip(i => RO[i] - 1.1, i => RO[i] + 1.1, 0.04, () => 0, 1.5, overlay(0.16));
    // skid marks where the cars brake hardest (the speed profile falls fast): two tyre tracks, fading in
    const braking = i => { const d = VP[i] - VP[(i + 8) % N]; return d > 4 ? Math.min(1, (d - 4) / 8) : 0; };
    for (const o of [-0.8, 0.8]) strip(i => RO[i] + o - 0.2 + Math.sin(i * 0.7) * 0.05, i => RO[i] + o + 0.2, 0.045, i => braking(i) > 0.15 ? 0 : null, 1.6, overlay(0.22)); }

  // ---- beside the road, from the run-off layout ----
  for (const side of [0, 1]) {
    const R = runoff[side];
    // flat kerbs, sausage kerbs behind them at chicanes, artificial grass, tarmac run-off, gravel
    sideStrip(side, HW - 0.02, i => R.kerb[i], 0.05, i => R.kerb[i] > HW ? COLORS.kerb[(i >> 1) % 2] : null, 2);
    sideStrip(side, i => R.kerb[i], i => R.kerb[i] + SIM.OFFTRACK.sausageWidth, 0.11, i => R.sausage[i] ? COLORS.sausage[i % 2] : null, 3);
    sideStrip(side, i => R.kerb[i], i => R.turf[i], 0.035, i => R.turf[i] > R.kerb[i] ? COLORS.turf[(i >> 2) % 2] : null, 1);
    sideStrip(side, i => R.turf[i], i => Math.min(R.gravel[i], R.wall[i]), 0.025, i => R.zone[i] === SIM.ZONE.tarmac ? COLORS.tarmacRunoff[(i >> 3) % 2] : null, 1);
    sideStrip(side, i => Math.min(R.gravel[i], R.wall[i]), i => R.wall[i], 0.02, i => R.gravel[i] < R.wall[i] ? COLORS.gravel[(i * 7 >> 2) % 2] : null, 1);
    // sausage kerb face (it stands up)
    ribbon(i => (side ? 1 : -1) * R.kerb[i], 0, 0.11, i => R.sausage[i], { colorFn: () => COLORS.sausage[1] });
    buildBarriers(side, R);
  }

  function buildBarriers(side, R) {
    const s = side ? 1 : -1, B = SIM.BARRIER, at = (i, d = 0) => s * (R.wall[i] + d), is = t => i => R.barrier[i] === t;
    // Armco: two steel rails on posts
    ribbon(i => at(i), 0.42, 0.72, is(B.armco), { colorFn: () => COLORS.armco });
    ribbon(i => at(i), 0.82, 0.98, is(B.armco), { colorFn: () => COLORS.armco });
    posts(side, i => R.wall[i] + 0.15, 2, is(B.armco), [0.12, 1, 0.12], COLORS.armcoPost);
    // tyre wall: stacked tyres behind a conveyor belt, red/white
    const tyreTex = canvasTexture(64, 32, (x, w, h) => {
      x.fillStyle = '#0d0d0e'; x.fillRect(0, 0, w, h);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) { x.strokeStyle = '#2a2a2d'; x.lineWidth = 3; x.beginPath(); x.arc(8 + k * 16, 8 + r * 16, 6, 0, Math.PI * 2); x.stroke(); }
    });
    tyreTex.wrapS = THREE.RepeatWrapping;
    ribbon(i => at(i, 0.35), 0, 0.95, is(B.tyres), { map: tyreTex, texLen: 1.3 });
    ribbon(i => at(i), 0.15, 0.9, is(B.tyres), { colorFn: i => COLORS.tyreBelt[(i >> 1) % 2] });
    // TecPro: red and blue blocks
    ribbon(i => at(i), 0, 1.15, is(B.tecpro), { colorFn: i => COLORS.tecpro[i % 2] });
    ribbon(i => at(i, 0.9), 0, 1.15, is(B.tecpro), { colorFn: () => 0x3a3f46 });
    strip(i => s > 0 ? R.wall[i] : -R.wall[i] - 0.9, i => s > 0 ? R.wall[i] + 0.9 : -R.wall[i], 1.15, i => R.barrier[i] === B.tecpro ? COLORS.tecpro[i % 2] : null, 0);
    // concrete wall with a debris fence above it
    const fenceTex = canvasTexture(64, 64, (x, w, h) => {
      x.clearRect(0, 0, w, h); x.strokeStyle = 'rgba(190,198,206,1)'; x.lineWidth = 1.5;
      for (let k = -w; k < w * 2; k += 8) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + h, h); x.stroke(); x.beginPath(); x.moveTo(k, h); x.lineTo(k + h, 0); x.stroke(); }
      x.fillStyle = '#7b828a'; x.fillRect(0, 0, w, 3);
    }, false);
    fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping; fenceTex.repeat.set(1, 3);
    ribbon(i => at(i), 0, 1.1, is(B.concrete), { colorFn: i => (i >> 3) % 2 ? COLORS.concrete : 0xb8babd });
    ribbon(i => at(i, 0.4), 0, 1.1, is(B.concrete), { colorFn: () => 0xa6a9ad });
    ribbon(i => at(i, 0.1), 1.1, 4.2, is(B.concrete), { map: fenceTex, texLen: 2, alpha: true });
    posts(side, i => R.wall[i] + 0.1, 2, is(B.concrete), [0.1, 3.3, 0.1], COLORS.fence, 2.75);
    // marshal-post debris fence behind fast corners' TecPro too
    ribbon(i => at(i, 1.4), 0.2, 3.4, is(B.tecpro), { map: fenceTex, texLen: 2, alpha: true });
  }

  // ---- start/finish chequers ----
  { const tex = canvasTexture(32, 4, x => { for (let a = 0; a < 32; a++) for (let b = 0; b < 4; b++) { x.fillStyle = (a+b) % 2 ? '#111' : hexCss(COLORS.paint); x.fillRect(a, b, 1, 1); } });
    tex.center.set(0.5, 0.5); tex.rotation = Math.PI/2;
    placeAlong(new THREE.Mesh(new THREE.PlaneGeometry(1.6, HW*2).rotateX(-Math.PI/2), lambert(decal(4, { map: tex }))), 0, 0, 0.07); }

  // grid box lines, one per entrant
  { const mat = new THREE.MeshBasicMaterial(decal(4, { color: COLORS.paint })), geo = new THREE.PlaneGeometry(0.25, 2.6).rotateX(-Math.PI/2);
    drivers.forEach((d, slot) => { const { idx, lat } = SIM.gridSlot(track, slot, 2.9); placeAlong(new THREE.Mesh(geo, mat), idx, lat, 0.065); }); }

  // start gantry with the five lights (posts just behind the barriers)
  const gantryLights = [];
  { const gi = landmarks.gantry ?? 2, wl = wallAt(0, gi) + 1, wr = wallAt(1, gi) + 1;
    const mat = lambert({ color: COLORS.steel }), g = new THREE.Group(), post = new THREE.BoxGeometry(0.6, 8, 0.6);
    for (const z of [-wl, wr]) { const p = new THREE.Mesh(post, mat); p.position.set(0, 4, z); g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, wl + wr + 0.6), mat); beam.position.set(0, 7.6, (wr - wl) / 2); g.add(beam);
    const lampGeo = new THREE.SphereGeometry(0.28, 10, 8);
    for (let k = 0; k < CONFIG.lights.count; k++) {
      const l = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: COLORS.lampOff }));
      l.position.set(-0.62, 7.6, (k - (CONFIG.lights.count-1)/2) * 1.1); g.add(l); gantryLights.push(l);
    }
    placeAlong(g, gi, 0, 0); }

  // grandstand with crowd (left of the main straight), pit lane + garages (right)
  const CROWD_MAX = Math.max(GFX_PROFILES.quality.crowd, GFX_PROFILES.perf.crowd);
  let crowd = null;
  if (landmarks.grandstand !== undefined) {
    const st = new THREE.Group(), mat = lambert({ color: COLORS.stand });
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(160, 1.4*(k+1), 3), mat); b.position.set(0, 0.7*(k+1), -k*3); st.add(b); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(164, 0.4, 21), lambert({ color: COLORS.roof })); roof.position.set(0, 13, -7); st.add(roof);
    crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.9, 0.5), lambert(), CROWD_MAX);
    const m4 = new THREE.Matrix4(), col = new THREE.Color(), pal = COLORS.crowd;
    for (let n = 0; n < CROWD_MAX; n++) {
      const k = n % 6, x = (Math.random()-0.5)*156;
      m4.makeTranslation(x, 1.4*(k+1)+0.45, -k*3 + (Math.random()-0.5)); crowd.setMatrixAt(n, m4);
      crowd.setColorAt(n, col.setHex(pal[(Math.random()*pal.length)|0]));
    }
    st.add(crowd);
    placeAlong(st, landmarks.grandstand, -(wallAt(0, landmarks.grandstand) + 4), 0);
  }
  // pit lane (SIM track.pit): entry road off the track, fast lane behind the pit wall, a box per team in front of its
  // garage, exit road back on; the pit wall starts with a TecPro nose; PIT 80 boards at the entry and the lane
  if (track.pit) {
    const L = track.pit, from = Math.floor(L.entry), to = Math.ceil(L.exit), span = to - from;
    const inPit = i => ((i - from) % N + N) % N <= span, pOf = i => from + ((i - from) % N + N) % N;
    const lane = i => SIM.laneCentre(track, pOf(i)), inLane = i => { const p = pOf(i); return p >= L.from && p <= L.to; };
    const roadIn = i => inLane(i) ? L.wallLat + 0.15 : Math.max(HW, lane(i) - 2.4), roadOut = i => inLane(i) ? L.garageLat + 0.2 : Math.max(HW + 0.3, lane(i) + 2.4);
    strip(roadIn, roadOut, 0.032, i => inPit(i) ? COLORS.asphalt[1] : null, 1.2);
    for (const edge of [roadIn, roadOut]) strip(i => edge(i) - 0.12, i => edge(i) + 0.12, 0.05, i => inPit(i) && !(inLane(i) && edge === roadIn) && edge(i) > HW + 0.3 ? COLORS.paint : null, 3);
    strip(i => L.lane + 1.7, i => L.lane + 1.9, 0.05, i => inLane(i) ? COLORS.paint : null, 3);          // fast lane | working lane
    // box markings in team colours
    const boxGeo = new THREE.PlaneGeometry(SIM.PIT.boxLength, 3).rotateX(-Math.PI / 2);
    drivers.forEach((d, k) => { const p = L.boxes[k], i = ((Math.round(p) % N) + N) % N;
      placeAlong(new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial(decal(3, { color: d.color, transparent: true, opacity: 0.55 }))), i, L.boxLat, 0.055); });
    // the pit wall's nose
    { const i = ((Math.round(L.from) % N) + N) % N, nose = new THREE.Group();
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.2), lambert({ color: COLORS.tecpro[k % 2] })); b.position.set(-1.4 * k - 0.7, 0.55, 0); nose.add(b); }
      placeAlong(nose, i, L.wallLat, 0); }
    // PIT 80 boards
    const sign = canvasTexture(64, 64, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d92b2b'; x.lineWidth = 7; x.beginPath(); x.arc(w / 2, h / 2 + 4, 22, 0, 7); x.stroke();
      x.fillStyle = '#111'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('80', w / 2, h / 2 + 5); x.font = 'bold 11px sans-serif'; x.fillText('PIT', w / 2, 8); }, false);
    for (const p of [L.entry + 4, L.from + 2]) {
      const i = ((Math.round(p) % N) + N) % N, g = new THREE.Group(), b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), lambert({ map: sign, side: THREE.DoubleSide }));
      b.position.y = 2.2; b.rotation.y = -Math.PI / 2; g.add(b); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), lambert({ color: 0x8a9096 })));
      g.children[1].position.y = 0.8; placeAlong(g, i, SIM.laneCentre(track, p) + 3.6, 0);
    }
    const pits = new THREE.Group();
    const bld = new THREE.Mesh(new THREE.BoxGeometry(150, 7, 12), lambert({ color: COLORS.pits })); bld.position.set(0, 3.5, 6); pits.add(bld);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(146, 2, 0.2), lambert({ color: COLORS.glass })); glass.position.set(0, 5, -0.05); pits.add(glass);
    drivers.forEach((d, k) => { const door = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 0.2), lambert({ color: d.color })); door.position.set(-67.5 + k*15, 1.6, -0.05); pits.add(door); });
    placeAlong(pits, landmarks.pits, L.garageLat, 0);
  }

  const scenery = buildScenery(scene, track, theme, { lambert, canvasTexture, placeAlong });

  return {
    applyProfile(p) {
      scenery.applyProfile(p);
      if (crowd) crowd.count = Math.min(CROWD_MAX, p.crowd);
      if (stripes) stripes.visible = p.stripes;
    },
    setStartLights(n) { gantryLights.forEach((l, i) => l.material.color.setHex(i < n ? COLORS.lampOn : COLORS.lampOff)); },
    dispose() {
      parent.remove(scene);
      const seen = new Set();
      scene.traverse(o => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); m.map?.dispose(); m.dispose(); }
      });
    },
  };
}
