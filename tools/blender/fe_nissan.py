# Gridline GP's electric car (GP ELECTRIC, car class 'fe') from "Formula E Nissan Gen2 2019/2020 Lowpoly" by CLeN
# (CC-BY-4.0, see CREDITS.md): tools/blender/run.sh fe_nissan out=src/game/models/fe.glb stage=build [preview=dir]
#   [src=<scene.gltf>, default ~/Downloads/fe-nissan-gen2/scene.gltf] [ao=0]
# (2026-11-16, user: the Jaguar build (fe.py) "going in the wrong direction", try the easier model: 13k triangles in 7
# clean parts.) The download, after import (Blender frame, Z up, the nose toward −Y): UpperBody (body, cockpit surround,
# rear wing), LowerBody (floor + sidepods, front wing + endplates), Tyre / Tyre001 (an axle's two wheels each: tyre, rim,
# brake), RayonFront / RayonBack (the suspension arms), Mirrors_Extensions (the T-camera pod, mirrors, their stalks).
# Its colours are a real team's livery in a texture; nothing of it is kept but which faces are red (→ the accent), which
# glow red (→ the rain light) or cyan (→ the halo's LEDs). Same names and roles as fe.py / qvist.py: car-glb.js drives it.
import bpy, bmesh, sys, os, math, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import args, G, export
from mathutils import Vector, Matrix

A = args()
SRC = A.get('src', os.path.expanduser('~/Downloads/fe-nissan-gen2/scene.gltf')); PREVIEW = A.get('preview')
OUT = A.get('out', 'src/game/models/fe.glb'); STAGE = os.path.basename(A.get('stage', 'build'))
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

# model → game frame. Wheelbase 3.354 (axles at Y −2.384 / 0.970) → the class's 2.97 m (FE_GEN3_EVO car.wheelbase);
# across, its 2.153 m (wider than the real Gen2's 1.80 for that wheelbase) → 1.80 m; the tyres' bottom (Z −0.2637) on the
# ground. Blender coordinates of the game frame are G(x, y, z) = (x, −z, y): game x = −S (Y − MID), z = −W X, y = S (Z − GROUND)
S, W, MID, GROUND = 2.97 / 3.354, 1.80 / 2.153, -0.707, -0.2637
M = Matrix(((0, -S, 0, S * MID), (W, 0, 0, 0), (0, 0, S, -S * GROUND), (0, 0, 0, 1)))
AX = 1.485

ROLES = ['paint_main', 'paint_accent', 'carbon', 'rubber', 'metal', 'light', 'glass', 'dark', 'halo']
COLOURS = {'paint_main': (0.05, 0.16, 0.55), 'paint_accent': (1.0, 0.72, 0.05), 'carbon': (0.035, 0.035, 0.04), 'rubber': (0.02, 0.02, 0.022),
           'metal': (0.55, 0.56, 0.58), 'light': (0.5, 0.03, 0.02), 'glass': (0.2, 0.25, 0.3), 'dark': (0.01, 0.01, 0.012), 'halo': (0.1, 0.45, 1.0)}
RIM = 0.70          # tyre faces nearer the axle than this share of the tyre's radius are the rim

def load():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=SRC)
  sc = bpy.context.scene
  for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
  for o in sc.objects: o.select_set(o.type == 'MESH')
  bpy.context.view_layer.objects.active = next(o for o in sc.objects if o.type == 'MESH')
  bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
  for o in list(sc.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
  for o in sc.objects: o.select_set(True)
  bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
  return {o.name.split('_')[0]: o for o in sc.objects if o.type == 'MESH'}

def image_px(mat, kind):
  """the material's texture of that kind ('baseColor' / 'emissive') as a float array [h, w, 3], row 0 = v 0"""
  for n in mat.node_tree.nodes:
    if n.type == 'TEX_IMAGE' and n.image and kind in n.image.name:
      im = n.image; w, h = im.size; a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a)
      return a.reshape(h, w, 4)[:, :, :3]
  return None

