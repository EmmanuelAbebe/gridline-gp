# Gridline GP's electric car (GP ELECTRIC, car class 'fe') from "Formula E [Jaguar I Type-4]" by 3dblenderlol
# (CC-BY-4.0, see CREDITS.md): tools/blender/run.sh fe stage=build [src=<scene.gltf>, default ~/Downloads/fe-jaguar-gen2/
# scene.gltf] [preview=dir] [ao=0]   (stage=probe: lists the model's parts, used to work out the build below)
# The download is 59 meshes in Blender's frame after import (Z up, the car along Y, its nose toward −Y), a Gen2 car in a
# real team's colours with the logos as separate meshes; this puts it in the game frame (kit.G: x forward, y up, z right,
# metres, origin on the ground under the middle of the wheelbase), drops the logos, gives every part a role, cuts it down
# and splits out what the game moves (the same names and roles as qvist.py's car.glb: car-glb.js drives both).
import bpy, bmesh, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import args, G, export
from mathutils import Vector, Matrix

A = args()
SRC = A.get('src', os.path.expanduser('~/Downloads/fe-jaguar-gen2/scene.gltf')); PREVIEW = A.get('preview')
OUT = A.get('out', 'src/game/models/fe.glb'); STAGE = os.path.basename(A.get('stage', 'probe'))

def load():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=SRC)
  sc = bpy.context.scene
  for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
  # every mesh's transform applied, no parents: each object's data is in Blender world space
  for o in sc.objects: o.select_set(o.type == 'MESH')
  bpy.context.view_layer.objects.active = next(o for o in sc.objects if o.type == 'MESH')
  bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
  for o in list(sc.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
  for o in sc.objects: o.select_set(True)
  bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
  return [o for o in sc.objects if o.type == 'MESH']

def wbox(o):
  vs = [v.co for v in o.data.vertices]
  return Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])

if not os.path.exists(SRC):
  print(f'fe: {SRC} not found; download the model (CREDITS.md) and pass src=<its scene.gltf>; fe.glb left as it is'); sys.exit(0)
parts = load()
if STAGE == 'probe':
  rows = []
  for o in parts:
    lo, hi = wbox(o); c = (lo + hi) / 2; s = hi - lo
    rows.append((o.name, len(o.data.polygons), [m.name for m in o.data.materials], tuple(round(v, 3) for v in c), tuple(round(v, 3) for v in s)))
  for r in sorted(rows, key=lambda r: r[3][1]): print('PART', *r)
if STAGE == 'mats':
  for m in sorted({m for o in parts for m in o.data.materials if m}, key=lambda m: m.name):
    b = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
    col = tuple(round(c, 3) for c in b.inputs['Base Color'].default_value[:3]) if b else None
    tex = [n.image.name for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image] if m.node_tree else []
    users = [(o.name, len(o.data.polygons)) for o in parts if m.name in [x.name for x in o.data.materials if x]]
    print('MAT', m.name, col, 'metal', round(b.inputs['Metallic'].default_value, 2) if b else None, 'tex', tex, users[:6])

# ---------------------------------------------------------------- the build: the game's fe.glb
import numpy as np, time
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

# model → game: wheelbase 3.25 → the class's 2.97 m (FE_GEN3_EVO car.wheelbase; width 1.90 → 1.74 m, the real Gen3 Evo
# 1.70), the nose (−Y) forward, the axle centre line X = −0.914, the tyres' bottom Z = −0.502 on the ground; Blender
# coordinates of the game frame are G(x, y, z) = (x, −z, y)
S, MID_Y, MID_X, GROUND = 2.97 / 3.25, 0.333, -0.914, -0.502
M = Matrix(((0, -S, 0, S * MID_Y), (S, 0, 0, -S * MID_X), (0, 0, S, -S * GROUND), (0, 0, 0, 1)))
AX = 1.485                                          # the axles at ±AX m (half the wheelbase)
# the cockpit: the model's steering wheel centre is at (0.519, 0.558) in the game frame; the F1's (qvist.py STEER) is
# (0.66, 0.58). The driver (driver.glb) is posed in the F1's frame, so `driver_at` moves it by the difference, and the
# eye, the wheel and the grips go the same way
F1_EYE, F1_STEER = (0.08, 0.72, 0.0), (0.66, 0.58, 0.0)
STEER = (0.519, 0.558, 0.0)
SHIFT = tuple(a - b for a, b in zip(STEER, F1_STEER))
EYE = tuple(a + b for a, b in zip(F1_EYE, SHIFT))

