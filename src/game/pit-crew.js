// Pit crews: people in team overalls standing in front of every garage of the cars in the race, who come out when
// their car is coming in and act out its stop job by job (SIM.serviceSteps: tyres, fuel, wing, repairs):
//   tyres  front + rear jack lift the car, a gunner kneels at each wheel (gun off, gun on), a carrier takes the wheel
//          off and puts the new one on (the car's wheels really come off: CarModels setService)
//   fuel   the fuel man at the left side, nozzle in
//   wing   two mechanics at the nose fit a new front wing
//   repair two mechanics at the sidepods
// and the lollipop man in front of the car: red board while they work, green when it may go (the player then
// leaves with the gas). Back to the garage once the car is gone. People are a few boxes on a joint rig (legs with
// knees, arms, torso, helmet), posed every frame; crews far from the camera are hidden.
import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { markShadows } from './shadows.js';

export const CREW = Object.freeze({
  walk: 3.4,            // m/s
  comeOut: 140,         // m: the crew goes out when its car is this far from the box (or stopped there)
  goHome: 1.2,          // s after the car has left
  hideBeyond: 160,      // m from the camera: crew hidden
  lift: 0.07,           // m the jacks lift the car
  wheelOut: 0.8,        // m a wheel comes off sideways
  home: { z: 3.6, from: -6.5, to: 6.5 },   // the line they wait in, in front of the garage (box frame, m)
});

const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const span = (t, a, b) => ease((t - a) / (b - a));

// ---------- one person: a rig of boxes facing +x ----------
const G = {
  thigh: new THREE.BoxGeometry(0.15, 0.45, 0.16).translate(0, -0.225, 0),
  shin: new THREE.BoxGeometry(0.13, 0.45, 0.14).translate(0, -0.225, 0),
  shoe: new THREE.BoxGeometry(0.26, 0.08, 0.13).translate(0.05, -0.47, 0),
  torso: new THREE.BoxGeometry(0.25, 0.58, 0.42).translate(0, 0.29, 0),
  arm: new THREE.BoxGeometry(0.1, 0.62, 0.1).translate(0, -0.31, 0),
  hand: new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, -0.64, 0),
  head: new THREE.SphereGeometry(0.15, 12, 9),
  visor: new THREE.BoxGeometry(0.06, 0.07, 0.2),
  gun: new THREE.BoxGeometry(0.22, 0.1, 0.08).translate(0.1, -0.68, 0),
  pole: new THREE.CylinderGeometry(0.025, 0.025, 1.7, 6).translate(0, 0.85, 0),
  board: new THREE.CylinderGeometry(0.32, 0.32, 0.03, 20).rotateZ(Math.PI / 2),
  nozzle: new THREE.BoxGeometry(0.34, 0.12, 0.12).translate(0.15, -0.68, 0),
  wing: new THREE.BoxGeometry(0.45, 0.06, 1.7),
};
const DARK = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
const VISOR = new THREE.MeshLambertMaterial({ color: 0x0c0f14 });
const GUN = new THREE.MeshLambertMaterial({ color: 0xc9a227 });
const POLE = new THREE.MeshLambertMaterial({ color: 0xd0d4da });
const RED = new THREE.MeshBasicMaterial({ color: 0xe0281f }), GREEN = new THREE.MeshBasicMaterial({ color: 0x22d34a });

function person(suit, helmet) {
  const root = new THREE.Group(), hips = new THREE.Group(), torso = new THREE.Group();
  const mesh = (g, m) => new THREE.Mesh(g, m);
  const leg = z => {
    const thigh = new THREE.Group(), knee = new THREE.Group();
    thigh.position.set(0, 0, z); knee.position.y = -0.45;
    thigh.add(mesh(G.thigh, suit), knee); knee.add(mesh(G.shin, suit), mesh(G.shoe, DARK));
    hips.add(thigh); return { thigh, knee };
  };
  const arm = z => { const a = new THREE.Group(); a.position.set(0, 0.5, z); a.add(mesh(G.arm, suit), mesh(G.hand, DARK)); torso.add(a); return a; };
  const legs = [leg(-0.1), leg(0.1)];
  torso.add(mesh(G.torso, suit));
  const head = mesh(G.head, helmet); head.position.y = 0.74; const visor = mesh(G.visor, VISOR); visor.position.set(0.12, 0.74, 0);
  torso.add(head, visor);
  const arms = [arm(-0.26), arm(0.26)];
  hips.add(torso); root.add(hips);
  return { root, hips, torso, legs, arms, x: 0, z: 0, a: 0, ph: Math.random() * 6 };
}

