// Development showroom: one car from six angles (npm run car-shot, or open /tools/showroom/ on the dev server).
// ?driver=VOS picks the livery, ?brake=0 turns the brake lights off, ?part=name shows only parts whose name matches,
// ?eye=back,height moves the cockpit camera, ?wheel=y sets the steering wheel height, ?cockpit=1 shows only the cockpit view.
import * as THREE from 'three';
import { SIM } from '../../src/sim/index.js';
import { CarModels } from '../../src/game/car-models.js';
import { DESIGN_DEFAULTS } from '../../src/game/design-defaults.js';
import { CONFIG, COLORS } from '../../src/game/config.js';

const q = new URLSearchParams(location.search);
const driver = SIM.DRIVERS.find(d => d.code === (q.get('driver') || 'VOS')) || SIM.DRIVERS[0];
const design = JSON.parse(JSON.stringify(DESIGN_DEFAULTS.car));
for (const p of design.parts) { p.rot = p.rot || [0, 0, 0]; p.show = p.show || 'always'; }
if (q.get('wheel')) design.steering.pivot[1] = +q.get('wheel');
const cockpitCam = DESIGN_DEFAULTS.cameras.find(c => c.id === 'cockpit');
const [eyeBack, eyeH] = q.get('eye') ? q.get('eye').split(',').map(Number) : [cockpitCam.back, cockpitCam.height];
if (q.get('part')) design.parts = design.parts.filter(p => p.name.includes(q.get('part')));

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false); renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.sky);
scene.add(new THREE.HemisphereLight(0xe2efff, 0x47662f, 0.8));
const sun = new THREE.DirectionalLight(0xfff0d4, 0.95); sun.position.set(-300, 500, 250); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: COLORS.asphalt[0] }));
scene.add(ground);
const model = CarModels.create(scene, driver, design);
const brake = q.get('brake') === '0' ? 0 : 1, steer = q.get('steer') ? +q.get('steer') : 0.25;
const pose = () => { model.setPedals(1 - brake, brake); for (let i = 0; i < 30; i++) model.sync({ roll: 0.6, steer, brake }, { x: 0, z: 0, h: 0 }, 1 / 30); };
pose();

// car space: +x forward, +z right; the car sits at the origin facing +x
const views = [
  ['front 3/4', [5.2, 2.0, 3.8], [0.4, 0.4, 0]], ['rear 3/4 (braking)', [-5.4, 2.0, -3.6], [-0.4, 0.5, 0]], ['side', [0, 0.9, 7.5], [0.3, 0.5, 0]],
  ['top', [0.2, 9, 0.01], [0.2, 0, 0]], ['front', [7, 0.8, 0], [0, 0.45, 0]], ['cockpit', [-eyeBack, eyeH, 0], [30, 0.8, 0]],
  ['driver (cockpit parts, from the side)', [0.2, 1.6, 3.2], [0.1, 0.5, 0]],
];
const only = q.get('cockpit') ? views.filter(v => v[0].startsWith('cockpit') || v[0].startsWith('driver')) : views.slice(0, 6);
const cols = only.length > 2 ? 3 : only.length, W = innerWidth / cols, H = innerHeight / (only.length > 3 ? 2 : 1);
only.forEach(([name, eye, at], i) => {
  const cam = new THREE.PerspectiveCamera(name === 'cockpit' ? 56 : 32, W / H, name === 'cockpit' ? 0.12 : 0.1, 200);
  model.useCockpitView(name === 'cockpit' || name.startsWith('driver')); pose();
  cam.position.set(...eye); cam.lookAt(...at);
  if (name === 'cockpit') { cam.near = cockpitCam.near; cam.fov = cockpitCam.fov; cam.updateProjectionMatrix(); cam.lookAt(-eyeBack + cockpitCam.ahead, cockpitCam.lookY, 0); }
  const x = (i % cols) * W, y = innerHeight - (Math.floor(i / cols) + 1) * H;
  renderer.setViewport(x, y, W, H); renderer.setScissor(x, y, W, H);
  renderer.render(scene, cam);
  const s = document.createElement('span'); s.textContent = name; document.getElementById('lbl').append(s);
});
const lbl = document.getElementById('lbl').style;
lbl.setProperty('--cols', `repeat(${cols}, 1fr)`); lbl.setProperty('--rows', `repeat(${only.length > 3 ? 2 : 1}, 1fr)`);
document.title = 'ready';