ROLES = ['paint_main', 'paint_accent', 'carbon', 'rubber', 'metal', 'light', 'glass', 'dark']
COLOURS = {'paint_main': (0.05, 0.16, 0.55), 'paint_accent': (1.0, 0.72, 0.05), 'carbon': (0.035, 0.035, 0.04), 'rubber': (0.02, 0.02, 0.022),
           'metal': (0.55, 0.56, 0.58), 'light': (0.5, 0.03, 0.02), 'glass': (0.2, 0.25, 0.3), 'dark': (0.01, 0.01, 0.012)}
# the download's materials → roles; None = left out (the team's and sponsors' logos, a stray cube in the nose, the
# model's own steering wheel: the driver brings one, driver.glb)
MAT_ROLE = {'Material.006': 'paint_main', 'Sidepod_Material': 'paint_main', 'Material.011': 'paint_main', 'Material.009': 'paint_main',
            'Material.014': 'paint_main', 'Material.010': 'paint_main', 'Material.004': 'paint_main', 'Material.012': 'paint_main',
            'Material.005': 'paint_accent', 'Carbon_Fibre': 'carbon', 'Material.008': 'carbon', 'suspention': 'carbon',
            'Tyres': 'rubber', 'BrakeDisk_Mat': 'metal', 'BrakeDisk_Mat2': 'dark', 'Mirror': 'glass', 'Material': 'light',
            'Jaguar': None, 'Formulae': None, 'julius_baer': None, 'panasonic-logo-black-and-white-1': None, 'Panasonic': None,
            'material': None, 'material_0': None, 'Material.001': None, 'Material.002': None, 'Material.003': None}
# objects whose material alone doesn't say it: the nose's front piece is "Halo" in the download, the real halo too;
# the rear light's surround; the logo plate on the nose (Halo + Formulae); the model's steering wheel rim (Carbon_Fibre)
OBJ_ROLE = {'Object_13': 'paint_main', 'Object_19': 'carbon', 'Object_79': 'dark', 'Object_66': None, 'Object_53': None}

def role_mats(o):
  o.data.materials.clear()
  for r in ROLES:
    m = bpy.data.materials.get(r)
    if not m:
      m = bpy.data.materials.new(r); m.use_nodes = True
      b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*COLOURS[r], 1)
      b.inputs['Roughness'].default_value = 0.35 if r.startswith('paint') else 0.75
    o.data.materials.append(m)

def set_role(o, roles):
  """roles: one role name, or an array of them per face"""
  role_mats(o); n = len(o.data.polygons)
  r = np.full(n, roles) if isinstance(roles, str) else np.asarray(roles)
  idx = np.zeros(n, dtype=np.int32)
  for i, x in enumerate(ROLES): idx[r == x] = i
  o.data.polygons.foreach_set('material_index', idx); o.data.update()

def centres(o):
  """every face's centre in the game frame: arrays x, y, z"""
  n = len(o.data.polygons); c = np.empty(n * 3); o.data.polygons.foreach_get('center', c); c = c.reshape(n, 3)
  return c[:, 0], c[:, 2], -c[:, 1]

def decimate(o, ratio):
  """collapse to `ratio` of the faces; the vertices where two roles meet (and open edges) keep their detail, so a colour
  border stays a clean line (as qvist.py's keep_borders)"""
  if ratio >= 1 or not len(o.data.polygons): return
  # (the download's parts are often loose triangles: welded first, else every edge is an open border and stays)
  bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD); bm.to_mesh(o.data); bm.free()
  n0 = len(o.data.polygons)
  me = o.data; nv, nl, nf, ne = len(me.vertices), len(me.loops), len(me.polygons), len(me.edges)
  lv = np.empty(nl, dtype=np.int64); me.loops.foreach_get('vertex_index', lv)
  le = np.empty(nl, dtype=np.int64); me.loops.foreach_get('edge_index', le)
  tot = np.empty(nf, dtype=np.int64); me.polygons.foreach_get('loop_total', tot)
  mi = np.empty(nf, dtype=np.int64); me.polygons.foreach_get('material_index', mi)
  lm = np.repeat(mi, tot); lo = np.full(nv, 99); hi = np.full(nv, -1); np.minimum.at(lo, lv, lm); np.maximum.at(hi, lv, lm)
  open_e = np.flatnonzero(np.bincount(le, minlength=ne) == 1)
  ev = np.empty(ne * 2, dtype=np.int64); me.edges.foreach_get('vertices', ev); ev = ev.reshape(ne, 2)
  border = np.zeros(nv, bool); border[lo != hi] = True; border[ev[open_e].ravel()] = True
  g = o.vertex_groups.new(name='free'); g.add(np.flatnonzero(~border).tolist(), 1.0, 'REPLACE')
  m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True; m.vertex_group = 'free'
  bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
  log('decimate', o.name, n0, '→', len(o.data.polygons), f'(asked {ratio}, {int(border.sum())} of {nv} vertices on borders)')

