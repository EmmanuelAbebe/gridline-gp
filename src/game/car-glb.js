import * as THREE from 'three';

// The 2026 car made in Blender (tools/blender/car.py → models/car.glb, docs/car-plan.md), with the same per-car API as
// the part-built car in car-models.js (which picks between the two: CarModels.setKind). The model's objects carry the
// roles and the moving parts by name:
//   materials paint_main / paint_accent (the livery), carbon, rubber, metal (rims: the livery's rim colour), light
//   (brake lights), glass, dark; wheel_fl/fr/rl/rr = axle centres (spin about z, the fronts steer about y);
//   fw_flap1, fw_flap2, rw_flap (extras.open = degrees in straight mode, turned about their hinge, z);
//   steer (turns about x) with grip_l / grip_r / screen; mirror_glass_l / _r; extras.show 'outside' = hidden in the
//   cockpit view (the helmet).
// Every mesh's COLOR_0 = Blender's baked ambient occlusion; the materials multiply it.
const ROLE_COLOURS = { carbon: 0x101114, rubber: 0x0b0b0c, metal: 0x8a8d92, glass: 0x1a2128, dark: 0x050506 };
const shared = { quality: {}, fast: {} };     // the colour-free roles, one material per graphics profile

function sharedMat(profile, role, env) {
  const S = shared[profile];
  if (!S[role]) {
    const color = ROLE_COLOURS[role];
    S[role] = profile === 'fast' ? new THREE.MeshLambertMaterial({ color, vertexColors: true })
      : role === 'carbon' ? new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.4, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.12, envMap: env, envMapIntensity: 0.5 })
      : role === 'glass' ? new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.9, envMap: env })
      : new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: role === 'rubber' ? 0.9 : 0.6, metalness: role === 'metal' ? 0.8 : 0, envMap: env });
  }
  return S[role];
}