// the person's pose: walk = stride phase (or null), kneel / crouch 0..1, reach 0..1 (arms forward), shake (gun)
function pose(p, { walking = false, kneel = 0, crouch = 0, reach = 0, shake = 0, up = 0 } = {}) {
  const s = walking ? Math.sin(p.ph) : 0, lift = (v, k) => v * (1 - k);
  p.hips.position.y = 0.94 - 0.42 * kneel - 0.36 * crouch;
  const [L, R] = p.legs;
  // kneeling on the right knee: left thigh forward, its shin down; right thigh down, its shin back along the ground
  L.thigh.rotation.z = lift(s * 0.5, kneel + crouch) + kneel * Math.PI / 2 + crouch * 1.25;
  L.knee.rotation.z = lift(Math.min(0, Math.sin(p.ph + 1.2)) * 0.8, kneel + crouch) - kneel * Math.PI / 2 - crouch * 1.9;
  R.thigh.rotation.z = lift(-s * 0.5, kneel + crouch) + crouch * 1.25;
  R.knee.rotation.z = lift(Math.min(0, Math.sin(p.ph + 1.2 + Math.PI)) * 0.8, kneel + crouch) - kneel * Math.PI / 2 - crouch * 1.9;
  p.torso.rotation.z = -(0.12 * kneel + 0.45 * crouch + 0.1 * reach);
  const jig = shake ? Math.sin(p.ph * 9) * 0.06 * shake : 0;
  p.arms[0].rotation.z = -s * 0.45 * (1 - reach) + reach * (1.25 + jig) + up * 2.6;
  p.arms[1].rotation.z = s * 0.45 * (1 - reach) + reach * (1.25 - jig) + up * 2.6;
}

// ---------- a crew for one box ----------
// wheels: the design's wheels ({ pos: [x, y, z], front }); frame: the box on the track { x, z, h }
function crew(driver, wheels, frame) {
  const suit = new THREE.MeshLambertMaterial({ color: driver.color }), helmet = new THREE.MeshLambertMaterial({ color: driver.accent ?? 0xffffff });
  const group = new THREE.Group(); group.position.set(frame.x, frame.y || 0, frame.z); group.rotation.y = -frame.h;
  const people = [], add = (role, x, z, a, extra = {}) => { const p = Object.assign(person(suit, helmet), { role, sx: x, sz: z, sa: a }, extra); people.push(p); group.add(p.root); return p; };
  const face = { left: Math.PI / 2, right: -Math.PI / 2, back: Math.PI, front: 0 };     // directions in the box frame
  wheels.forEach((w, i) => {
    const s = Math.sign(w.pos[2]) || 1, out = Math.abs(w.pos[2]);
    add('gun', w.pos[0], s * (out + 0.6), s > 0 ? face.right : face.left, { wheel: i, side: s });
    add('carry', w.pos[0] + (w.front ? 0.55 : -0.55), s * (out + 1.15), s > 0 ? face.right : face.left, { wheel: i, side: s });
  });
  const front = Math.max(...wheels.map(w => w.pos[0])), rear = Math.min(...wheels.map(w => w.pos[0]));
  // nobody stands in the car's way: the rear jack waits beside the box until the car has stopped, the front jack and
  // the wing men step aside to the garage side when their job is done, the lollipop man stands there all along
  // (wait = where they stand while the car comes in, after = once their job is done; else their station)
  add('jack', front + 1.75, 0, face.back, { after: [front + 1.6, 2.1] });
  add('jack', rear - 1.35, 0, face.front, { wait: [rear - 1.2, 2.2], after: [rear - 1.2, 2.2] });
  const lolly = add('lolly', front + 1.4, 1.75, face.back + 0.5);
  add('fuel', -0.35, -1.2, face.left, { after: [-0.35, 2.3] });
  add('wing', front + 1.5, -0.55, face.back, { wait: [front + 0.7, 2.4], after: [front + 0.7, 2.4] });
  add('wing', front + 1.5, 0.55, face.back, { wait: [front + 1.3, 2.9], after: [front + 1.3, 2.9] });
  add('repair', -0.7, -1.15, face.left); add('repair', -0.7, 1.15, face.right);
  // props: guns, the lollipop board, the fuel nozzle, a spare wing
  for (const p of people) {
    if (p.role === 'gun') p.arms[1].add(new THREE.Mesh(G.gun, GUN));
    if (p.role === 'fuel') p.arms[1].add(new THREE.Mesh(G.nozzle, GUN));
  }
  const pole = new THREE.Mesh(G.pole, POLE), board = new THREE.Mesh(G.board, RED);
  pole.position.set(0.4, 0.7, 0.25); board.position.set(0.4, 2.4, 0.25); lolly.root.add(pole, board);
  const wing = new THREE.Mesh(G.wing, new THREE.MeshLambertMaterial({ color: driver.accent ?? 0x222222 })); wing.visible = false; group.add(wing);
  people.forEach((p, k) => {                                   // waiting in a line in front of the garage
    const H = CREW.home, u = people.length > 1 ? k / (people.length - 1) : 0.5;
    p.hx = H.from + (H.to - H.from) * u; p.hz = H.z + (k % 2) * 0.5; p.x = p.hx; p.z = p.hz; p.a = face.right;
  });
  markShadows(group);
  return { driver, group, people, board, wing, frame, out: false, leftAt: -1 };
}