def face_samples(o, img):
  """per face: the texture's mean colour and its brightest-red / brightest-cyan sample over a grid of points in the face's UV
  polygon (fan triangles × 15 barycentric points)"""
  me = o.data; uv = me.uv_layers[0].data; h, w = img.shape[:2]
  bary = np.array([(a, b, 1 - a - b) for a in np.linspace(0.05, 0.9, 5) for b in np.linspace(0.05, 0.9, 5) if a + b <= 0.95])
  mean, red, cyan = np.zeros((len(me.polygons), 3)), np.zeros(len(me.polygons)), np.zeros(len(me.polygons))
  for p in me.polygons:
    ls = [uv[i].uv[:] for i in p.loop_indices]; pts = []
    for k in range(1, len(ls) - 1):
      tri = np.array([ls[0], ls[k], ls[k + 1]]); pts.append(bary @ tri)
    pts = np.concatenate(pts); px = np.clip((pts[:, 0] % 1) * w, 0, w - 1).astype(int); py = np.clip((pts[:, 1] % 1) * h, 0, h - 1).astype(int)
    c = img[py, px]; mean[p.index] = c.mean(0)
    red[p.index] = (c[:, 0] - np.maximum(c[:, 1], c[:, 2])).max(); cyan[p.index] = (np.minimum(c[:, 1], c[:, 2]) - c[:, 0]).max()
  return mean, red, cyan

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
  role_mats(o); n = len(o.data.polygons)
  r = np.full(n, roles) if isinstance(roles, str) else np.asarray(roles)
  idx = np.zeros(n, dtype=np.int32)
  for i, x in enumerate(ROLES): idx[r == x] = i
  o.data.polygons.foreach_set('material_index', idx); o.data.update()

def centres(o):
  n = len(o.data.polygons); c = np.empty(n * 3); o.data.polygons.foreach_get('center', c); c = c.reshape(n, 3)
  return c[:, 0], c[:, 2], -c[:, 1]

def normals(o):
  n = len(o.data.polygons); c = np.empty(n * 3); o.data.polygons.foreach_get('normal', c); c = c.reshape(n, 3)
  return c[:, 0], c[:, 2], -c[:, 1]

