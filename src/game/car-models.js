import * as THREE from 'three';
import { COLORS } from './config.js';

// Built from Design.data.car. Per car: fixed parts merged into one vertex-coloured mesh, parts that turn with
// the steering in a second mesh, one mesh per wheel and a blob shadow. In cameras with `cockpitBody` the player
// car switches to its cockpit-view parts (show: always + cockpit) instead of the outside ones (always + outside).
export const CarModels = (() => {
  const MATS = {
    quality: { body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.22 }),
               wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }) },
    fast:    { body: new THREE.MeshLambertMaterial({ vertexColors: true }), wheel: new THREE.MeshLambertMaterial({ vertexColors: true }) },
  };
  const SHADOW_GEO = new THREE.PlaneGeometry(5.8, 2.4).rotateX(-Math.PI/2);
  const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  const FRONT_STEER = 0.32;   // radians of front-wheel angle at full lock
  const DEG = Math.PI / 180;
  const SHAPES = {
    box:      (s)    => new THREE.BoxGeometry(s[0], s[1], s[2]),
    sphere:   (s)    => new THREE.SphereGeometry(s[0], 10, 8),
    cylinder: (s, p) => new THREE.CylinderGeometry(s[0], s[0], s[1], p.segments || 12),
    rounded:  (s, p) => roundedBox(s[0], s[1], s[2], p.radius),
    torus:    (s)    => { const arc = Math.min(360, Math.max(1, s[2])); return new THREE.TorusGeometry(s[0], s[1], 5, Math.max(6, Math.round(arc / 15)), arc * DEG); },
  };
  // Box with rounded corners on its y-z face (the face you see from the cockpit): an extruded rounded rectangle.
  function roundedBox(len, hgt, wid, radius) {
    const r = Math.max(0, Math.min(radius || 0, hgt / 2 - 1e-4, wid / 2 - 1e-4));
    const x0 = -wid / 2, x1 = wid / 2, y0 = -hgt / 2, y1 = hgt / 2, sh = new THREE.Shape();
    sh.moveTo(x0 + r, y0);
    sh.lineTo(x1 - r, y0); sh.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
    sh.lineTo(x1, y1 - r); sh.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
    sh.lineTo(x0 + r, y1); sh.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
    sh.lineTo(x0, y0 + r); sh.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
    return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -len / 2).rotateY(Math.PI / 2);
  }
  const resolveColor = (c, driver) =>
    c === 'body' ? driver.color : c === 'accent' ? driver.accent : c === 'dark' ? COLORS.carDark : c === 'tyre' ? COLORS.tyre
    : (parseInt(String(c).replace('#', ''), 16) || 0);

  // Design parts → one non-indexed BufferGeometry with vertex colours, positioned relative to `origin`.
  function mergeParts(parts, driver, origin = [0, 0, 0]) {
    const pos = [], nor = [], col = [], c = new THREE.Color(), o = new THREE.Object3D();
    for (const p of parts) {
      const size = p.size.map((v, i) => p.shape === 'torus' && i === 2 ? v : Math.max(0.001, Math.abs(v)));
      let g = (SHAPES[p.shape] || SHAPES.box)(size, p);
      if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
      o.position.set(p.pos[0] - origin[0], p.pos[1] - origin[1], p.pos[2] - origin[2]);
      o.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG); o.updateMatrix();
      g.applyMatrix4(o.matrix);
      const P = g.attributes.position.array, Nn = g.attributes.normal.array;
      c.setHex(resolveColor(p.color, driver));
      for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(Nn[i]); }
      for (let i = 0; i < P.length / 3; i++) col.push(c.r, c.g, c.b);
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  const wheelGeo = (r, w, driver) => mergeParts([
    { shape: 'cylinder', size: [r, w], segments: 14, pos: [0, 0, 0], rot: [90, 0, 0], color: 'tyre' },
    { shape: 'cylinder', size: [r * 0.56, w + 0.02], segments: 8, pos: [0, 0, 0], rot: [90, 0, 0], color: 'dark' },
    { shape: 'box', size: [0.08, r * 0.82, w + 0.01], pos: [0, 0, 0], rot: [0, 0, 0], color: 'accent' },
  ], driver);

  function create(scene, driver, design) {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BufferGeometry(), MATS.quality.body);
    // steering wheel assembly: mount (position/tilt/scale from car.steering) → steering mesh (turns with input)
    const mount = new THREE.Group(), steering = new THREE.Mesh(new THREE.BufferGeometry(), MATS.quality.body);
    mount.add(steering);
    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT); shadow.position.y = 0.04; shadow.renderOrder = 1;
    root.add(body, mount, shadow); scene.add(root);
    let geo = null, wheelGeos = [], pivots = [], wheels = [], fronts = [], mats = MATS.quality, cockpitView = false, lock = 0;

    function showView() {
      body.geometry = cockpitView ? geo.cockpit : geo.outside;
      steering.geometry = cockpitView ? geo.steerCockpit : geo.steerOutside;
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
    function rebuild({ parts, wheels: wheelSpecs, steering: st, screen: sc }) {
      screenSpec = sc;
      if (geo) for (const g of Object.values(geo)) g.dispose();
      for (const g of wheelGeos) g.dispose();
      for (const p of pivots) root.remove(p);
      const pick = (steer, view) => parts.filter(p => !!p.steer === steer && (p.show === 'always' || p.show === view));
      geo = {
        outside: mergeParts(pick(false, 'outside'), driver), cockpit: mergeParts(pick(false, 'cockpit'), driver),
        steerOutside: mergeParts(pick(true, 'outside'), driver), steerCockpit: mergeParts(pick(true, 'cockpit'), driver),
      };
      mount.position.set(st.pivot[0], st.pivot[1], st.pivot[2]);
      mount.rotation.set(st.rot[0] * DEG, st.rot[1] * DEG, st.rot[2] * DEG);
      mount.scale.set(...st.scale.map(k => Math.max(0.05, k)));
      lock = st.lock * DEG;
      wheelGeos = []; pivots = []; wheels = []; fronts = [];
      for (const w of wheelSpecs) {
        const g = wheelGeo(w.radius, w.width, driver), pivot = new THREE.Group(), m = new THREE.Mesh(g, mats.wheel);
        pivot.position.set(w.pos[0], w.pos[1], w.pos[2]); pivot.add(m); root.add(pivot);
        wheelGeos.push(g); pivots.push(pivot); wheels.push(m); if (w.front) fronts.push(pivot);
      }
      placeScreen(); showView();
    }
    rebuild(design);

    return {
      rebuild,
      setMaterials(set) { mats = set; body.material = steering.material = set.body; for (const w of wheels) w.material = set.wheel; },
      useCockpitView(on) { if (on !== cockpitView) { cockpitView = on; showView(); } },
      mountScreen(mesh) { screen = mesh; placeScreen(); showView(); },
      place(x, z, h) { root.position.set(x, 0, z); root.rotation.y = -h; },
      setVisible(on) { root.visible = on; },
      // copy interpolated sim state (rx/rz/rh) onto the mesh
      sync(car) {
        this.place(car.rx, car.rz, car.rh);
        for (const w of wheels) w.rotation.z = -car.roll;
        for (const p of fronts) p.rotation.y = -car.steer * FRONT_STEER;
        steering.rotation.x = car.steer * lock;          // + steer (right) turns the wheel clockwise from the driver's seat
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
