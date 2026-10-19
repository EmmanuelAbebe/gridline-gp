import * as THREE from 'three';
import { COLORS } from './config.js';
import { SHAPES, SIGNED_SIZE, OWN_UV, tyreGeometry } from './car-shapes.js';
import { createDriverBody } from './driver-body.js';
import { carbonTexture, tyreTexture, skyEnvironment, glowTexture, numberTexture } from './car-textures.js';

// Built from Design.data.car. Per car: fixed parts merged into one mesh with a group per finish (paint, carbon,
// rubber, metal, light, decal), parts that turn with the steering in a second mesh, one mesh per wheel, brake-light
// glows and a blob shadow. The player's cockpit view adds the driver's arms and legs (driver-body.js). In cameras with `cockpitBody` the player car switches to its cockpit-view parts
// (show: always + cockpit) instead of the outside ones (always + outside).
export const CarModels = (() => {
  // finish order = material index. A part's finish defaults from its colour role (dark → carbon, tyre → rubber).
  const FINISHES = ['paint', 'carbon', 'rubber', 'metal', 'light', 'decal'];
  const finishOf = p => FINISHES.includes(p.finish) ? p.finish : p.color === 'dark' ? 'carbon' : p.color === 'tyre' ? 'rubber' : 'paint';
  const env = skyEnvironment(), carbon = carbonTexture(), tyre = tyreTexture(), glow = glowTexture();
  // shared materials for the two graphics profiles (light and decal are per car, see create)
  const MATS = {
    quality: {
      paint:  new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.45 }),
      carbon: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: carbon, roughness: 0.38, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap: env, envMapIntensity: 0.5 }),
      rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      metal:  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85, envMap: env }),
      tyre:   new THREE.MeshStandardMaterial({ map: tyre, roughness: 0.85 }),
    },
    fast: {
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
  const SHADOW_GEO = new THREE.PlaneGeometry(5.8, 2.4).rotateX(-Math.PI/2);
  const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
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
    const out = FINISHES.map(() => ({ pos: [], nor: [], col: [], uv: [] })), c = new THREE.Color(), o = new THREE.Object3D();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    for (const p of parts) {
      const size = p.size.map((v, i) => SIGNED_SIZE.has(p.shape) || (p.shape === 'torus' && i === 2) ? v : Math.max(0.001, Math.abs(v)));
      let g = (SHAPES[p.shape] || SHAPES.box)(size, p);
      if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
      o.position.set(p.pos[0] - origin[0], p.pos[1] - origin[1], p.pos[2] - origin[2]);
      o.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG); o.updateMatrix();
      g.applyMatrix4(o.matrix);
      const P = g.attributes.position.array, Nn = g.attributes.normal.array, U = g.attributes.uv && g.attributes.uv.array;
      const dst = out[FINISHES.indexOf(finishOf(p))], keep = OWN_UV.has(p.shape) && U;
      c.setHex(resolveColor(p.color, driver));
      for (let i = 0; i < P.length; i++) { dst.pos.push(P[i]); dst.nor.push(Nn[i]); }
      for (let t = 0; t < P.length; t += 9) {
        a.set(P[t+3] - P[t], P[t+4] - P[t+1], P[t+5] - P[t+2]); b.set(P[t+6] - P[t], P[t+7] - P[t+1], P[t+8] - P[t+2]);
        n.crossVectors(a, b); const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        for (let k = 0; k < 9; k += 3) {
          const x = P[t+k], y = P[t+k+1], z = P[t+k+2], vi = (t + k) / 3;
          if (keep) dst.uv.push(U[vi*2], U[vi*2+1]);
          else if (ax >= ay && ax >= az) dst.uv.push(z * CARBON_UV, y * CARBON_UV);
          else if (ay >= az) dst.uv.push(x * CARBON_UV, z * CARBON_UV);
          else dst.uv.push(x * CARBON_UV, y * CARBON_UV);
          dst.col.push(c.r, c.g, c.b);
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
  function create(scene, driverIn, design) {
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
    let driverBody = null, grips = [], pedals = [0, 0];
    const hands = [new THREE.Vector3(), new THREE.Vector3()];

    function showView() {
      body.geometry = cockpitView ? geo.cockpit : geo.outside;
      steering.geometry = cockpitView ? geo.steerCockpit : geo.steerOutside;
      for (const s of glows) s.visible = !cockpitView && lit > 0.02;
      if (cockpitView && !driverBody) { driverBody = createDriverBody(driver); root.add(driverBody.group); }
      if (driverBody) driverBody.group.visible = cockpitView;
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
      for (const s of glows) root.remove(s);
      const pick = (steer, view) => parts.filter(p => !!p.steer === steer && (p.show === 'always' || p.show === view));
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
      }
      placeScreen(); showView();
    }
    rebuild(design);

    return {
      rebuild,
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
        for (const w of wheels) for (const m of w.children) m.material = m.userData.tyre ? set.tyre : matList();
      },
      useCockpitView(on) { if (on !== cockpitView) { cockpitView = on; showView(); } },
      setPedals(thr, brk) { pedals[0] = thr; pedals[1] = brk; },
      mountScreen(mesh) { screen = mesh; placeScreen(); showView(); },
      place(x, z, h) { root.position.set(x, 0, z); root.rotation.y = -h; },
      setVisible(on) { root.visible = on; },
      get object() { return root; },        // the car's root group (the garage measures and frames it)
      // copy the car state onto the mesh at `pose` (pose.js: interpolated x/z/h); brake lights fade in and out over ~0.1 s
      sync(car, pose, dt = 1 / 60) {
        this.place(pose.x, pose.z, pose.h);
        for (const w of wheels) w.rotation.z = -car.roll;
        for (const p of fronts) p.rotation.y = -car.steer * FRONT_STEER;
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
  return { create, measure, applyProfile(models, p) { const set = p.lambertCars ? MATS.fast : MATS.quality; for (const m of models) m.setMaterials(set); } };
})();
