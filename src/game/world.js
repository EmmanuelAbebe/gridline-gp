import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { CONFIG, COLORS, GFX_PROFILES } from './config.js';
import { hexCss } from './util.js';

// Static track and scenery, all under one group. Returns handles for what graphics profiles and the start lights
// change, and dispose() to take it out of the scene (switching circuits).
export function buildWorld(parent, track, drivers) {
  const scene = new THREE.Group(); parent.add(scene);
  const { N, HW, KERB, WALL, PX, PZ, NX, NZ, K, bounds, landmarks } = track;
  const { minX, maxX, minZ, maxZ, cx, cz } = bounds;
  const lambert = opts => new THREE.MeshLambertMaterial(opts);
  // painted layers sit on the same plane as the road; polygonOffset keeps them on top without a log depth buffer
  const decal = (factor, opts) => ({ ...opts, polygonOffset: true, polygonOffsetFactor: -factor, polygonOffsetUnits: -factor * 2 });

  function placeAlong(obj, i, lat, y) {
    obj.position.set(PX[i] + NX[i]*lat, y, PZ[i] + NZ[i]*lat);
    obj.rotation.y = -SIM.headingAt(track, i);
    scene.add(obj); return obj;
  }
  function canvasTexture(w, h, paint) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'));
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; return tex;
  }

  // Flat ribbon between lateral offsets o1..o2. colorFn(i) returns a hex, or null to leave a gap.
  function strip(o1, o2, y, colorFn, layer = 1) {
    const pos = [], col = [], nor = [], c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const hex = colorFn(i); if (hex === null) continue;
      const j = (i+1) % N;
      const ax = PX[i]+NX[i]*o1, az = PZ[i]+NZ[i]*o1, bx = PX[i]+NX[i]*o2, bz = PZ[i]+NZ[i]*o2;
      const qx = PX[j]+NX[j]*o1, qz = PZ[j]+NZ[j]*o1, dx = PX[j]+NX[j]*o2, dz = PZ[j]+NZ[j]*o2;
      pos.push(ax,y,az, bx,y,bz, qx,y,qz, bx,y,bz, dx,y,dz, qx,y,qz);   // wound to face up
      c.setHex(hex); for (let k = 0; k < 6; k++) { col.push(c.r, c.g, c.b); nor.push(0,1,0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    scene.add(new THREE.Mesh(g, lambert(decal(layer, { vertexColors: true, side: THREE.DoubleSide }))));
  }
  // Vertical barrier of height h at lateral offset o.
  function wall(o, h, colorFn) {
    const pos = [], col = [], c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const j = (i+1) % N;
      const ax = PX[i]+NX[i]*o, az = PZ[i]+NZ[i]*o, bx = PX[j]+NX[j]*o, bz = PZ[j]+NZ[j]*o;
      pos.push(ax,0,az, bx,0,bz, ax,h,az, ax,h,az, bx,0,bz, bx,h,bz);
      c.setHex(colorFn(i)); for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, lambert({ vertexColors: true, side: THREE.DoubleSide })));
  }

  // ground + mown stripes
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI/2), lambert({ color: COLORS.grass }));
  ground.position.set(cx, -0.06, cz); scene.add(ground);
  const stripeTex = canvasTexture(64, 2, x => { for (let i = 0; i < 16; i++) { x.fillStyle = hexCss(i % 2 ? COLORS.grass : COLORS.grassStripe); x.fillRect(i*4, 0, 4, 2); } });
  stripeTex.wrapS = THREE.RepeatWrapping; stripeTex.repeat.set(6, 1);
  const stripes = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900, 1, 1).rotateX(-Math.PI/2), lambert({ map: stripeTex }));
  stripes.position.set(cx, -0.03, cz); scene.add(stripes);

  // runoff (outside of corners only), road, edge lines, kerbs, barriers
  // gravel on the outside of corners: K > 0 turns right (toward +N), so its outside is the -N side
  const { SAND, SAND_K, KERB_K } = track;
  strip(-(HW+KERB+SAND), -(HW+KERB), 0.01, i => K[i] > SAND_K ? COLORS.sand : null);
  strip(HW+KERB, HW+KERB+SAND, 0.01, i => K[i] < -SAND_K ? COLORS.sand : null);
  strip(-HW, HW, 0.03, i => COLORS.asphalt[i % 40 < 20 ? 0 : 1]);
  strip(-HW+0.25, -HW+0.55, 0.06, () => COLORS.paint, 3);
  strip(HW-0.55, HW-0.25, 0.06, () => COLORS.paint, 3);
  const kerbColor = i => Math.abs(K[i]) > KERB_K ? COLORS.kerb[(i >> 1) % 2] : null;
  strip(-(HW+KERB), -HW+0.02, 0.05, kerbColor, 2);
  strip(HW-0.02, HW+KERB, 0.05, kerbColor, 2);
  const barrierColor = i => COLORS.barrier[(i >> 2) % 2];
  wall(-WALL, 1.1, barrierColor);
  wall(WALL, 1.1, barrierColor);

  // start/finish chequers
  { const tex = canvasTexture(32, 4, x => { for (let a = 0; a < 32; a++) for (let b = 0; b < 4; b++) { x.fillStyle = (a+b) % 2 ? '#111' : hexCss(COLORS.paint); x.fillRect(a, b, 1, 1); } });
    tex.center.set(0.5, 0.5); tex.rotation = Math.PI/2;
    placeAlong(new THREE.Mesh(new THREE.PlaneGeometry(1.6, HW*2).rotateX(-Math.PI/2), lambert(decal(4, { map: tex }))), 0, 0, 0.07); }

  // grid box lines, one per entrant
  { const mat = new THREE.MeshBasicMaterial(decal(4, { color: COLORS.paint })), geo = new THREE.PlaneGeometry(0.25, 2.6).rotateX(-Math.PI/2);
    drivers.forEach((d, slot) => { const { idx, lat } = SIM.gridSlot(track, slot, 2.9); placeAlong(new THREE.Mesh(geo, mat), idx, lat, 0.065); }); }

  // start gantry with the five lights
  const gantryLights = [];
  { const mat = lambert({ color: COLORS.steel }), g = new THREE.Group(), post = new THREE.BoxGeometry(0.6, 8, 0.6);
    for (const side of [-1, 1]) { const p = new THREE.Mesh(post, mat); p.position.set(0, 4, side*(HW+3)); g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, HW*2+6.6), mat); beam.position.y = 7.6; g.add(beam);
    const lampGeo = new THREE.SphereGeometry(0.28, 10, 8);
    for (let k = 0; k < CONFIG.lights.count; k++) {
      const l = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: COLORS.lampOff }));
      l.position.set(-0.62, 7.6, (k - (CONFIG.lights.count-1)/2) * 1.1); g.add(l); gantryLights.push(l);
    }
    placeAlong(g, landmarks.gantry ?? 2, 0, 0); }

  // grandstand with crowd (left of the main straight), pit building (right)
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
    placeAlong(st, landmarks.grandstand, -(WALL+3), 0);
  }
  if (landmarks.pits !== undefined) {
    const pits = new THREE.Group();
    const bld = new THREE.Mesh(new THREE.BoxGeometry(150, 7, 12), lambert({ color: COLORS.pits })); bld.position.set(0, 3.5, 6); pits.add(bld);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(146, 2, 0.2), lambert({ color: COLORS.glass })); glass.position.set(0, 5, -0.05); pits.add(glass);
    drivers.forEach((d, k) => { const door = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 0.2), lambert({ color: d.color })); door.position.set(-67.5 + k*15, 1.6, -0.05); pits.add(door); });
    placeAlong(pits, landmarks.pits, WALL+2, 0);
  }

  // trees: random scatter, kept clear of the circuit and the grandstand
  const TREE_MAX = 520;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.45, 3, 6), lambert({ color: COLORS.trunk }), TREE_MAX);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 9, 7), lambert({ color: 0xffffff }), TREE_MAX);
  let treeCount = 0;
  { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const gs = landmarks.grandstand;
    const nearTrack = (x, z) => { for (let i = 0; i < N; i += 6) { const dx = x-PX[i], dz = z-PZ[i]; if (dx*dx+dz*dz < (WALL+10)**2) return true; } return false; };
    const nearStand = (x, z) => gs !== undefined && Math.abs(z - PZ[gs]) < 50 && x > PX[gs]-100 && x < PX[gs]+110;
    for (let tries = 0; treeCount < TREE_MAX && tries < 20000; tries++) {
      const x = minX - 260 + Math.random()*(maxX-minX+520), z = minZ - 260 + Math.random()*(maxZ-minZ+520);
      if (nearTrack(x, z) || nearStand(x, z)) continue;
      const s = 0.7 + Math.random()*0.8;
      sc.set(s, s, s); p.set(x, 1.5*s, z); m4.compose(p, q, sc); trunks.setMatrixAt(treeCount, m4);
      p.set(x, (3 + 4.5)*s, z); m4.compose(p, q, sc); crowns.setMatrixAt(treeCount, m4);
      crowns.setColorAt(treeCount, col.setHSL(0.27 + Math.random()*0.07, 0.45, 0.22 + Math.random()*0.1));
      treeCount++;
    }
    trunks.count = crowns.count = treeCount; scene.add(trunks, crowns); }

  // distant hills
  const hills = [];
  { const mat = lambert({ color: COLORS.hill });   // Lambert has no flatShading in r128; cones are faceted anyway
    for (let k = 0; k < 18; k++) {
      const a = k/18*Math.PI*2, r = 1700 + Math.random()*300;
      const h = new THREE.Mesh(new THREE.ConeGeometry(260 + Math.random()*200, 90 + Math.random()*110, 6), mat);
      h.position.set(cx + Math.cos(a)*r, 30, cz + Math.sin(a)*r); h.rotation.y = Math.random(); scene.add(h); hills.push(h);
    } }

  return {
    applyProfile(p) {
      trunks.count = crowns.count = Math.floor(treeCount * p.treeFraction);
      if (crowd) crowd.count = Math.min(CROWD_MAX, p.crowd);
      stripes.visible = p.stripes;
      for (const h of hills) h.visible = p.hills;
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