def split_mask(src, name, mask):
  """the faces where mask (a bool array over src's faces) is set, moved into a new object (materials kept)"""
  if not mask.any(): return None
  me2 = src.data.copy(); me2.name = name
  for keep_in, me in ((False, src.data), (True, me2)):
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if bool(mask[f.index]) != keep_in], context='FACES')
    bm.to_mesh(me); bm.free(); me.update()
  o = bpy.data.objects.new(name, me2); bpy.context.scene.collection.objects.link(o)
  return o

def join_into(dst, srcs):
  srcs = [q for q in srcs if q is not dst]
  if not srcs: return dst
  bpy.ops.object.select_all(action='DESELECT')
  for q in srcs: q.select_set(True)
  dst.select_set(True); bpy.context.view_layer.objects.active = dst; bpy.ops.object.join(); return dst

def finish(o, sharp=35):
  me = o.data
  me.polygons.foreach_set('use_smooth', [True] * len(me.polygons)); me.set_sharp_from_angle(angle=math.radians(sharp))
  if 'Col' not in me.color_attributes:
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); col.data.foreach_set('color', [1.0] * (len(col.data) * 4))
  me.color_attributes.active_color = me.color_attributes['Col']

def origin_to(o, at):
  p = G(*at); o.data.transform(Matrix.Translation(-p)); o.location = p

def empty(name, at, parent=None, **extras):
  e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); e.empty_display_size = 0.05
  if parent: e.parent = parent; e.location = G(*at) - parent.location
  else: e.location = G(*at)
  for k, v in extras.items(): e[k] = v
  return e

def build():
  log('frame'); kept = []
  for o in parts:
    role = OBJ_ROLE.get(o.name, MAT_ROLE.get(o.data.materials[0].name if o.data.materials else '', 'paint_main'))
    if role is None: bpy.data.objects.remove(o, do_unlink=True); continue
    o.data.transform(M); o.data.update(); o['role'] = role; kept.append(o)
  names = {o.name: o['role'] for o in kept}
  alive = lambda role: next(bpy.data.objects[n] for n, r in names.items() if r == role and n in bpy.data.objects)   # (by name: joined parts are gone)
  # the wheels: a tyre (rubber out past the rim, metal inside) with its brake disc and caliper, round an axle node
  tyres = [o for o in kept if o['role'] == 'rubber']; brakes = [o for o in kept if o.data.materials[0].name.startswith('BrakeDisk')]
  wheels = []
  for t in tyres:
    x, y, z = centres(t); c = (float((x.max() + x.min()) / 2), float((y.max() + y.min()) / 2), float((z.max() + z.min()) / 2))
    n = ('f' if c[0] > 0 else 'r') + ('r' if c[2] > 0 else 'l')
    rad = np.hypot(x - c[0], y - c[1]); log('tyre', n, 'centre', [round(v, 3) for v in c], 'radius', round(float(rad.max()), 3))
    near = [b for b in brakes if abs(centres(b)[0].mean() - c[0]) < 0.3 and np.sign(centres(b)[2].mean()) == np.sign(c[2])]
    for b in near: set_role(b, b['role']); decimate(b, 0.06); brakes.remove(b)    # (joined into this wheel below)
    set_role(t, np.where(rad > RIM * rad.max(), 'rubber', 'metal')); decimate(t, 0.3)
    w = join_into(t, near); w.name = f'tyre_{n}'
    hub = empty(f'wheel_{n}', c, front=n[0] == 'f'); w.parent = hub; w.location = w.location - hub.location
    wheels.append(hub)
  # the mirrors' glass: one quad each side (the download's "Mirror": both sides in one object)
  glass = alive('glass')
  for s, n in ((-1, 'l'), (1, 'r')):
    x, y, z = centres(glass); g = split_mask(glass, f'mirror_glass_{n}', z * s > 0)
    if g:
      gx, gy, gz = centres(g); origin_to(g, (float(gx.mean()), float(gy.mean()), float(gz.mean()))); set_role(g, 'glass')
  if glass.name in bpy.data.objects and not len(glass.data.polygons): bpy.data.objects.remove(glass, do_unlink=True)
  light = alive('light'); light.name = 'rain_light'; set_role(light, 'light'); decimate(light, 0.2)
  # the body: everything else, its role per part, cut down
  # (by name: the parts joined into the wheels no longer exist)
  body_parts = [bpy.data.objects[n] for n, r in names.items() if n in bpy.data.objects and r not in ('rubber', 'glass', 'light')
                and not n.startswith(('tyre_', 'mirror_glass_', 'rain_light'))]
  for o in body_parts:
    set_role(o, o['role']); decimate(o, BODY_RATIO.get(o.name, 0.25))
  body = max(body_parts, key=lambda o: len(o.data.polygons)); join_into(body, body_parts); body.name = 'body'; body.data.name = 'body'
  bm = bmesh.new(); bm.from_mesh(body.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003); bm.to_mesh(body.data); bm.free()
  # the front wing's halves (fw_main_l / _r: SIM wingOff hides one and throws a copy down the road): ahead of the front
  # tyres, low, beside the nose
  for s, n in ((-1, 'l'), (1, 'r')):
    x, y, z = centres(body)
    q = split_mask(body, f'fw_main_{n}', (x > AX + 0.36) & (y < 0.30) & (z * s > 0.16))
    if q: q['side'] = s
  # the cockpit's anchors (car-glb.js): the eye, the seat, the steering wheel and its grips / screen, where the driver goes
  empty('eye', EYE); empty('seat', (-0.25 + SHIFT[0], 0.30 + SHIFT[1], 0)); empty('driver_at', SHIFT)
  st = empty('steer', STEER)
  for n, zz in (('l', -0.135), ('r', 0.135)): empty(f'grip_{n}', (STEER[0], STEER[1], zz), parent=st)
  empty('screen', (STEER[0] - 0.031, STEER[1] + 0.017, 0), parent=st)
  meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
  for o in meshes: finish(o)
  return meshes

