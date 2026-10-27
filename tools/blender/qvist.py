# Gridline GP's 2026 car from "F1 2026 concept (polygon model)" by Qvist_designs (CC-BY-4.0, see CREDITS.md):
# tools/blender/run.sh qvist stage=build [src=<scene.gltf>, default ~/Downloads/f1-2026-concept/scene.gltf] [preview=dir] [ao=0]
# (stage=raw / dec / probe: the inspection steps used to work out the cuts below)
# The download is one fused CAD surface in millimetres (front at −X, Y down, the ground at Y = +30.7) cut into chunks;
# this turns it into the game frame (kit.G: x forward, y up, z right, metres, origin on the ground under the middle of
# the wheelbase), cuts it down, and splits out what the game moves.
import bpy, bmesh, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import args, G, export
from mathutils import Vector, Matrix

A = args()
SRC = A.get('src', os.path.expanduser('~/Downloads/f1-2026-concept/scene.gltf')); PREVIEW = A.get('preview'); OUT = os.path.join(os.path.dirname(os.path.abspath(A.get('out', 'src/game/models/x'))), 'car.glb')   # (run.sh names it after the script)
RATIO = float(os.path.basename(A.get('ratio', '0.06')))
MID_X, GROUND_Y = 1645.0, 30.7          # the model's mid-wheelbase X and its ground (mm)

def load():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=SRC)
  meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
  for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
  bpy.context.view_layer.objects.active = meshes[0]
  bpy.ops.object.join(); ob = bpy.context.view_layer.objects.active
  bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
  for o in list(bpy.context.scene.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
  # model (X, Y, Z) mm → game (−(X − mid), ground − Y, Z) m → Blender (gx, −gz, gy)
  M = Matrix(((-0.001, 0, 0, MID_X * 0.001), (0, 0, -0.001, 0), (0, -0.001, 0, GROUND_Y * 0.001), (0, 0, 0, 1)))
  ob.data.transform(M); ob.data.update(); ob.name = 'car'
  bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005); bm.to_mesh(ob.data); bm.free()
  return ob

def decimate(ob, ratio, keep_borders=False, keep_sharp=None):
  log('decimate', ob.name, len(ob.data.polygons), '→', ratio)
  """collapse to `ratio` of the faces; keep_borders: the vertices where two materials meet (and open edges) keep
  their detail, so a colour border stays a clean line instead of a sawtooth of big triangles"""
  m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
  if keep_borders:
    me = ob.data; nv, nl, nf, ne = len(me.vertices), len(me.loops), len(me.polygons), len(me.edges)
    lv = np.empty(nl, dtype=np.int64); me.loops.foreach_get('vertex_index', lv)
    le = np.empty(nl, dtype=np.int64); me.loops.foreach_get('edge_index', le)
    tot = np.empty(nf, dtype=np.int64); me.polygons.foreach_get('loop_total', tot)
    mi = np.empty(nf, dtype=np.int64); me.polygons.foreach_get('material_index', mi)
    lm = np.repeat(mi, tot)
    lo = np.full(nv, 99); hi = np.full(nv, -1); np.minimum.at(lo, lv, lm); np.maximum.at(hi, lv, lm)
    open_e = np.flatnonzero(np.bincount(le, minlength=ne) == 1)
    ev = np.empty(ne * 2, dtype=np.int64); me.edges.foreach_get('vertices', ev); ev = ev.reshape(ne, 2)
    border = np.zeros(nv, bool); border[lo != hi] = True; border[ev[open_e].ravel()] = True
    # sharp creases (> keep_sharp°, if given): their vertices stay too (tried for thin pieces 2026-10-27: everything else
    # then flattened into panels to make the ratio, so off)
    if keep_sharp:
     nfn = np.empty(len(me.polygons) * 3); me.polygons.foreach_get('normal', nfn); nfn = nfn.reshape(-1, 3)
     lp = np.repeat(np.arange(len(me.polygons)), tot)
     o2 = np.argsort(le, kind='stable'); les, lps = le[o2], lp[o2]
     f1 = np.flatnonzero(np.r_[True, les[1:] != les[:-1]]); cnt = np.diff(np.r_[f1, len(les)])
     t2 = f1[cnt == 2]; sharp = (nfn[lps[t2]] * nfn[lps[t2 + 1]]).sum(1) < math.cos(math.radians(keep_sharp))
     border[ev[les[t2][sharp]].ravel()] = True
    g = ob.vertex_groups.new(name='free'); g.add(np.flatnonzero(~border).tolist(), 1.0, 'REPLACE')
    m.vertex_group = 'free'; m.vertex_group_factor = 1.0
    border = np.flatnonzero(border)
    print(ob.name, 'border vertices kept', len(border))
  bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier=m.name)