// ctx = what car-models.js shares: { template, env, glow, SHADOW_GEO, SHADOW_MAT, GLOW_GEO, LIGHT_OFF, LIGHT_ON,
// FINISH_LOOKS, FRONT_STEER, DEG, createDriverBody, markShadows }
export function createGlbCar(scene, driverIn, design, ctx) {
  const { DEG } = ctx;
  let driver = driverIn, steerSpec = design.steering, screenSpec = design.screen, finish = 'gloss', rims = driverIn.rims ?? 0x3a3d42;
  let profile = 'quality', ghost = null, castsShadow = true, cockpitView = false, service = null, lit = 0, screen = null, driverBody = null;
  const pedals = [0, 0], hands = [new THREE.Vector3(), new THREE.Vector3()];

  const root = new THREE.Group(), model = ctx.template.clone(true);
  const shadow = new THREE.Mesh(ctx.SHADOW_GEO, ctx.SHADOW_MAT); shadow.position.y = 0.04; shadow.renderOrder = 1;
  root.add(model, shadow); scene.add(root);
  model.updateMatrixWorld(true);

  const meshes = [];
  model.traverse(o => { if (o.isMesh) { o.userData.role = o.material.name; o.userData.show ??= o.parent?.userData.show; meshes.push(o); } });
  const node = name => model.getObjectByName(name);

  // wheels: the spin goes on a group inside the axle node, so the node can steer and slide out at a pit stop
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(name => {
    const pivot = node(name), spin = new THREE.Group();
    while (pivot.children.length) spin.add(pivot.children[0]);
    pivot.add(spin);
    return { pivot, spin, z: pivot.position.z, front: name[6] === 'f' };
  });
  // every node with extras.open turns that many degrees in straight mode about extras.axis (its hinge line; default z)
  const movers = [];
  model.traverse(o => { if (+o.userData.open) movers.push({ o, open: +o.userData.open * DEG, base: o.quaternion.clone(),
    axis: new THREE.Vector3(...(o.userData.axis ?? [0, 0, 1])).normalize(), q: new THREE.Quaternion() }); });
  const steer = node('steer'), grips = ['grip_r', 'grip_l'].map(n => node(n)?.position.clone() ?? new THREE.Vector3());

  // per-car materials: the livery's paint, the rims, the brake lights; the rest shared per graphics profile
  const light = new THREE.MeshBasicMaterial({ color: ctx.LIGHT_OFF.clone() });
  const glowMat = new THREE.MeshBasicMaterial({ map: ctx.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: true });
  let own = {};
  function paint(color) {
    if (profile === 'fast') return new THREE.MeshLambertMaterial({ color, vertexColors: true });
    const look = ctx.FINISH_LOOKS[finish] ?? { roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.45 };
    return new THREE.MeshPhysicalMaterial({ color, vertexColors: true, envMap: ctx.env, ...look });
  }
  function materials() {
    for (const m of Object.values(own)) m.dispose();
    own = ghost ? {} : { paint_main: paint(driver.color), paint_accent: paint(driver.accent),
      rim: profile === 'fast' ? new THREE.MeshLambertMaterial({ color: rims, vertexColors: true }) : new THREE.MeshStandardMaterial({ color: rims, vertexColors: true, roughness: 0.3, metalness: 0.8, envMap: ctx.env }) };
    for (const m of meshes) {
      const role = m.userData.role, rim = role === 'metal' && m.name.startsWith('rim');
      m.material = ghost ? (role === 'rubber' ? ghost.tyre : role.startsWith('paint') ? ghost.paint : ghost.carbon)
        : role === 'light' ? light : rim ? own.rim : own[role] ?? sharedMat(profile, role, ctx.env);
    }
  }
  materials();

  // a glow behind every brake light, facing backwards
  const box = new THREE.Box3(), size = new THREE.Vector3();
  const glows = meshes.filter(m => m.userData.role === 'light').map(m => {
    box.setFromObject(m); box.getSize(size); root.worldToLocal(box.getCenter(new THREE.Vector3()));
    const s = new THREE.Mesh(ctx.GLOW_GEO, glowMat), k = Math.max(0.3, Math.max(size.x, size.y, size.z) * 3);
    s.position.copy(box.getCenter(new THREE.Vector3())); s.position.x -= 0.04; s.scale.set(k, k, 1); root.add(s); return s;
  });

  function showView() {
    for (const m of meshes) m.visible = (m.userData.show ?? 'always') === 'always' || m.userData.show === (cockpitView ? 'cockpit' : 'outside');
    for (const s of glows) s.visible = !cockpitView && lit > 0.02;
    if (cockpitView && !driverBody) {
      driverBody = ctx.createDriverBody(driver); root.add(driverBody.group); ctx.markShadows(driverBody.group, castsShadow);
      driverBody.group.position.set(ctx.eyeShift[0], ctx.eyeShift[1], 0);      // (the body is laid out for the classic seat)
    }
    if (driverBody) driverBody.group.visible = cockpitView;
    if (screen) screen.visible = screenSpec.show === 'always' || screenSpec.show === (cockpitView ? 'cockpit' : 'outside');
  }
  function placeScreen() {
    if (!screen || !steer) return;
    const at = node('screen')?.position ?? new THREE.Vector3(), sp = screenSpec;
    steer.add(screen); screen.position.copy(at);
    screen.rotation.set(sp.rot[0] * DEG, sp.rot[1] * DEG, sp.rot[2] * DEG);
    screen.scale.set(Math.max(0.001, sp.size[0]), Math.max(0.001, sp.size[1]), 1);
  }
  ctx.markShadows(root, castsShadow); shadow.castShadow = shadow.receiveShadow = false;
  showView();

  return {
    kind: '2026',
    // the design only sets the steering lock and the wheel screen here (the shape is the model's)
    rebuild(d) { steerSpec = d.steering; screenSpec = d.screen; placeScreen(); showView(); },
    setLivery(l) {
      driver = { ...driver, color: l.color, accent: l.accent, number: l.number, rims: l.rims };
      finish = l.finish; rims = l.rims ?? rims; materials();
    },
    setMaterials(set) {
      ghost = set.kind === 'ghost' ? set : null;
      if (!ghost) profile = set.kind === 'fast' ? 'fast' : 'quality';
      materials();
    },
    setShadows(on) { castsShadow = on; shadow.visible = on; ctx.markShadows(root, on); shadow.castShadow = shadow.receiveShadow = false; },
    useCockpitView(on) { if (on !== cockpitView) { cockpitView = on; showView(); } },
    setPedals(thr, brk) { pedals[0] = thr; pedals[1] = brk; },
    setService(s) { service = s; },
    mountScreen(mesh) { screen = mesh; placeScreen(); showView(); },
    place(x, z, h, y = 0, pitch = 0, roll = 0) { root.position.set(x, y, z); root.rotation.set(roll, -h, pitch, 'YZX'); },
    setVisible(on) { root.visible = on; },
    get object() { return root; },
    // the mirror glasses in the design-part form mirrors.js builds from
    mirrorParts() {
      return ['l', 'r'].map(n => node(`mirror_glass_${n}`)).filter(Boolean).map((o, i) => {
        box.setFromObject(o); box.getSize(size);
        const c = root.worldToLocal(box.getCenter(new THREE.Vector3()));
        return { name: `mirror glass ${i ? 'R' : 'L'}`, size: [size.x, size.y, size.z], pos: [c.x, c.y, c.z], rot: [0, 0, 0], show: 'always', gap: 0.004 };
      });
    },
    sync(car, pose, dt = 1 / 60) {
      this.place(pose.x, pose.z, pose.h, (pose.y || 0) + (service?.lift ?? 0), pose.pitch || 0, pose.roll || 0);
      wheels.forEach((w, i) => {
        w.pivot.position.z = w.z + Math.sign(w.z) * (service?.outs[i] ?? 0);
        w.spin.rotation.z = -car.roll;
        if (w.front) w.pivot.rotation.y = -car.steer * ctx.FRONT_STEER;
      });
      for (const m of movers) m.o.quaternion.copy(m.base).multiply(m.q.setFromAxisAngle(m.axis, m.open * (car.aeroOpen || 0)));
      if (steer) steer.rotation.x = car.steer * steerSpec.lock * DEG;
      const want = car.brake > 0.05 ? Math.min(1, 0.6 + car.brake) : 0;
      lit += (want - lit) * Math.min(1, dt * (want > lit ? 30 : 12));
      light.color.copy(ctx.LIGHT_OFF).lerp(ctx.LIGHT_ON, lit);
      glowMat.opacity = lit * 0.9;
      for (const s of glows) s.visible = !cockpitView && lit > 0.02;
      if (cockpitView && driverBody && steer) {
        root.updateMatrixWorld(true);
        for (let i = 0; i < 2; i++) root.worldToLocal(hands[i].copy(grips[i]).applyMatrix4(steer.matrixWorld)).sub(driverBody.group.position);
        driverBody.update(hands, pedals[0], pedals[1], dt);
      }
    },
    dispose() {
      scene.remove(root);
      for (const m of Object.values(own)) m.dispose();
      light.dispose(); glowMat.dispose(); driverBody?.dispose?.();
    },
  };
}
