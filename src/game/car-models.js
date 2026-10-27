import * as THREE from 'three';
import { COLORS } from './config.js';
import { SHAPES, SIGNED_SIZE, OWN_UV, tyreGeometry } from './car-shapes.js';
import { BODY_ROLES } from './car-body.js';
import { createDriverBody } from './driver-body.js';
import { carbonTexture, tyreTexture, skyEnvironment, glowTexture, numberTexture } from './car-textures.js';
import { markShadows } from './shadows.js';
import { createGlbCar } from './car-glb.js';
import { Models } from './models.js';

// Built from Design.data.car. Per car: fixed parts merged into one mesh with a group per finish (paint, carbon,
// rubber, metal, light, decal), parts that turn with the steering in a second mesh, one mesh per wheel, brake-light
// glows and a blob shadow. The player's cockpit view adds the driver's arms and legs (driver-body.js). In cameras with `cockpitBody` the player car switches to its cockpit-view parts
// (show: always + cockpit) instead of the outside ones (always + outside).
// Two kinds of car (2026-10-26, docs/car-plan.md): 'classic' = this part-built one (the design tools edit it), '2026' =
// the Blender model (car-glb.js). create() hands out a stand-in that forwards to either; setKind swaps every car's.
export const CarModels = (() => {
  // finish order = material index. A part's finish defaults from its colour role (dark → carbon, tyre → rubber).
  const FINISHES = ['paint', 'carbon', 'rubber', 'metal', 'light', 'decal'];
  const finishOf = p => FINISHES.includes(p.finish) ? p.finish : p.color === 'dark' ? 'carbon' : p.color === 'tyre' ? 'rubber' : 'paint';
  const env = skyEnvironment(), carbon = carbonTexture(), tyre = tyreTexture(), glow = glowTexture();
  // shared materials for the two graphics profiles (light and decal are per car, see create)
  const MATS = {
    quality: { kind: 'quality',
      paint:  new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.45 }),
      carbon: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: carbon, roughness: 0.38, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap: env, envMapIntensity: 0.5 }),
      rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      metal:  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85, envMap: env }),
      tyre:   new THREE.MeshStandardMaterial({ map: tyre, roughness: 0.85 }),
    },
    fast: { kind: 'fast',
      paint:  new THREE.MeshLambertMaterial({ vertexColors: true }),
      carbon: new THREE.MeshLambertMaterial({ vertexColors: true, map: carbon }),
      rubber: new THREE.MeshLambertMaterial({ vertexColors: true }),
      metal:  new THREE.MeshLambertMaterial({ vertexColors: true }),
      tyre:   new THREE.MeshLambertMaterial({ map: tyre }),
    },
  };
  // body paint per livery finish (garage): gloss = the shared paint; the others get a per-car material (quality only)
  const FINISH_LOOKS = {
    metallic: { roughness: 0.22, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.85 },
    satin: { roughness: 0.5, metalness: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.3 },
    matte: { roughness: 0.85, metalness: 0, clearcoat: 0, clearcoatRoughness: 1, envMapIntensity: 0.12 },
  };
  const LIGHT_OFF = new THREE.Color(0x3a0806), LIGHT_ON = new THREE.Color(0xff2a18);
  const GLOW_GEO = new THREE.PlaneGeometry(1, 1).rotateY(-Math.PI / 2);   // faces -x (backwards)
  // contact shadow: the soft darkening right under the car (ambient light blocked by the floor, darkest between the
  // wheels and at the four tyre patches); the sun's shadow comes on top in Quality mode (display.js, shadows.js)
  const SHADOW_GEO = new THREE.PlaneGeometry(6.2, 2.8).rotateX(-Math.PI/2);
  const SHADOW_MAT = new THREE.MeshBasicMaterial({ map: contactShadow(), color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  function contactShadow() {
    const W = 512, H = 232, c = document.createElement('canvas'); c.width = W; c.height = H;   // 6.2 × 2.8 m
    const g = c.getContext('2d'), m = W / 6.2, X = x => W / 2 + x * m, Y = z => H / 2 + z * m;
    const blob = (x0, z0, x1, z1, r, blur, a) => {
      g.filter = `blur(${blur * m}px)`; g.fillStyle = `rgba(0,0,0,${a})`;
      g.beginPath(); g.roundRect(X(x0), Y(z0), (x1 - x0) * m, (z1 - z0) * m, r * m); g.fill();
    };
    blob(-2.55, -0.85, 2.45, 0.85, 0.5, 0.32, 0.55);       // the whole footprint, very soft
    blob(-1.9, -0.55, 1.6, 0.55, 0.3, 0.18, 0.6);          // the floor, between the wheels
    for (const x of [-1.75, 1.6]) for (const z of [-0.8, 0.8]) blob(x - 0.36, z - 0.22, x + 0.36, z + 0.22, 0.12, 0.07, 0.85);   // tyres
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  const FRONT_STEER = 0.32;   // radians of front-wheel angle at full lock
  const CARBON_UV = 3;        // weave repeats per metre
  const DEG = Math.PI / 180;
  const resolveColor = (c, driver) =>
    c === 'body' ? driver.color : c === 'accent' ? driver.accent : c === 'dark' ? COLORS.carDark : c === 'tyre' ? COLORS.tyre
    : c === 'rim' ? driver.rims ?? 0x3a3d42
    : (parseInt(String(c).replace('#', ''), 16) || 0);

  // Design parts → one non-indexed BufferGeometry (vertex colours, a group per finish), relative to `origin`.
  // Texture coordinates: decals keep their own; everything else is projected along its face's main axis
  // (so the carbon weave has the same scale on every part).
  function mergeParts(parts, driver, origin = [0, 0, 0]) {
    const out = FINISHES.map(() => ({ pos: [], nor: [], col: [], uv: [] })), o = new THREE.Object3D();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    for (const p of parts) {
      const size = p.size.map((v, i) => SIGNED_SIZE.has(p.shape) || (p.shape === 'torus' && i === 2) ? v : Math.max(0.001, Math.abs(v)));
      let g = (SHAPES[p.shape] || SHAPES.box)(size, p);
      if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
      o.position.set(p.pos[0] - origin[0], p.pos[1] - origin[1], p.pos[2] - origin[2]);
      o.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG); o.updateMatrix();
      g.applyMatrix4(o.matrix);
      const P = g.attributes.position.array, Nn = g.attributes.normal.array, U = g.attributes.uv && g.attributes.uv.array;
      // per-face roles (car-body.js): 0 = this part's colour and finish, others = BODY_ROLES overrides
      const R = g.attributes.role && g.attributes.role.array, looks = [p, ...BODY_ROLES.slice(1)].map(r => {
        const q = r === p ? p : { ...r, finish: r.finish ?? p.finish, color: r.color };
        return { dst: out[FINISHES.indexOf(finishOf(q))], col: new THREE.Color(resolveColor(q.color, driver)) };
      });
      const keep = OWN_UV.has(p.shape) && U;
      for (let t = 0; t < P.length; t += 9) {
        const { dst, col } = looks[R ? R[t / 3] : 0];
        for (let i = t; i < t + 9; i++) { dst.pos.push(P[i]); dst.nor.push(Nn[i]); }
        a.set(P[t+3] - P[t], P[t+4] - P[t+1], P[t+5] - P[t+2]); b.set(P[t+6] - P[t], P[t+7] - P[t+1], P[t+8] - P[t+2]);
        n.crossVectors(a, b); const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        for (let k = 0; k < 9; k += 3) {
          const x = P[t+k], y = P[t+k+1], z = P[t+k+2], vi = (t + k) / 3;
          if (keep) dst.uv.push(U[vi*2], U[vi*2+1]);
          else if (ax >= ay && ax >= az) dst.uv.push(z * CARBON_UV, y * CARBON_UV);
          else if (ay >= az) dst.uv.push(x * CARBON_UV, z * CARBON_UV);
          else dst.uv.push(x * CARBON_UV, y * CARBON_UV);
          dst.col.push(col.r, col.g, col.b);
        }
      }
      g.dispose();
    }
    const g = new THREE.BufferGeometry(), all = { pos: [], nor: [], col: [], uv: [] };
    let start = 0;
    out.forEach((d, m) => {
      const count = d.pos.length / 3;
      if (count) g.addGroup(start, count, m);
      start += count;
      for (const k of Object.keys(all)) for (const v of d[k]) all[k].push(v);
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
    return g;
  }
  // Wheel: textured tyre (its own mesh) + rim, wheel cover, accent ring and centre nut (merged parts).
  const wheelParts = (r, w) => [
    { shape: 'cylinder', size: [r * 0.63, w * 0.96], pos: [0, 0, 0], rot: [90, 0, 0], color: 'rim', finish: 'metal', segments: 24 },
    { shape: 'cylinder', size: [r * 0.6, w + 0.012], pos: [0, 0, 0], rot: [90, 0, 0], color: 'dark', finish: 'paint', segments: 24 },
    { shape: 'torus', size: [r * 0.47, 0.012, 360], pos: [0, 0, w / 2 + 0.006], rot: [0, 0, 0], color: 'accent' },
    { shape: 'torus', size: [r * 0.47, 0.012, 360], pos: [0, 0, -w / 2 - 0.006], rot: [0, 0, 0], color: 'accent' },
    { shape: 'cylinder', size: [r * 0.12, w + 0.04], pos: [0, 0, 0], rot: [90, 0, 0], color: 'accent', finish: 'metal', segments: 6 },
  ];

  // driver = colours (color, accent, optional rims) and number; the garage changes them with setLivery
  function createClassic(scene, driverIn, design) {
    let driver = driverIn, lastDesign = design, ownPaint = null;
    // per-car materials: the brake lights (brightness follows the brake) and the race number
    const light = new THREE.MeshBasicMaterial({ color: LIGHT_OFF.clone() });
    const decal = new THREE.MeshBasicMaterial({ map: numberTexture(driver.number ?? ''), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const glowMat = new THREE.MeshBasicMaterial({ map: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: true });
    let mats = MATS.quality;
    const matList = () => [ownPaint && mats === MATS.quality ? ownPaint : mats.paint, mats.carbon, mats.rubber, mats.metal, light, decal];
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BufferGeometry(), matList());
    // steering wheel assembly: mount (position/tilt/scale from car.steering) → steering mesh (turns with input)
    const mount = new THREE.Group(), steering = new THREE.Mesh(new THREE.BufferGeometry(), matList());
    mount.add(steering);
    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT); shadow.position.y = 0.04; shadow.renderOrder = 1;
    root.add(body, mount, shadow); scene.add(root);
    let geo = null, wheelGeos = [], pivots = [], wheels = [], fronts = [], glows = [], cockpitView = false, lock = 0, lit = 0;
    // active-aero parts (design `open`: degrees they turn in straight mode): one small mesh each, turned by car.aeroOpen
    let movers = [];
    let driverBody = null, grips = [], pedals = [0, 0];
    const hands = [new THREE.Vector3(), new THREE.Vector3()];

    function showView() {
      body.geometry = cockpitView ? geo.cockpit : geo.outside;
      steering.geometry = cockpitView ? geo.steerCockpit : geo.steerOutside;
      for (const s of glows) s.visible = !cockpitView && lit > 0.02;
      if (cockpitView && !driverBody) { driverBody = createDriverBody(driver); root.add(driverBody.group); markShadows(driverBody.group, castsShadow); }
      if (driverBody) driverBody.group.visible = cockpitView;
      for (const m of movers) m.mesh.visible = m.show === 'always' || m.show === (cockpitView ? 'cockpit' : 'outside');
      if (screen) screen.visible = screenSpec.show === 'always' || screenSpec.show === (cockpitView ? 'cockpit' : 'outside');
    }
    // Optional live screen (player car only), fixed to the steering wheel: moves, tilts, scales and turns with it.
    let screen = null, screenSpec = null;
    function placeScreen() {
      if (!screen) return;
      const sp = screenSpec;
      steering.add(screen);
      screen.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
      screen.rotation.set(sp.rot[0] * DEG, sp.rot[1] * DEG, sp.rot[2] * DEG);
      screen.scale.set(Math.max(0.001, sp.size[0]), Math.max(0.001, sp.size[1]), 1);
    }
    // (Re)build every mesh from a design; called at start and whenever the car design changes.
    function rebuild(d) {
      const { parts, wheels: wheelSpecs, steering: st, screen: sc } = d;
      lastDesign = d; screenSpec = sc;
      if (geo) for (const g of Object.values(geo)) g.dispose();
      for (const g of wheelGeos) g.dispose();
      for (const p of pivots) root.remove(p);
      for (const m of movers) { root.remove(m.mesh); m.mesh.geometry.dispose(); }
      for (const s of glows) root.remove(s);
      const moves = p => !p.steer && p.show !== 'off' && +p.open;
      const pick = (steer, view) => parts.filter(p => !!p.steer === steer && !moves(p) && (p.show === 'always' || p.show === view));
      movers = parts.filter(moves).map(p => {
        const mesh = new THREE.Mesh(mergeParts([p], driver, p.pos), matList());
        mesh.position.set(p.pos[0], p.pos[1], p.pos[2]); root.add(mesh);
        return { mesh, open: +p.open * DEG, show: p.show };
      });
      geo = {
        outside: mergeParts(pick(false, 'outside'), driver), cockpit: mergeParts(pick(false, 'cockpit'), driver),
        steerOutside: mergeParts(pick(true, 'outside'), driver), steerCockpit: mergeParts(pick(true, 'cockpit'), driver),
      };
      mount.position.set(st.pivot[0], st.pivot[1], st.pivot[2]);
      mount.rotation.set(st.rot[0] * DEG, st.rot[1] * DEG, st.rot[2] * DEG);
      mount.scale.set(...st.scale.map(k => Math.max(0.05, k)));
      lock = st.lock * DEG;
      // where the hands go: the grips (relative to the wheel centre), else either side of it
      grips = [['R', 0.135], ['L', -0.135]].map(([side, z]) => {
        const g = parts.find(p => p.steer && p.show !== 'off' && /grip/i.test(p.name) && p.name.endsWith(side));
        return new THREE.Vector3(...(g ? g.pos : [0, 0, z]));
      });
      // a glow behind every brake light, facing backwards (only seen from behind the car)
      glows = parts.filter(p => !p.steer && finishOf(p) === 'light' && p.show !== 'off' && p.show !== 'cockpit').map(p => {
        const s = new THREE.Mesh(GLOW_GEO, glowMat), k = Math.max(0.3, Math.max(...p.size.map(Math.abs)) * 3);
        s.position.set(p.pos[0] - 0.04, p.pos[1], p.pos[2]); s.scale.set(k, k, 1); root.add(s); return s;
      });
      wheelGeos = []; pivots = []; wheels = []; fronts = [];
      for (const w of wheelSpecs) {
        const pivot = new THREE.Group(), spin = new THREE.Group();
        const tg = tyreGeometry(w.radius, w.width), rg = mergeParts(wheelParts(w.radius, w.width), driver);
        const tyreMesh = new THREE.Mesh(tg, mats.tyre), rimMesh = new THREE.Mesh(rg, matList());
        tyreMesh.userData.tyre = true;
        spin.add(tyreMesh, rimMesh); pivot.position.set(w.pos[0], w.pos[1], w.pos[2]); pivot.add(spin); root.add(pivot);
        wheelGeos.push(tg, rg); pivots.push(pivot); wheels.push(spin); if (w.front) fronts.push(pivot);
        pivot.userData.z = w.pos[2];
      }
      placeScreen(); showView(); markShadows(root, castsShadow); shadow.castShadow = shadow.receiveShadow = false;
    }
    let castsShadow = true, service = null;
    rebuild(design);

    return {
      kind: 'classic',
      rebuild,
      mirrorParts: () => lastDesign.parts,
      dispose() {
        scene.remove(root);
        if (geo) for (const g of Object.values(geo)) g.dispose();
        for (const g of wheelGeos) g.dispose();
        for (const m of movers) m.mesh.geometry.dispose();
        light.dispose(); decal.map.dispose(); decal.dispose(); glowMat.dispose(); ownPaint?.dispose();
      },
      // the garage's livery: { color, accent, number, finish (gloss / metallic / satin / matte), rims }
      setLivery(l) {
        driver = { ...driver, color: l.color, accent: l.accent, number: l.number, rims: l.rims };
        decal.map.dispose(); decal.map = numberTexture(l.number); decal.needsUpdate = true;
        ownPaint?.dispose();
        ownPaint = FINISH_LOOKS[l.finish] ? new THREE.MeshPhysicalMaterial({ vertexColors: true, envMap: env, ...FINISH_LOOKS[l.finish] }) : null;
        rebuild(lastDesign); this.setMaterials(mats);
      },
      setMaterials(set) {
        mats = set; body.material = matList(); steering.material = matList();
        for (const m of movers) m.mesh.material = matList();
        for (const w of wheels) for (const m of w.children) m.material = m.userData.tyre ? set.tyre : matList();
      },
      // the ghost car (see-through) casts no shadow and has no contact shadow
      setShadows(on) { castsShadow = on; shadow.visible = on; markShadows(root, on); shadow.castShadow = shadow.receiveShadow = false; },
      useCockpitView(on) { if (on !== cockpitView) { cockpitView = on; showView(); } },
      setPedals(thr, brk) { pedals[0] = thr; pedals[1] = brk; },
      // a pit stop (pit-crew.js): { lift (m, on the jacks), outs: m each wheel is off sideways } or null
      setService(s) { service = s; },
      mountScreen(mesh) { screen = mesh; placeScreen(); showView(); },
      // y, pitch (nose up +), roll (+ = leaning right): the road under a car on a hilly circuit (pose.js)
      place(x, z, h, y = 0, pitch = 0, roll = 0) { root.position.set(x, y, z); root.rotation.set(roll, -h, pitch, 'YZX'); },
      setVisible(on) { root.visible = on; },
      get object() { return root; },        // the car's root group (the garage measures and frames it)
      // copy the car state onto the mesh at `pose` (pose.js: interpolated x/z/h); brake lights fade in and out over ~0.1 s
      sync(car, pose, dt = 1 / 60) {
        this.place(pose.x, pose.z, pose.h, (pose.y || 0) + (service?.lift ?? 0), pose.pitch || 0, pose.roll || 0);
        pivots.forEach((p, i) => { const z = p.userData.z; p.position.z = z + Math.sign(z) * (service?.outs[i] ?? 0); });
        for (const w of wheels) w.rotation.z = -car.roll;
        for (const p of fronts) p.rotation.y = -car.steer * FRONT_STEER;
        for (const m of movers) m.mesh.rotation.z = m.open * (car.aeroOpen || 0);   // straight mode: the flaps flatten
        steering.rotation.x = car.steer * lock;          // + steer (right) turns the wheel clockwise from the driver's seat
        const want = car.brake > 0.05 ? Math.min(1, 0.6 + car.brake) : 0;
        lit += (want - lit) * Math.min(1, dt * (want > lit ? 30 : 12));
        light.color.copy(LIGHT_OFF).lerp(LIGHT_ON, lit);
        glowMat.opacity = lit * 0.9;
        for (const s of glows) s.visible = !cockpitView && lit > 0.02;
        if (cockpitView && driverBody) {
          root.updateMatrixWorld(true);
          for (let i = 0; i < 2; i++) root.worldToLocal(hands[i].copy(grips[i]).applyMatrix4(steering.matrixWorld));
          driverBody.update(hands, pedals[0], pedals[1], dt);
        }
      },
    };
  }

  // Size of a set of parts (metres, unscaled) — used to show the steering wheel's width/height.
  function measure(parts) {
    const g = mergeParts(parts, { color: 0, accent: 0 }); g.computeBoundingBox();
    const b = g.boundingBox, size = parts.length ? [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] : [0, 0, 0];
    g.dispose(); return size;
  }
  // see-through materials for a ghost car (time trial: ghost.js); one shared set
  let ghostSet = null;
  function ghostMaterials() {
    if (!ghostSet) {
      const m = o => new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false, ...o });
      ghostSet = { kind: 'ghost', paint: m({ vertexColors: true }), carbon: m({ vertexColors: true }), rubber: m({ vertexColors: true }), metal: m({ vertexColors: true }), tyre: m({ color: 0x2a2c30 }) };
    }
    return ghostSet;
  }
  // ---- the stand-in every caller holds: remembers what was set, so a swap to the other kind looks the same
  let kind = 'classic';
  const live = new Set(), kindListeners = new Set();
  const glbCtx = () => ({ eyeShift: eyeShift(), template: Models.car, env, glow, SHADOW_GEO, SHADOW_MAT, GLOW_GEO, LIGHT_OFF, LIGHT_ON, FINISH_LOOKS, FRONT_STEER, DEG, createDriverBody, markShadows });
  function create(scene, driver, design) {
    const st = { design, livery: null, mats: null, shadows: true, visible: true, cockpit: false, screen: null, service: null, pedals: [0, 0] };
    const make = () => kind === '2026' && Models.car ? createGlbCar(scene, driver, st.design, glbCtx()) : createClassic(scene, driver, st.design);
    let inner = make();
    const w = {
      get kind() { return inner.kind; },
      rebuild(d) { st.design = d; inner.rebuild(d); },
      setLivery(l) { st.livery = l; const before = kind; if (l.model) setKind(l.model); if (kind === before) inner.setLivery(l); },
      setMaterials(set) { st.mats = set; inner.setMaterials(set); },
      setShadows(on) { st.shadows = on; inner.setShadows(on); },
      useCockpitView(on) { st.cockpit = on; inner.useCockpitView(on); },
      setPedals(thr, brk) { st.pedals = [thr, brk]; inner.setPedals(thr, brk); },
      setService(s) { st.service = s; inner.setService(s); },
      mountScreen(mesh) { st.screen = mesh; inner.mountScreen(mesh); },
      place(...a) { inner.place(...a); },
      setVisible(on) { st.visible = on; inner.setVisible(on); },
      get object() { return inner.object; },
      mirrorParts() { return inner.mirrorParts(); },
      sync(car, pose, dt) { inner.sync(car, pose, dt); },
      swap() {
        const was = inner.object, at = [was.position.clone(), was.rotation.clone()];
        inner.dispose(); inner = make();
        inner.object.position.copy(at[0]); inner.object.rotation.copy(at[1]);
        if (st.livery) inner.setLivery(st.livery);
        if (st.mats) inner.setMaterials(st.mats);
        inner.setShadows(st.shadows); inner.setVisible(st.visible); inner.useCockpitView(st.cockpit);
        inner.setPedals(...st.pedals); inner.setService(st.service);
        if (st.screen) inner.mountScreen(st.screen);
      },
      dispose() { live.delete(w); inner.dispose(); },
    };
    live.add(w);
    return w;
  }
  // 'classic' | '2026': every car in the game (the field, the garage's, the ghost) turns into that kind
  function setKind(k) {
    if (k === kind || (k === '2026' && !Models.car)) return;
    kind = k;
    for (const w of live) w.swap();
    for (const fn of kindListeners) fn(k);
  }

  // the classic car's seat (design-defaults: the cockpit camera's back 0.33 / height 0.77, driver-body.js); a model
  // with its own `eye` puts the driver, the cockpit camera and the mirrors' viewpoint that far from it
  const CLASSIC_EYE = [-0.33, 0.77];
  const eyeShift = () => { const e = kind === '2026' && Models.car?.getObjectByName('eye')?.position; return e ? [e.x - CLASSIC_EYE[0], e.y - CLASSIC_EYE[1]] : [0, 0]; };
  return { create, measure, ghostMaterials, setKind, get kind() { return kind; }, get eyeShift() { return eyeShift(); }, onKind(fn) { kindListeners.add(fn); }, applyProfile(models, p) {
    const set = p.lambertCars ? MATS.fast : MATS.quality; for (const m of models) m.setMaterials(set);
    SHADOW_MAT.opacity = p.shadows ? 0.6 : 0.8;        // with sun shadows on, the contact shadow is only the ambient part
  } };
})();