def preview(tag):
  sc = bpy.context.scene
  mat = bpy.data.materials.new('clay'); mat.use_nodes = True
  b = mat.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.08, 0.2, 0.6, 1); b.inputs['Roughness'].default_value = 0.35
  for o in sc.objects:
    if o.type == 'MESH':
      o.data.materials.clear(); o.data.materials.append(mat)
      o.data.polygons.foreach_set('use_smooth', [True] * len(o.data.polygons)); o.data.set_sharp_from_angle(angle=math.radians(35))
  bpy.ops.mesh.primitive_plane_add(size=60)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), 0, math.radians(30))
  sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 40; sc.cycles.device = 'CPU'
  sc.render.resolution_x, sc.render.resolution_y = 1400, 760
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
  os.makedirs(PREVIEW, exist_ok=True)
  for name, eye, look in (('front34', (5.2, 2.0, 3.6), (0.2, 0.35, 0)), ('side', (0, 1.0, 8.5), (0, 0.45, 0)), ('rear34', (-5.4, 2.2, -3.4), (-0.3, 0.4, 0))):
    cam.location = G(*eye); d = G(*look) - G(*eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'{tag}-{name}.png'); bpy.ops.render.render(write_still=True)

if not os.path.exists(SRC):   # (npm run models without the download: keep the committed car.glb)
  print(f'qvist: {SRC} not found; download the model (CREDITS.md) and pass src=<its scene.gltf>; car.glb left as it is'); sys.exit(0)
ob = load()
lo = [min(v.co[i] for v in ob.data.vertices) for i in range(3)]; hi = [max(v.co[i] for v in ob.data.vertices) for i in range(3)]
print('blender bbox', [round(c, 3) for c in lo], [round(c, 3) for c in hi], 'faces', len(ob.data.polygons))
if os.path.basename(A.get('stage', 'raw')) == 'dec':
  decimate(ob, RATIO); print('decimated faces', len(ob.data.polygons))
if PREVIEW and os.path.basename(A.get('stage', 'raw')) in ('raw', 'dec') and not A.get('ortho'): preview(os.path.basename(A.get('stage', 'raw')))

def ortho(name, eye, look, scale, res=(2400, 1200), keep=None):
  """an orthographic render (scale = metres across) of the car, optionally only the slice keep(z) of it (game frame)"""
  sc = bpy.context.scene
  if keep:
    tmp = ob.copy(); tmp.data = ob.data.copy(); sc.collection.objects.link(tmp); ob.hide_render = True
    bm = bmesh.new(); bm.from_mesh(tmp.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(-f.calc_center_median().y)], context='FACES'); bm.to_mesh(tmp.data); bm.free()
  cam = sc.camera; cam.data.type = 'ORTHO'; cam.data.ortho_scale = scale
  sc.render.resolution_x, sc.render.resolution_y = res
  cam.location = G(*eye); d = G(*look) - G(*eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
  sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'ortho-{name}.png'); bpy.ops.render.render(write_still=True)
  if keep: bpy.data.objects.remove(tmp, do_unlink=True); ob.hide_render = False

if os.path.basename(A.get('stage', 'raw')) == 'dec' and A.get('ortho'):
  # side views centred at (cx, cy) game metres; scale 6 m across 2400 px = 400 px/m
  ortho('side', (0.2, 0.55, 10), (0.2, 0.55, 0), 6.0)
  ortho('side-centre', (0.2, 0.55, 10), (0.2, 0.55, 0), 6.0, keep=lambda z: abs(z) < 0.30)
  ortho('side-wing', (0.2, 0.55, 10), (0.2, 0.55, 0), 6.0, keep=lambda z: 0.30 < z < 0.70)
  ortho('top', (0.2, 10, 0.0001), (0.2, 0, 0), 6.0)