WELD = 0.0002                 # m: vertices this close are one (before cutting down)
RIM = 0.70                    # tyre faces nearer the axle than this share of the tyre's radius are the rim (metal)
BODY_RATIO = {'Object_21': 0.12, 'Object_10': 0.18, 'Object_11': 0.18, 'Object_13': 0.25, 'Object_35': 0.2, 'Object_36': 0.2, 'Object_26': 0.3}

def render(tag, views):
  for m in bpy.data.materials:   # the role colours × the baked AO, for the renders
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF') if nt else None
    if not b or nt.nodes.get('ao'): continue
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'; va.name = 'ao'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    mix.inputs[6].default_value = b.inputs['Base Color'].default_value[:]
    nt.links.new(va.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
  sc = bpy.context.scene
  bpy.ops.mesh.primitive_plane_add(size=60)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), 0, math.radians(30)); sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 40; sc.cycles.device = 'CPU'; sc.render.resolution_x, sc.render.resolution_y = 1400, 760
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
  os.makedirs(PREVIEW, exist_ok=True)
  for name, eye, look in views:
    cam.location = G(*eye); d = G(*look) - G(*eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'{tag}-{name}.png'); bpy.ops.render.render(write_still=True)

if STAGE == 'build':
  meshes = build()
  if os.path.basename(A.get('ao', '1')) != '0':
    from kit import bake_ao
    log('ambient occlusion'); bake_ao(meshes, (), distance=0.6, samples=24, strength=0.7)
  tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
  for o in meshes: log('mesh', o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
  print('fe:', len(meshes), 'meshes', tris, 'triangles')
  log('export'); export(OUT, extras=True, copyright='Based on "Formula E [Jaguar I Type-4]" by 3dblenderlol (sketchfab.com/3dblenderlol), CC-BY-4.0; changed for Gridline GP (see CREDITS.md)')
  if PREVIEW:
    render('built', (('front34', (4.8, 1.8, 3.3), (0.2, 0.35, 0)), ('side', (0, 0.9, 7.8), (0, 0.45, 0)), ('rear34', (-5.0, 2.0, -3.1), (-0.3, 0.4, 0)),
                     ('top', (0.01, 7.5, 0), (0, 0, 0)), ('cockpit', (-0.6, 1.4, 0.0), (0.6, 0.5, 0)), ('fwheel', (2.4, 0.7, 1.7), (1.5, 0.3, 0.8))))