def islands(o):
  """per face: the index of its connected piece (faces sharing a vertex position within 10 µm; the mesh isn't changed)"""
  me = o.data; co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co)
  _, key = np.unique(np.round(co.reshape(-1, 3) * 1e5).astype(np.int64), axis=0, return_inverse=True); key = key.ravel()
  par = list(range(len(me.polygons)))
  def root(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
  owner = {}
  for p in me.polygons:
    for v in p.vertices:
      k = key[v]
      if k in owner: par[root(p.index)] = root(owner[k])
      else: owner[k] = p.index
  return np.array([root(i) for i in range(len(par))])

def split_mask(src, name, mask):
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

def finish(o, sharp):
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

# the cockpit: the driver (driver.glb) is posed in the F1's frame (qvist.py: wheel centre STEER (0.66, 0.58), eye (0.08,
# 0.72)); `driver_at` moves it by the difference, the eye, wheel and grips go the same way
F1_EYE, F1_STEER = (0.08, 0.72, 0.0), (0.66, 0.58, 0.0)
STEER = tuple(float(v) for v in os.path.basename(A.get('steer', '0.45,0.56')).split(',')) + (0.0,)
SHIFT = tuple(a - b for a, b in zip(STEER, F1_STEER))
EYE = tuple(a + b for a, b in zip(F1_EYE, SHIFT))
SHARP = float(os.path.basename(A.get('sharp', '40')))

def build(p):
  for o in p.values(): o.data.transform(M); o.data.update()
  # texture-led roles of the body's faces, read before anything is cut apart (the UVs go with the faces)
  body_roles = {}
  for k in ('UpperBody', 'LowerBody'):
    o = p[k]; mat = o.data.materials[0]
    base = image_px(mat, 'baseColor'); emi = image_px(mat, 'emissive')
    mean, red, _ = face_samples(o, base)
    r = np.where((mean[:, 0] > 0.35) & (mean[:, 0] > 2.0 * mean[:, 1]), 'paint_accent', 'paint_main').astype(object)
    if emi is not None:
      _, ered, ecyan = face_samples(o, emi)
      r[ered > 0.25] = 'light'; r[ecyan > 0.12] = 'halo'
    body_roles[k] = r
    log(k, {x: int((r == x).sum()) for x in set(r)})
  # the texture's red is the real team's (asymmetric) pattern: the accent goes on the wings instead (front wing + its
  # endplates, the rear wing); the floor (LowerBody's faces turned down, low) carbon
  for k in ('UpperBody', 'LowerBody'):
    o = p[k]; r = body_roles[k]; r[r == 'paint_accent'] = 'paint_main'
    lab = islands(o); x, y, z = centres(o)
    for i in set(lab):
      m = lab == i; cx, cy, wz = x[m].mean(), y[m].mean(), z[m].max() - z[m].min()
      if (cx > AX + 0.4 and cy < 0.25) or (cx < -AX + 0.3 and cy > 0.45 and wz > 1.2): r[m & (r == 'paint_main')] = 'paint_accent'
  lb = p['LowerBody']; _, ny, _ = normals(lb); _, cy, _ = centres(lb)
  body_roles['LowerBody'][(ny < -0.5) & (cy < 0.12)] = 'carbon'
  if A.get('profile'):     # the centre line's surfaces (|z| < 4 cm), every 5 cm along: to place the cockpit
    xs, ys, zs = [], [], []
    for k in ('UpperBody', 'LowerBody'):
      x, y, z = centres(p[k]); m = np.abs(z) < 0.04; xs += list(x[m]); ys += list(y[m])
    xs, ys = np.array(xs), np.array(ys)
    for a in np.arange(-0.8, 1.6, 0.05):
      m = (xs >= a) & (xs < a + 0.05); print('PROFILE', round(a, 2), sorted(np.round(ys[m], 2).tolist()))
  for k in ('UpperBody', 'LowerBody'): set_role(p[k], body_roles[k].astype(str))
  # the wheels: Tyre (rear axle) / Tyre001 (front), each split left / right; rubber out past the rim, metal inside
  for k in ('Tyre', 'Tyre001'):
    t = p[k]
    for s, side in ((-1, 'l'), (1, 'r')):
      x, y, z = centres(t); w = split_mask(t, 'w', z * s > 0)
      vy = np.empty(len(w.data.vertices) * 3); w.data.vertices.foreach_get('co', vy); drop = float(vy.reshape(-1, 3)[:, 2].min())
      w.data.transform(Matrix.Translation((0, 0, -drop)))     # (the download's rear tyres float 1.3 cm: every tyre on the ground)
      x, y, z = centres(w); c = (float((x.max() + x.min()) / 2), float((y.max() + y.min()) / 2), float((z.max() + z.min()) / 2))
      n = ('f' if c[0] > 0 else 'r') + side
      rad = np.hypot(x - c[0], y - c[1]); set_role(w, np.where(rad > RIM * rad.max(), 'rubber', 'metal'))
      w.name = w.data.name = f'tyre_{n}'; log('tyre', n, [round(v, 3) for v in c], 'radius', round(float(rad.max()), 3))
      hub = empty(f'wheel_{n}', c, front=n[0] == 'f'); w.parent = hub; w.location = w.location - hub.location
    bpy.data.objects.remove(t, do_unlink=True)
  for k in ('RayonFront', 'RayonBack'): set_role(p[k], 'carbon')
  # mirrors: the two mirror pieces' faces turned back (toward the driver) are the glass; the rest paint
  mx = p['Mirrors']; lab = islands(mx); x, y, z = centres(mx); nx, _, _ = normals(mx)
  roles = np.full(len(x), 'paint_main', dtype=object)
  for s, side in ((-1, 'l'), (1, 'r')):
    pieces = [i for i in set(lab) if (lab == i).sum() > 30 and z[lab == i].mean() * s > 0.15]
    if not pieces: continue
    m = np.isin(lab, pieces) & (nx < -0.5); roles[m] = 'glass'
  set_role(mx, roles.astype(str))
  for s, side in ((-1, 'l'), (1, 'r')):
    x, y, z = centres(mx); r = np.array([mx.data.materials[pp.material_index].name for pp in mx.data.polygons])
    g = split_mask(mx, f'mirror_glass_{side}', (r == 'glass') & (z * s > 0))
    if g:
      gx, gy, gz = centres(g); origin_to(g, (float(gx.mean()), float(gy.mean()), float(gz.mean()))); log('mirror glass', side, len(g.data.polygons), 'faces')
  # the body: everything else joined; the rain light and the halo's LEDs split out of it
  body = join_into(p['UpperBody'], [p['LowerBody'], p['RayonFront'], p['RayonBack'], mx]); body.name = body.data.name = 'body'
  r = np.array([body.data.materials[pp.material_index].name for pp in body.data.polygons])
  for name, role in (('rain_light', 'light'), ('halo_led', 'halo')):
    q = split_mask(body, name, r == role)
    if q: log(name, len(q.data.polygons), 'faces', [round(float(v.mean()), 3) for v in centres(q)])
    r = np.array([body.data.materials[pp.material_index].name for pp in body.data.polygons])
  for s, n in ((-1, 'l'), (1, 'r')):
    x, y, z = centres(body)
    q = split_mask(body, f'fw_main_{n}', (x > AX + 0.36) & (y < 0.30) & (z * s > 0.16))
    if q: q['side'] = s; log('front wing half', n, len(q.data.polygons), 'faces')
  empty('eye', EYE); empty('seat', (-0.25 + SHIFT[0], 0.30 + SHIFT[1], 0)); empty('driver_at', SHIFT)
  st = empty('steer', STEER)
  for n, zz in (('l', -0.135), ('r', 0.135)): empty(f'grip_{n}', (STEER[0], STEER[1], zz), parent=st)
  empty('screen', (STEER[0] - 0.031, STEER[1] + 0.017, 0), parent=st)
  meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
  for o in meshes:
    for uv in list(o.data.uv_layers): o.data.uv_layers.remove(uv)
    finish(o, SHARP)
  return meshes

def render(tag, views):
  for m in bpy.data.materials:
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF') if nt else None
    if not b or nt.nodes.get('ao') or m.name not in ROLES: continue
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'; va.name = 'ao'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    mix.inputs[6].default_value = b.inputs['Base Color'].default_value[:]
    nt.links.new(va.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
  sc = bpy.context.scene
  bpy.ops.mesh.primitive_plane_add(size=60)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), 0, math.radians(30)); sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 32; sc.cycles.device = 'CPU'; sc.render.resolution_x, sc.render.resolution_y = 1400, 760
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
  os.makedirs(PREVIEW, exist_ok=True)
  for name, eye, look in views:
    cam.location = G(*eye); d = G(*look) - G(*eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'{tag}-{name}.png'); bpy.ops.render.render(write_still=True)

