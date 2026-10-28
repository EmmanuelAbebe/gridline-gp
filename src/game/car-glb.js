import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

// The 2026 car made in Blender (tools/blender/car.py → models/car.glb, docs/car-plan.md), with the same per-car API as
// the part-built car in car-models.js (which picks between the two: CarModels.setKind). The model's objects carry the
// roles and the moving parts by name:
//   materials paint_main / paint_accent (the livery), carbon, rubber, metal (rims: the livery's rim colour), light
//   (brake lights), glass, dark; wheel_fl/fr/rl/rr = axle centres (spin about z, the fronts steer about y);
//   fw_flap1, fw_flap2, rw_flap (extras.open = degrees in straight mode, turned about their hinge, z);
//   steer (turns about x) with grip_l / grip_r / screen; mirror_glass_l / _r; extras.show 'outside' = hidden in the
//   cockpit view (the helmet). The driver, helmet and steering wheel come from models/driver.glb (seatDriver).
// Every mesh's COLOR_0 = Blender's baked ambient occlusion; the materials multiply it.
const ROLE_COLOURS = { carbon: 0x101114, rubber: 0x0b0b0c, metal: 0x8a8d92, glass: 0x1a2128, dark: 0x050506 };
const shared = { quality: {}, fast: {} };
// the driver (models/driver.glb, tools/blender/cockpit.py): the clip's keys run from the wheel at −lock to +lock; the head
// leans against the cornering (rad per m/s² of lateral g, at most, how fast it follows /s)
const DRIVER = { lock: 90, head: 'Head_06', lean: 0.012, max: 0.2, follow: 6 };
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), fwd = new THREE.Vector3();

// one car's driver: a clone of the skinned driver in the car's frame, the steering wheel moved onto the car's steer node
// (which turns it), the helmet hung on the head bone (it was placed on the head in Blender: attach keeps where it is)
function seatDriver(t, model, steer) {
  const group = SkeletonUtils.clone(t.scene); model.add(group); model.updateMatrixWorld(true);
  const wheel = [];
  const holder = group.getObjectByName('wheel');
  if (holder && steer) for (const c of [...holder.children]) { steer.attach(c); wheel.push(c); }
  const display = wheel.find(c => c.name === 'wheel_screen');    // (the wheel's own display: the live screen goes on it)
  const mixer = new THREE.AnimationMixer(group), action = mixer.clipAction(t.clip); action.play(); mixer.update(0);
  group.updateMatrixWorld(true);
  const head = group.getObjectByName(DRIVER.head), helmet = group.getObjectByName('helmet');
  if (head && helmet) head.attach(helmet);
  group.traverse(o => { if (o.isMesh) o.frustumCulled = false; });     // (skinned: the bounds are the standing avatar's)
  return { group, wheel, display, helmet, head, mixer, action, end: t.clip.duration * 0.9999, lean: 0 };
}     // the colour-free roles, one material per graphics profile

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
  model.traverse(o => { if (o.isMesh) { o.userData.role = o.material.name; o.userData.standIn = /^(helmet|visor)$/.test(o.name); o.userData.show ??= o.parent?.userData.show; meshes.push(o); } });
  const node = name => model.getObjectByName(name);
  // (the livery's rim colour: any metal inside a wheel)
  const inWheel = o => { for (let p = o.parent; p; p = p.parent) if (/^wheel_/.test(p.name)) return true; return false; };

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
  const seated = ctx.driverTemplate?.clip ? seatDriver(ctx.driverTemplate, model, steer) : null;

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
      const role = m.userData.role, rim = role === 'metal' && (m.name.startsWith('rim') || inWheel(m));
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
    for (const m of meshes) m.visible = !(seated && m.userData.standIn) && ((m.userData.show ?? 'always') === 'always' || m.userData.show === (cockpitView ? 'cockpit' : 'outside'));
    if (seated) {   // (the ghost car is empty; from the cockpit the camera is inside the helmet)
      seated.group.visible = !ghost; for (const w of seated.wheel) w.visible = !ghost;
      if (seated.helmet) seated.helmet.visible = !cockpitView;
    }
    for (const s of glows) s.visible = !cockpitView && lit > 0.02;
    if (cockpitView && !driverBody && !seated) {
      driverBody = ctx.createDriverBody(driver); root.add(driverBody.group); ctx.markShadows(driverBody.group, castsShadow);
      driverBody.group.position.set(ctx.eyeShift[0], ctx.eyeShift[1], 0);      // (the body is laid out for the classic seat)
    }
    if (driverBody) driverBody.group.visible = cockpitView;
    if (screen) screen.visible = screenSpec.show === 'always' || screenSpec.show === (cockpitView ? 'cockpit' : 'outside');
  }
  function placeScreen() {
    if (!screen || !steer) return;
    const sp = screenSpec, d = seated?.display;
    steer.add(screen); screen.position.copy(d?.position ?? node('screen')?.position ?? new THREE.Vector3());
    screen.rotation.set(sp.rot[0] * DEG, sp.rot[1] * DEG, sp.rot[2] * DEG);
    const size = d?.userData.size ?? sp.size;
    screen.scale.set(Math.max(0.001, size[0]), Math.max(0.001, size[1]), 1);
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
      materials(); showView();
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
        // (in the car's own frame: measured in the world, a car turned on the grid swapped the glass's width and depth)
        root.updateMatrixWorld(true);
        const g = (o.isMesh ? o : o.getObjectByProperty('isMesh', true)).geometry; g.computeBoundingBox();
        const rel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply((o.isMesh ? o : o.getObjectByProperty('isMesh', true)).matrixWorld);
        box.copy(g.boundingBox).applyMatrix4(rel); box.getSize(size);
        const c = box.getCenter(new THREE.Vector3());
        // (camOut: the glass sits recessed in its housing; the mirror's camera goes back past the housing's lip)
        return { name: `mirror glass ${i ? 'R' : 'L'}`, size: [size.x, size.y, size.z], pos: [c.x, c.y, c.z], rot: [0, 0, 0], show: 'always', gap: 0.004, camOut: 0.09 };
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
      if (seated) {
        const s = Math.max(-1, Math.min(1, car.steer * steerSpec.lock / DRIVER.lock));
        seated.action.time = (s + 1) / 2 * seated.end; seated.mixer.update(0);
        // the head leans out of the corner (ay + = toward +z): about the car's forward axis, in the bone's own frame
        const want = Math.max(-DRIVER.max, Math.min(DRIVER.max, -(car.ay || 0) * DRIVER.lean));
        seated.lean += (want - seated.lean) * Math.min(1, dt * DRIVER.follow);
        if (seated.head && Math.abs(seated.lean) > 1e-4) {
          seated.head.updateWorldMatrix(true, false); seated.head.getWorldQuaternion(qa);
          fwd.set(1, 0, 0).applyQuaternion(root.quaternion).applyQuaternion(qa.invert());
          seated.head.quaternion.multiply(qb.setFromAxisAngle(fwd, seated.lean));
        }
      }
      if (cockpitView && driverBody && steer) {
        root.updateMatrixWorld(true);
        for (let i = 0; i < 2; i++) root.worldToLocal(hands[i].copy(grips[i]).applyMatrix4(steer.matrixWorld)).sub(driverBody.group.position);
        driverBody.update(hands, pedals[0], pedals[1], dt);
      }
    },
    dispose() {
      scene.remove(root);
      for (const m of Object.values(own)) m.dispose();
      light.dispose(); glowMat.dispose(); driverBody?.dispose?.(); seated?.mixer.stopAllAction();
    },
  };
}