def split_region(src, name, inside):
  """the faces of `src` whose centre (game frame) passes inside(x, y, z), as a new object; returns it"""
  bm = bmesh.new(); bm.from_mesh(src.data)
  gp = lambda c: (c.x, c.z, -c.y)          # Blender → game
  sel = [f for f in bm.faces if inside(*gp(f.calc_center_median()))]
  new = bmesh.new()
  vmap = {}
  for f in sel:
    vs = [vmap.setdefault(v.index, new.verts.new(v.co)) for v in f.verts]
    try: new.faces.new(vs)
    except ValueError: pass
  bmesh.ops.delete(bm, geom=sel, context='FACES'); bm.to_mesh(src.data); bm.free()
  me = bpy.data.meshes.new(name); new.to_mesh(me); new.free()
  ob2 = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob2)
  return ob2

def loose(o):
  bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
  bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
  return [x for x in bpy.context.selected_objects]

def box_of(o):
  vs = [(v.co.x, v.co.z, -v.co.y) for v in o.data.vertices]
  return [round(min(v[i] for v in vs), 3) for i in range(3)], [round(max(v[i] for v in vs), 3) for i in range(3)]

if os.path.basename(A.get('stage', 'raw')) == 'probe':
  decimate(ob, RATIO)
  rw = split_region(ob, 'rw', lambda x, y, z: -2.55 < x < -1.85 and 0.62 < y < 1.02 and abs(z) < 0.50)
  fw = split_region(ob, 'fw', lambda x, y, z: x > 2.0 and y < 0.42 and 0.20 < abs(z) < 0.78)
  for o in (rw, fw):
    ps = loose(o); print(o.name, 'pieces', len(ps))
    for p in sorted(ps, key=lambda p: -len(p.data.polygons))[:12]: print('  ', len(p.data.polygons), *box_of(p))
    if o.name == 'fw':
      import json; json.dump([dict(n=len(p.data.polygons), box=box_of(p), ys=sorted(round((v.co.z), 3) for v in p.data.vertices)[::max(1, len(p.data.vertices)//40)]) for p in ps if len(p.data.polygons) > 50], open(os.path.join(os.path.dirname(OUT), '..', '..', '..', 'tools/blender/out/qvist/fw.json'), 'w'))


# ---------------------------------------------------------------- fast (numpy) face work: the full model has ~1M faces
import numpy as np, time
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

def centres(o):
  """every face's centre in the game frame: arrays x, y, z"""
  n = len(o.data.polygons); c = np.empty(n * 3); o.data.polygons.foreach_get('center', c); c = c.reshape(n, 3)
  return c[:, 0], c[:, 2], -c[:, 1]

def islands(o, angle=40):
  """each face's patch: the faces joined across edges flatter than `angle` (a CAD model's surfaces, between its sharp
  creases). Union-find with pointer jumping in numpy (the full model has ~1M faces). Returns (labels, n)"""
  me = o.data; nf, nl, ne = len(me.polygons), len(me.loops), len(me.edges)
  tot = np.empty(nf, dtype=np.int64); me.polygons.foreach_get('loop_total', tot)
  le = np.empty(nl, dtype=np.int64); me.loops.foreach_get('edge_index', le)
  lp = np.repeat(np.arange(nf), tot)
  order = np.argsort(le, kind='stable'); le, lp = le[order], lp[order]
  first = np.flatnonzero(np.r_[True, le[1:] != le[:-1]]); count = np.diff(np.r_[first, len(le)])
  two = first[count == 2]; a, b = lp[two], lp[two + 1]
  nr = np.empty(nf * 3); me.polygons.foreach_get('normal', nr); nr = nr.reshape(nf, 3)
  keep = (nr[a] * nr[b]).sum(1) > math.cos(math.radians(angle)); a, b = a[keep], b[keep]
  parent = np.arange(nf)
  while True:
    pa, pb = parent[a], parent[b]
    if not (pa != pb).any(): break
    lo, hi = np.minimum(pa, pb), np.maximum(pa, pb)
    np.minimum.at(parent, hi, lo)
    while True:
      nxt = parent[parent]
      if (nxt == parent).all(): break
      parent = nxt
  labels, inv = np.unique(parent, return_inverse=True)
  return inv, len(labels)

def paint_islands(o, rule, angle=40, feature=None):
  """colour whole patches (islands): rule(lo, hi, centre: arrays per patch, game frame; area) → a role per patch, so a
  colour border always follows a crease of the model"""
  role_mats(o)
  lab, n = islands(o, angle)
  x, y, z = centres(o)
  ar = np.empty(len(lab)); o.data.polygons.foreach_get('area', ar)
  P = np.stack([x, y, z], 1)
  lo = np.full((n, 3), np.inf); hi = np.full((n, 3), -np.inf)
  for k in range(3): np.minimum.at(lo[:, k], lab, P[:, k]); np.maximum.at(hi[:, k], lab, P[:, k])
  w = np.bincount(lab, ar, n) + 1e-12
  c = np.stack([np.bincount(lab, ar * P[:, k], n) / w for k in range(3)], 1)
  # (feature: an optional per-face value the rule wants averaged over each patch by area, e.g. the distance from an axle)
  roles = np.asarray(rule(lo, hi, c, w) if not feature else rule(lo, hi, c, w, np.bincount(lab, ar * feature(P), n) / w))
  idx = np.zeros(n, dtype=np.int32)
  for i, r in enumerate(ROLES): idx[roles == r] = i
  o.data.polygons.foreach_set('material_index', idx[lab]); o.data.update()
  log('patches', n)

def split_mask(src, name, mask):
  """the faces where mask (a bool array over src's faces) is set, moved into a new object"""
  me = src.data
  if not mask.any():
    o = bpy.data.objects.new(name, bpy.data.meshes.new(name)); bpy.context.scene.collection.objects.link(o); return o
  me.polygons.foreach_set('select', mask); me.update()
  bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
  bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='FACE'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
  new = [o for o in bpy.context.selected_objects if o is not src][0]; new.name = name; new.data.name = name
  return new

# ---------------------------------------------------------------- the build: the game's car.glb
ROLES = ['paint_main', 'paint_accent', 'carbon', 'rubber', 'metal', 'light', 'glass', 'dark']
COLOURS = {'paint_main': (0.05, 0.16, 0.55), 'paint_accent': (1.0, 0.72, 0.05), 'carbon': (0.035, 0.035, 0.04), 'rubber': (0.02, 0.02, 0.022),
           'metal': (0.55, 0.56, 0.58), 'light': (0.5, 0.03, 0.02), 'glass': (0.2, 0.25, 0.3), 'dark': (0.01, 0.01, 0.012)}
def role_mats(o):
  o.data.materials.clear()
  for r in ROLES:
    m = bpy.data.materials.get(r)
    if not m:
      m = bpy.data.materials.new(r); m.use_nodes = True
      b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*COLOURS[r], 1)
      b.inputs['Roughness'].default_value = 0.35 if r.startswith('paint') else 0.75
    o.data.materials.append(m)

def paint(o, rule):
  """every face's material: rule(x, y, z arrays of the face centres, game frame) → an array of role names"""
  role_mats(o)
  if not len(o.data.polygons): return
  roles = np.asarray(rule(*centres(o)))
  if roles.ndim == 0: roles = np.full(len(o.data.polygons), str(roles))
  idx = np.zeros(len(roles), dtype=np.int32)
  for i, r in enumerate(ROLES): idx[roles == r] = i
  o.data.polygons.foreach_set('material_index', idx); o.data.update()

def finish(o, sharp=35):
  me = o.data
  me.polygons.foreach_set('use_smooth', [True] * len(me.polygons)); me.set_sharp_from_angle(angle=math.radians(sharp))
  if 'Col' not in me.color_attributes:
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); col.data.foreach_set('color', [1.0] * (len(col.data) * 4))
  me.color_attributes.active_color = me.color_attributes['Col']

def origin_to(o, at):
  """move the object's origin to `at` (game frame), keeping the mesh where it is"""
  p = G(*at); o.data.transform(Matrix.Translation(-p)); o.location = p

def empty(name, at, parent=None, **extras):
  e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); e.empty_display_size = 0.05
  if parent: e.parent = parent; e.location = G(*at) - parent.location
  else: e.location = G(*at)
  for k, v in extras.items(): e[k] = v
  return e

AXLES = (('fl', 1.70, -1), ('fr', 1.70, 1), ('rl', -1.70, -1), ('rr', -1.70, 1))
EYE, STEER = (0.08, 0.84, 0.0), (0.50, 0.66, 0.0)      # the driver's eye, the steering wheel's centre (game frame)
gp = lambda c: (c.x, c.z, -c.y)                         # Blender → game frame

def join_into(dst, srcs):
  bpy.ops.object.select_all(action='DESELECT')
  for q in srcs: q.select_set(True)
  dst.select_set(True); bpy.context.view_layer.objects.active = dst; bpy.ops.object.join()

def body_patch_role(lo, hi, c, area):
  """the body's paint by patch (whole surfaces between creases): its box lo / hi and centre c (game frame)"""
  n = len(c); r = np.full(n, 'paint_main', dtype='<U12')
  x, y, z, a = c[:, 0], c[:, 1], c[:, 2], np.abs(c[:, 2])
  # suspension and uprights: patches wholly out between the body and the wheels at an axle
  # (by the patch's centre: the arms, the floor and the fences run on smoothly into their neighbours)
  out_wide = np.minimum(np.abs(lo[:, 2]), np.abs(hi[:, 2])) * (np.sign(lo[:, 2]) == np.sign(hi[:, 2]))
  r[((np.abs(x - 1.70) < 0.55) | (np.abs(x + 1.70) < 0.5)) & (a > 0.30) & (y > 0.12) & (y < 0.62) & (out_wide > 0.10)] = 'carbon'
  r[(y < 0.07) & (hi[:, 1] < 0.25)] = 'carbon'                                                     # floor, plank, its edges
  r[(x < -1.45) & (x > -2.6) & (y < 0.32) & (a < 0.62) & (hi[:, 1] < 0.45)] = 'carbon'               # the diffuser and its fences
  fw = (lo[:, 0] > 1.90) & (hi[:, 1] < 0.46) & ~((a < 0.24) & (y > 0.18))
  r[fw] = 'carbon'; r[fw & (a > 0.84)] = 'paint_accent'                                            # front wing, endplates
  rw = (hi[:, 0] < -1.80) & (lo[:, 1] > 0.55)
  r[rw] = 'carbon'; r[rw & (a > 0.48)] = 'paint_main'                                               # rear wing, endplates
  r[(lo[:, 0] > -0.38) & (hi[:, 0] < -0.10) & (lo[:, 1] > 0.93)] = 'paint_accent'                   # T-camera
  return r

# The colour borders of the body (body_role) as planes in the game frame: (point, normal, where) — each cuts only the
# faces where(x, y, z) of their centre holds. Cut first, so every border is a straight edge of the mesh, not the
# sawtooth of the CAD model's long thin triangles across it (2026-10-27, user: wrong colours at the joints).
def body_cuts():
  axle = lambda x: (np.abs(x - 1.70) < 0.62) | (np.abs(x + 1.70) < 0.56)
  zone = lambda x, y, z: axle(x) & (y > 0.08) & (y < 0.76)
  out = []
  for s in (-1, 1):
    out += [((0, 0, s * 0.30), (0, 0, 1), zone),                                                    # suspension: inner ends
            ((0, 0, s * 0.875), (0, 0, 1), lambda x, y, z: (x > 1.9) & (y < 0.46)),                   # front endplates
            ((0, 0, s * 0.13), (0, 0, 1), lambda x, y, z: (x > 1.9) & (y < 0.46)),                    # front wing / pylons
            ((0, 0, s * 0.24), (0, 0, 1), lambda x, y, z: (x > 1.9) & (y < 0.46)),                    # the nose's sides
            ((0, 0, s * 0.48), (0, 0, 1), lambda x, y, z: (x < -1.8) & (y > 0.55)),                   # rear endplates
            ((0, 0, s * 0.62), (0, 0, 1), lambda x, y, z: (x < -1.4) & (y < 0.4))]                    # diffuser sides
  for xc in (1.70 - 0.55, 1.70 + 0.55, -1.70 - 0.5, -1.70 + 0.5): out.append(((xc, 0, 0), (1, 0, 0), lambda x, y, z: (y > 0.08) & (y < 0.76) & (np.abs(z) > 0.25)))
  out += [((0, 0.12, 0), (0, 1, 0), lambda x, y, z: axle(x) & (np.abs(z) > 0.25)), ((0, 0.70, 0), (0, 1, 0), lambda x, y, z: axle(x) & (np.abs(z) > 0.25)),
          ((0, 0.075, 0), (0, 1, 0), lambda x, y, z: np.ones(len(x), bool)),                         # floor line
          ((0, 0.18, 0), (0, 1, 0), lambda x, y, z: x > 1.9), ((0, 0.42, 0), (0, 1, 0), lambda x, y, z: x > 1.9),
          ((1.95, 0, 0), (1, 0, 0), lambda x, y, z: y < 0.46),                                         # front wing's start
          ((-1.85, 0, 0), (1, 0, 0), lambda x, y, z: y > 0.55), ((0, 0.62, 0), (0, 1, 0), lambda x, y, z: x < -1.8),
          ((-1.45, 0, 0), (1, 0, 0), lambda x, y, z: y < 0.4), ((0, 0.32, 0), (0, 1, 0), lambda x, y, z: x < -1.4),
          ((-0.35, 0, 0), (1, 0, 0), lambda x, y, z: y > 0.9), ((-0.12, 0, 0), (1, 0, 0), lambda x, y, z: y > 0.9), ((0, 0.95, 0), (0, 1, 0), lambda x, y, z: (x > -0.4) & (x < -0.05))]
  return out

def cut_borders(o):
  """bisect the faces near each colour border with its plane"""
  bm = bmesh.new(); bm.from_mesh(o.data); n0 = len(bm.faces)
  for co, no, where in body_cuts():
    bm.faces.ensure_lookup_table()
    cs = np.array([f.calc_center_median()[:] for f in bm.faces]); x, y, z = cs[:, 0], cs[:, 2], -cs[:, 1]
    d = (x - co[0]) * no[0] + (y - co[1]) * no[1] + (z - co[2]) * no[2]
    # (only faces the plane could cross: their centre within 0.4 m of it, and where the border applies)
    pick = np.flatnonzero(where(x, y, z) & (np.abs(d) < 0.4))
    faces = [bm.faces[i] for i in pick]
    if not faces: continue
    geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=G(*co), plane_no=G(*no) - G(0, 0, 0))
  log('border cuts:', n0, '→', len(bm.faces), 'faces')
  bm.to_mesh(o.data); bm.free(); o.data.update()

def body_role(x, y, z):
  """the body's paint roles by where a face is (arrays; later rules win); every limit is one of body_cuts' planes"""
  a = np.abs(z); r = np.full(len(x), 'paint_main', dtype='<U12')
  r[((np.abs(x - 1.70) < 0.55) | (np.abs(x + 1.70) < 0.5)) & (a > 0.30) & (y > 0.12) & (y < 0.70)] = 'carbon'   # suspension (the upper arms meet the body at up to 0.7 m)
  r[(x < -1.85) & (y > 0.62)] = 'carbon'; r[(x < -1.85) & (y > 0.62) & (a > 0.48)] = 'paint_main'              # rear wing, endplates
  fw = (x > 1.95) & (y < 0.42) & (a > 0.13) & ~((a < 0.24) & (y > 0.18))                                        # (not the nose)
  r[fw] = 'carbon'; r[fw & (a > 0.875)] = 'paint_accent'                                                         # front wing, endplates
  r[(x < -1.45) & (y < 0.32) & (a < 0.62)] = 'carbon'                                                            # diffuser, fences
  r[y < 0.075] = 'carbon'                                                                                         # floor, plank
  r[(x > -0.35) & (x < -0.12) & (y > 0.95)] = 'paint_accent'                                                     # T-camera
  return r

def cockpit_dark(o):
  """the cockpit's inside in `dark`: faces in the cockpit that face into it (sides facing the middle, the floor facing
  up), so the colour stops at the rim's crease instead of cutting across the surface"""
  me = o.data; n = len(me.polygons); nr = np.empty(n * 3); me.polygons.foreach_get('normal', nr); nr = nr.reshape(n, 3)
  x, y, z = centres(o); nz, ny = -nr[:, 1], nr[:, 2]                  # (Blender → game: z = −y, y = z)
  box = (x > -0.08) & (x < 0.68) & (np.abs(z) < 0.27) & (y > 0.15) & (y < 0.70)
  inward = (nz * np.sign(z) < -0.35) | ((ny > 0.6) & (y < 0.55))
  idx = np.empty(n, dtype=np.int32); me.polygons.foreach_get('material_index', idx)
  idx[box & inward] = ROLES.index('dark'); me.polygons.foreach_set('material_index', idx); me.update()

def lightbox(name, x0, x1, y0, y1, z0, z1):
  bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
  o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
  o.scale = ((x1 - x0), (z1 - z0), (y1 - y0)); o.location = G((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  bpy.context.view_layer.objects.active = o; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
  bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
  role_mats(o); o.data.polygons.foreach_set('material_index', [ROLES.index('light')] * len(o.data.polygons)); return o

def ellipsoid(name, c, r, role, **extras):
  bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
  o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
  o.scale = (r[0], r[2], r[1]); o.location = G(*c)
  bpy.context.view_layer.objects.active = o; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
  bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
  role_mats(o); o.data.polygons.foreach_set('material_index', [ROLES.index(role)] * len(o.data.polygons))
  for k, v in extras.items(): o[k] = v
  return o

def build():
  log('pieces'); parts = loose(ob)
  body = max(parts, key=lambda p: len(p.data.polygons)); body.name = 'body'
  tyres, glasses, rest = [], [], []
  for p in parts:
    if p is body: continue
    if not len(p.data.polygons): bpy.data.objects.remove(p, do_unlink=True); continue
    lo, hi = box_of(p); c = [(a + b) / 2 for a, b in zip(lo, hi)]
    w = next((a for a in AXLES if abs(c[0] - a[1]) < 0.4 and c[2] * a[2] > 0.4 and len(p.data.polygons) > 1000), None)
    if w: p.name = f'tyre_{w[0]}'; tyres.append((p, w, c))
    elif len(p.data.polygons) < 500 and 0.4 < c[0] < 0.8: p.name = f'mirror_glass_{"lr"[c[2] > 0]}'; glasses.append(p)
    else: rest.append(p)
  join_into(body, rest)
  # rear wing: its two flaps are separate pieces in the model
  movers = []
  log('rear wing'); x, y, z = centres(body)
  rw = split_mask(body, 'rw', (x > -2.55) & (x < -1.85) & (y > 0.62) & (y < 1.02) & (np.abs(z) < 0.50))
  rws = sorted([q for q in loose(rw) if len(q.data.polygons) > 50], key=lambda q: -box_of(q)[1][1])
  for q, (name, open_) in zip(rws[:2], (('rw_flap2', 26), ('rw_flap', 20))):
    lo, hi = box_of(q); q.name = name; origin_to(q, (hi[0], (lo[1] + hi[1]) / 2, 0)); q['open'] = open_; q['axis'] = [0, 0, 1]; movers.append(q)
  join_into(body, [q for q in bpy.data.objects if q.name.startswith('rw') and q not in movers and q.type == 'MESH'])
  # front wing: its flaps are fused to the main plane; a face well above the wing's lowest at its spot across the span
  # is a flap's. One per side, turned about its own leading edge (the wing is swept)
  log('front wing')
  for s, n in ((-1, 'l'), (1, 'r')):
    x, y, z = centres(body)
    inwing = (x > 2.0) & (y < 0.42) & (np.abs(z) > 0.20) & (np.abs(z) < 0.80)
    k = np.round(z / 0.03).astype(np.int64) + 100; low = np.full(300, 9.0); np.minimum.at(low, k[inwing], y[inwing])
    q = split_mask(body, f'fw_flap_{n}', inwing & (z * s > 0) & (y - low[k] > 0.05))
    if not len(q.data.polygons): bpy.data.objects.remove(q, do_unlink=True); continue
    vs = [gp(v.co) for v in q.data.vertices]
    root = min((v for v in vs if abs(v[2]) < 0.30), key=lambda v: -v[0]); tip = min((v for v in vs if abs(v[2]) > 0.70), key=lambda v: -v[0])
    ax = [tip[i] - root[i] for i in range(3)]
    if ax[2] < 0: ax = [-c for c in ax]
    L = math.sqrt(sum(c * c for c in ax)); q['axis'] = [round(c / L, 4) for c in ax]; q['open'] = 14
    origin_to(q, root); movers.append(q)
  # paint (on the full model), then cut down
  log('paint'); cut_borders(body); paint(body, body_role); cockpit_dark(body); decimate(body, RATIO, keep_borders=True)
  for q in movers:
    paint(q, lambda x, y, z, q=q: 'paint_accent' if q.name == 'rw_flap2' else 'carbon'); decimate(q, RATIO * 1.5)
  wheels = []
  for p, (n, ax, side), c in tyres:
    lo, hi = box_of(p); centre = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    # by patch: the tyre's surfaces out past the 18" rim (0.229 m) rubber, the rim / cover metal, the hub nut the accent
    # (each patch by its mean distance from the axle: a ring's centre is the axle itself)
    wheel_role = lambda lo, hi, cc, area, rad: np.where(rad > 0.245, 'rubber', np.where(rad > 0.06, 'metal', 'paint_accent'))
    paint_islands(p, wheel_role, angle=30, feature=lambda P, c=centre: np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]))
    decimate(p, 0.09, keep_borders=True)
    hub = empty(f'wheel_{n}', centre, front=n[0] == 'f'); p.parent = hub; p.location = p.location - hub.location
    wheels.append(hub)
  for g in glasses: paint(g, lambda x, y, z: 'glass'); lo, hi = box_of(g); origin_to(g, [(a + b) / 2 for a, b in zip(lo, hi)])
  # what the model doesn't have: brake lights, a helmet, the steering wheel and the driver's anchors
  extra = [lightbox('rain_light', -2.468, -2.452, 0.27, 0.34, -0.035, 0.035)]
  for s, n in ((-1, 'l'), (1, 'r')): extra.append(lightbox(f'ep_light_{n}', -2.505, -2.495, 0.64, 0.88, s * 0.555 - 0.005, s * 0.555 + 0.005))
  extra.append(ellipsoid('helmet', (0.03, 0.86, 0), (0.15, 0.13, 0.125), 'paint_accent', show='outside'))
  extra.append(ellipsoid('visor', (0.135, 0.875, 0), (0.05, 0.035, 0.10), 'glass', show='outside'))
  empty('eye', EYE); empty('seat', (-0.25, 0.30, 0))
  st = empty('steer', STEER)
  wheel = ellipsoid('steer_wheel', STEER, (0.03, 0.08, 0.14), 'carbon'); wheel.parent = st; wheel.location = wheel.location - st.location
  for n, z in (('l', -0.135), ('r', 0.135)): empty(f'grip_{n}', (STEER[0], STEER[1], z), parent=st)
  empty('screen', (STEER[0] - 0.031, STEER[1] + 0.017, 0), parent=st)
  meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
  for o in meshes: finish(o)
  return body, movers, meshes

if os.path.basename(A.get('stage', 'raw')) == 'build':
  body, movers, meshes = build()
  if os.path.basename(A.get('ao', '1')) != '0':
    from kit import bake_ao
    log('ambient occlusion'); bake_ao(meshes, (), distance=0.6, samples=24, strength=0.7)
  tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
  print('car:', len(meshes), 'meshes', tris, 'triangles; movers', [(m.name, m['open'], list(m['axis'])) for m in movers])
  bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'EEVEE_NEXT') else bpy.context.scene.render.engine
  log('export'); export(OUT, extras=True, copyright='Based on "F1 2026 concept (polygon model)" by Qvist_designs (sketchfab.com/Qvist_Designs), CC-BY-4.0; changed for Gridline GP (see CREDITS.md)')
  if PREVIEW:
    for m in bpy.data.materials:   # the role colours × the baked AO, for the renders
      nt = m.node_tree; b = nt.nodes.get('Principled BSDF') if nt else None
      if not b: continue
      va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
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
    for name, eye, look in (('front34', (5.2, 2.0, 3.6), (0.2, 0.35, 0)), ('side', (0, 1.0, 8.5), (0, 0.45, 0)), ('rear34', (-5.4, 2.2, -3.4), (-0.3, 0.4, 0)), ('wing', (3.9, 0.8, 1.6), (2.5, 0.2, 0)),
                            # close-ups (2026-10-27, user: glitches and wrong colours at sharp curves, thin pieces and the joints round the wheels)
                            ('fwheel-out', (2.3, 0.75, 1.9), (1.7, 0.35, 0.75)), ('fwheel-top', (1.75, 1.9, 1.1), (1.7, 0.3, 0.55)),
                            ('fwheel-in', (1.1, 0.6, 0.35), (1.7, 0.35, 0.75)), ('rwheel-out', (-1.0, 0.8, 1.9), (-1.7, 0.35, 0.7)),
                            ('rwheel-in', (-1.15, 0.65, 0.15), (-1.7, 0.35, 0.7)), ('rear-low', (-3.2, 0.35, 1.0), (-2.0, 0.35, 0.3))):
      cam.location = G(*eye); d = G(*look) - G(*eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
      sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'built-{name}.png'); bpy.ops.render.render(write_still=True)