export function createPitCrews(scene) {
  let crews = [], wheels = [];
  const service = new Map();           // car → { lift, outs } while it is serviced (for its model)

  function frameOf(track, p) {
    const i = SIM.wrapIdx(Math.floor(p), track.N), j = (i + 1) % track.N, f = p - Math.floor(p), lat = track.pit.boxLat;
    const x = track.PX[i] + (track.PX[j] - track.PX[i]) * f, z = track.PZ[i] + (track.PZ[j] - track.PZ[i]) * f;
    const nx = track.NX[i] + (track.NX[j] - track.NX[i]) * f, nz = track.NZ[i] + (track.NZ[j] - track.NZ[i]) * f;
    return { x: x + nx * lat, z: z + nz * lat, h: Math.atan2(track.TZ[i], track.TX[i]), y: SIM.surfaceY(track, p, lat) };
  }

  // one crew's frame: who does what at stop time t (s), given the stop's steps; returns the car's lift and wheels
  function work(c, cr, P, t) {
    const steps = SIM.serviceSteps(P.service), tyres = steps[0], T = tyres.to - tyres.from, u = (t - tyres.from) / T;
    const job = steps.find(s => t >= s.from && t < s.to)?.job ?? (P.done ? 'done' : 'tyres');
    const lift = CREW.lift * (span(u, 0, 0.08) - span(u, 0.9, 1));
    const off = CREW.wheelOut * (span(u, 0.3, 0.46) - span(u, 0.54, 0.72));
    const gunning = (u > 0.08 && u < 0.28) || (u > 0.72 && u < 0.88);
    const wingJob = steps.find(s => s.job === 'wing'), fuelJob = steps.find(s => s.job === 'fuel');
    for (const p of cr.people) {
      const o = { kneel: 0, crouch: 0, reach: 0, shake: 0, up: 0 };
      // who has finished: they step out of the way (p.done → `after`)
      p.done = p.role === 'jack' ? u >= 1 : p.role === 'wing' ? !wingJob || t >= wingJob.to : p.role === 'fuel' ? !fuelJob || t >= fuelJob.to : P.done;
      p.busy = p.role !== 'wing' || (wingJob && t >= wingJob.from && t < wingJob.to);
      if (p.role === 'gun') { o.kneel = 1; o.reach = 0.9; o.shake = gunning ? 1 : 0; }
      if (p.role === 'carry') { o.crouch = 0.5; o.reach = u > 0.25 && u < 0.78 ? 1 : 0.3; p.carryOut = off; }
      if (p.role === 'jack') { o.crouch = p.done ? 0 : 0.9; o.reach = p.done ? 0 : 1; }
      if (p.role === 'fuel') { o.reach = job === 'fuel' ? 1 : 0.1; }
      if (p.role === 'wing') { o.kneel = job === 'wing' ? 1 : 0; o.reach = job === 'wing' ? 1 : 0; }
      if (p.role === 'repair') { o.crouch = job === 'repair' ? 1 : 0.2; o.reach = job === 'repair' ? 1 : 0; o.shake = job === 'repair' ? 0.5 : 0; }
      if (p.role === 'lolly') { o.reach = 0.5; }
      p.work = o;
    }
    // the spare wing goes onto the nose during its job
    const w = steps.find(s => s.job === 'wing');
    cr.wing.visible = !!w && t >= w.from && t < w.to;
    if (cr.wing.visible) { const v = (t - w.from) / (w.to - w.from), front = Math.max(...wheels.map(q => q.pos[0])); cr.wing.position.set(front + 1.25 - 0.3 * span(v, 0.1, 0.6), 0.18 + 0.2 * (1 - span(v, 0.1, 0.6)), 0); }
    const outs = wheels.map((_, i) => (cr.people.find(p => p.role === 'carry' && p.wheel === i)?.carryOut ?? 0));
    service.set(c, { lift, outs });
  }

  return {
    // a crew for every car in the race at its own box (rebuilt for each race)
    build(race, design) {
      this.dispose();
      const track = race.track; if (!track.pit) return;
      wheels = design.wheels;
      for (const c of race.cars) {
        const k = SIM.DRIVERS.findIndex(d => d.code === c.code); if (k < 0) continue;
        const cr = crew(c, wheels, frameOf(track, track.pit.boxes[k]));     // the car carries its team's (or your livery's) colours
        cr.car = c; scene.add(cr.group); crews.push(cr);
      }
    },
    // { lift, outs[] } for the car's model while it is in its box, else null
    serviceOf(c) { return service.get(c) ?? null; },
    update(race, dt, cam) {
      service.clear();
      for (const cr of crews) {
        const c = cr.car, P = c.pit, ds = race.track.ds;
        const near = P && (P.phase === 'stop' || (P.phase === 'in' && (!P.drive || P.request) && (P.box - P.p) * ds < CREW.comeOut) || (P.phase === 'out' && (P.p - P.box) * ds < 6));
        if (near) { cr.out = true; cr.leftAt = -1; } else if (cr.out) { if (cr.leftAt < 0) cr.leftAt = race.t; if (race.t - cr.leftAt > CREW.goHome) cr.out = false; }
        const far = Math.hypot(cam.x - cr.frame.x, cam.z - cr.frame.z) > CREW.hideBeyond;
        cr.group.visible = !far;
        const stopped = P && P.phase === 'stop';
        if (stopped) work(c, cr, P, race.t - P.at); else { for (const p of cr.people) { p.work = null; p.carryOut = 0; p.done = !!P && P.phase === 'out'; p.busy = false; } cr.wing.visible = false; }
        cr.board.material = stopped && P.done ? GREEN : RED;
        if (far) continue;
        for (const p of cr.people) {
          // walk to the station (or home), then face the work
          const spot = !cr.out ? [p.hx, p.hz] : !stopped && !p.done ? p.wait : p.done || (p.role === 'wing' && !p.busy) ? p.after : null;
          const tx = spot ? spot[0] : p.sx, tz = spot ? spot[1] : p.sz + (p.carryOut || 0) * (p.side || 0);
          const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = Math.min(d, (p.carryOut !== undefined && stopped ? 2.5 : CREW.walk) * dt);
          const walking = d > 0.06 && !(stopped && p.role === 'carry');
          if (d > 1e-3) { p.x += dx / d * step; p.z += dz / d * step; }
          const want = walking && d > 0.3 ? Math.atan2(dz, dx) : cr.out && !spot ? p.sa : cr.out ? Math.PI * 0.75 : -Math.PI / 2;
          p.a += SIM.wrapA(want - p.a) * Math.min(1, dt * 8);
          if (walking) p.ph += dt * 9;
          p.root.position.set(p.x, 0, p.z); p.root.rotation.y = -p.a;
          pose(p, walking ? { walking: true } : cr.out && p.work && !spot ? p.work : { reach: p.role === 'lolly' ? 0.5 : 0 });
          if (p.work?.shake) p.ph += dt * 3;                       // the gun / tool jiggles
        }
      }
    },
    dispose() {
      for (const cr of crews) { scene.remove(cr.group); cr.group.traverse(o => { if (o.material && o.material !== DARK && o.material !== VISOR && o.material !== GUN && o.material !== POLE && o.material !== RED && o.material !== GREEN) o.material.dispose?.(); }); }
      crews = []; service.clear();
    },
  };
}