VIEWS = (('front34', (4.8, 1.8, 3.3), (0.2, 0.35, 0)), ('side', (0, 0.9, 7.8), (0, 0.45, 0)), ('rear34', (-5.0, 2.0, -3.1), (-0.3, 0.4, 0)),
         ('top', (0.01, 7.5, 0), (0, 0, 0)), ('cockpit', (-0.6, 1.4, 0.0), (0.6, 0.5, 0)), ('rear', (-5.5, 0.8, 0), (0, 0.4, 0)))

if not os.path.exists(SRC):
  print(f'fe_nissan: {SRC} not found; download the model (CREDITS.md) and pass src=<its scene.gltf>; fe.glb left as it is'); sys.exit(0)
parts = load(); log('parts', sorted(parts))
if STAGE == 'build':
  meshes = build(parts)
  if os.path.basename(A.get('ao', '1')) != '0':
    from kit import bake_ao
    log('ambient occlusion'); bake_ao(meshes, (), distance=0.6, samples=24, strength=0.7)
  for o in meshes: log('mesh', o.name, sum(len(q.vertices) - 2 for q in o.data.polygons))
  print('fe:', len(meshes), 'meshes', sum(len(q.vertices) - 2 for o in meshes for q in o.data.polygons), 'triangles')
  if os.path.basename(A.get('export', '1')) != '0':
    log('export'); export(OUT, extras=True, copyright='Based on "Formula E Nissan Gen2 2019/2020 Lowpoly" by CLeN (sketchfab.com/CLeN), CC-BY-4.0; changed for Gridline GP (see CREDITS.md)')
  if PREVIEW: render('built', VIEWS)
