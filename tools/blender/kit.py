# Shared parts of the Gridline GP Blender scripts (tools/blender/*.py, run by run.sh): painting textures with numpy,
# building meshes as quads with per-corner uv / colour / normal, Blender objects and materials, the glTF export, and
# ambient occlusion baked into the vertex colours with Cycles.
import bpy, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

UP = Vector((0, 0, 1))   # (Blender is Z up; the glTF export turns it Y up)

def args():
  """the script's `key=value` arguments (after --)"""
  return dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)

# ---------------------------------------------------------------- textures
class Canvas:
  """RGBA painting, rows top to bottom (flipped for Blender at the end), drawn at 2x and averaged down."""
  def __init__(self, w, h, ss=2):
    self.ss, self.w, self.h = ss, w * ss, h * ss
    self.rgb = np.zeros((self.h, self.w, 3)); self.a = np.zeros((self.h, self.w))
  def _box(self, x0, y0, x1, y1):
    s = self.ss; x0, y0 = max(0, int(x0 * s)), max(0, int(y0 * s)); x1, y1 = min(self.w, int(x1 * s) + 2), min(self.h, int(y1 * s) + 2)
    if x0 >= x1 or y0 >= y1: return None
    ys, xs = np.mgrid[y0:y1, x0:x1]
    return (slice(y0, y1), slice(x0, x1)), (xs + 0.5) / s, (ys + 0.5) / s
  def paint(self, box, cov, col):
    sl = box[0]
    cov = np.clip(cov, 0, 1)[..., None]
    self.rgb[sl] = self.rgb[sl] * (1 - cov) + np.asarray(col) * cov
    self.a[sl] = self.a[sl] + cov[..., 0] * (1 - self.a[sl])
  def segment(self, p, q, width, col):
    (px, py), (qx, qy) = p, q
    b = self._box(min(px, qx) - width, min(py, qy) - width, max(px, qx) + width, max(py, qy) + width)
    if not b: return
    _, xs, ys = b; dx, dy = qx - px, qy - py; L2 = dx * dx + dy * dy or 1e-9
    t = np.clip(((xs - px) * dx + (ys - py) * dy) / L2, 0, 1)
    d = np.hypot(xs - px - t * dx, ys - py - t * dy)
    self.paint(b, (width / 2 - d) * self.ss + 0.5, col)
  def leaf(self, base, ang, length, width, col, shade):
    """a pointed leaf from `base` toward angle `ang` (0 = up the image), lighter along the midrib"""
    bx, by = base; ca, sa = math.cos(ang), math.sin(ang)
    tx, ty = bx + sa * length, by - ca * length
    b = self._box(min(bx, tx) - width, min(by, ty) - width, max(bx, tx) + width, max(by, ty) + width)
    if not b: return
    _, xs, ys = b; rx, ry = xs - bx, ys - by
    u = (rx * sa - ry * ca) / length                # 0 at the stalk .. 1 at the tip
    v = (rx * ca + ry * sa)                         # across (px)
    half = width / 2 * np.clip(np.sin(np.pi * np.clip(u, 0, 1)) ** 0.75, 0, 1) * (u < 1) * (u > 0)
    cov = np.where(half > 0, (half - np.abs(v)) * self.ss + 0.5, 0)
    rib = np.exp(-(v / (0.07 * width + 0.4)) ** 2) * 0.18
    light = (shade * (0.82 + 0.28 * np.clip(u, 0, 1)) + rib - 0.12 * np.abs(v) / (width / 2 + 1e-6))[..., None]
    self.paint(b, cov, np.asarray(col) * light)
  def result(self):
    s = self.ss
    h, w = self.h // s, self.w // s
    a = self.a.reshape(h, s, w, s).mean(axis=(1, 3))
    pm = (self.rgb * self.a[..., None]).reshape(h, s, w, s, 3).mean(axis=(1, 3))
    rgb = pm / np.maximum(a[..., None], 1e-6)
    # transparent pixels take the mean colour, so mipmaps and filtering don't pull a dark fringe into the edges
    mean = (pm.sum(axis=(0, 1)) / max(a.sum(), 1e-6))
    rgb = np.where(a[..., None] > 0.02, rgb, mean)
    return np.clip(rgb, 0, 1), np.clip(a, 0, 1)

def to_image(name, rgb, a):
  h, w = a.shape
  px = np.concatenate([rgb, a[..., None]], axis=2)[::-1].astype(np.float32)   # Blender's rows go bottom up
  img = bpy.data.images.new(name, w, h, alpha=True)
  img.pixels.foreach_set(px.ravel()); img.file_format = 'PNG'; img.pack()
  return img

# ---------------------------------------------------------------- geometry
class Part:
  """a mesh being built: quads with per-corner uv, colour (the baked shading) and normal"""
  def __init__(self): self.verts, self.faces, self.uv, self.col, self.nrm = [], [], [], [], []
  def quad(self, ps, uvs, cols, nrms):
    k = len(self.verts); self.verts += [tuple(p) for p in ps]; self.faces.append((k, k + 1, k + 2, k + 3))
    self.uv += uvs; self.col += cols; self.nrm += [tuple(n.normalized()) for n in nrms]

def frames(pts):
  """parallel-transport frames along a path (no twisting)"""
  T = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(len(pts))]
  n = T[0].orthogonal().normalized(); out = []
  for i, t in enumerate(T):
    if i:
      ax = T[i - 1].cross(t)
      if ax.length > 1e-6: n = Matrix.Rotation(T[i - 1].angle(t), 3, ax.normalized()) @ n
    n = (n - t * n.dot(t)).normalized(); out.append((t, n, t.cross(n)))
  return out

def tube(part, pts, rads, sides, shade, texel=0.55):
  """a tapered tube through `pts`; the bark texture wraps round it ~ every `texel` m"""
  F = frames(pts); wraps = max(1, round(2 * math.pi * rads[0] / texel)); along = [0.0]
  for i in range(1, len(pts)): along.append(along[-1] + (pts[i] - pts[i - 1]).length)
  ring = lambda i, s: (lambda a: F[i][1] * math.cos(a) + F[i][2] * math.sin(a))(2 * math.pi * s / sides)
  for i in range(len(pts) - 1):
    for s in range(sides):
      corners = [(i, s), (i, s + 1), (i + 1, s + 1), (i + 1, s)]
      ps = [pts[a] + ring(a, b) * rads[a] for a, b in corners]
      uvs = [(b / sides * wraps, along[a] / (2 * math.pi * rads[0] / wraps)) for a, b in corners]
      cols = [shade(p) for p in ps]
      part.quad(ps, uvs, [(c, c, c, 1) for c in cols], [ring(a, b) for a, b in corners])

def card(part, base, along, side, uv, shade, normal, flip=False):
  """a foliage card: from `base` along `along` (the texture's bottom → top), ± `side` across"""
  u0, v0, u1, v1 = uv
  if flip: u0, u1 = u1, u0
  ps = [base - side, base + side, base + side + along, base - side + along]
  part.quad(ps, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [(c, c, c, 1) for c in map(shade, ps)], [normal(p) for p in ps])

def path_at(pts, s):
  """the point a share `s` along a polyline"""
  seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]; d = s * sum(seg)
  for i, l in enumerate(seg):
    if d <= l or i == len(seg) - 1: return pts[i].lerp(pts[i + 1], min(1.0, d / l if l else 0))
    d -= l

# ---------------------------------------------------------------- Blender objects, export
def material(name, img, alpha):
  m = bpy.data.materials.new(name); m.use_nodes = True
  nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']; tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
  nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
  if alpha: nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
  bsdf.inputs['Roughness'].default_value = 0.9
  return m

def to_object(name, part, mat):
  me = bpy.data.meshes.new(name); me.from_pydata(part.verts, [], part.faces); me.update()
  uv = me.uv_layers.new(name='UVMap'); uv.data.foreach_set('uv', [c for p in part.uv for c in p])
  col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); col.data.foreach_set('color', [c for p in part.col for c in p])
  me.color_attributes.active_color = col
  me.normals_split_custom_set(part.nrm)
  me.materials.append(mat)
  ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
  return ob

def export(path, image_format='AUTO', extras=False):
  """everything in the scene to a .glb (Y up, custom normals, the active colour attribute as COLOR_0)"""
  os.makedirs(os.path.dirname(path), exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_texcoords=True, export_normals=True,
            export_materials='EXPORT', export_image_format=image_format, export_yup=True, export_apply=False,
            export_cameras=False, export_lights=False, export_vertex_color='ACTIVE', export_extras=extras)
  print('wrote', path, os.path.getsize(path), 'bytes')

# ---------------------------------------------------------------- buildings: modelled in the game's frame
# x along the track, y up, z away from it (placeAlong in world.js); G() turns that into Blender's Z-up frame, which the
# glTF export turns back (Blender (x, y, z) → glTF (x, z, −y)).
def G(x, y, z): return Vector((x, -z, y))

def panel(part, p0, du, dv, col, cell=1.5, uv=None, nrm=None):
  """a flat rectangle p0 + s·du + t·dv (game frame), split into cells of about `cell` m (for the baked shading);
  `col` = (r, g, b) or a function of the game-frame point; facing du × dv; uv = (u0, v0, u1, v1) across the whole"""
  du, dv = Vector(du), Vector(dv); p0 = Vector(p0)
  nu, nv = max(1, round(du.length / cell)), max(1, round(dv.length / cell))
  n = nrm or du.cross(dv).normalized(); n = Vector((n.x, -n.z, n.y))
  u0, v0, u1, v1 = uv or (0, 0, 0, 0)
  for a in range(nu):
    for b in range(nv):
      corners = [(a, b), (a + 1, b), (a + 1, b + 1), (a, b + 1)]
      ps = [p0 + du * (i / nu) + dv * (j / nv) for i, j in corners]
      cs = [tuple(col(p)) if callable(col) else tuple(col) for p in ps]
      part.quad([G(*p) for p in ps], [(u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv) for i, j in corners],
                [(c[0], c[1], c[2], 1) for c in cs], [n] * 4)

def box(part, x0, x1, y0, y1, z0, z1, col, faces='xXyYzZ', cell=1.5):
  """an axis-aligned box in the game frame; faces: x = the −x side, X = +x, y = bottom, Y = top, z = the side toward
  the track (−z), Z = +z (only the faces listed)"""
  dx, dy, dz = (x1 - x0, 0, 0), (0, y1 - y0, 0), (0, 0, z1 - z0)
  nx, nz = (-(x1 - x0), 0, 0), (0, 0, -(z1 - z0))          # (each face wound to face out: du × dv)
  if 'x' in faces: panel(part, (x0, y0, z0), dz, dy, col, cell)
  if 'X' in faces: panel(part, (x1, y0, z1), nz, dy, col, cell)
  if 'y' in faces: panel(part, (x0, y0, z0), dx, dz, col, cell)
  if 'Y' in faces: panel(part, (x0, y1, z1), dx, nz, col, cell)
  if 'z' in faces: panel(part, (x1, y0, z0), nx, dy, col, cell)
  if 'Z' in faces: panel(part, (x0, y0, z1), dx, dy, col, cell)

def cylinder(part, c, axis, r, length, sides, col, caps=True, ring=None):
  """a cylinder from c along `axis` (game frame, unit), radius r; ring(k) = colour of side k (default col)"""
  c, axis = Vector(c), Vector(axis).normalized(); a = axis.orthogonal().normalized(); b = axis.cross(a)
  rim = lambda k: a * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)
  e = c + axis * length
  for k in range(sides):
    d0, d1 = rim(k), rim(k + 1); cl = ring(k) if ring else col
    ps = [c + d0 * r, c + d1 * r, e + d1 * r, e + d0 * r]
    part.quad([G(*p) for p in ps], [(0, 0)] * 4, [(*cl, 1)] * 4, [Vector((d.x, -d.z, d.y)) for d in (d0, d1, d1, d0)])
    if caps:
      for o, s, n in ((c, 1, -axis), (e, -1, axis)):
        q = [o, o + (d1 if s > 0 else d0) * r, o + (d0 if s > 0 else d1) * r, o]
        part.quad([G(*p) for p in q], [(0, 0)] * 4, [(*col, 1)] * 4, [Vector((n.x, -n.z, n.y))] * 4)

def solid_material(name):
  """a plain material for the objects that only carry vertex colours (the game makes its own per role)"""
  m = bpy.data.materials.new(name); m.use_nodes = True
  m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
  return m

def bake_ao(objs, occluders=(), distance=3.0, samples=48, strength=0.85, floor=True):
  """Cycles ambient occlusion baked into each object's colours: Col × (1 − strength·(1 − AO)). `occluders` (other
  objects, e.g. copies of a module where its neighbours stand) and a ground plane shade them too, then go."""
  sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'
  if not sc.world: sc.world = bpy.data.worlds.new('w')
  sc.world.light_settings.distance = distance
  extra = list(occluders)
  if floor:
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.06)); extra.append(bpy.context.object)   # (below floors lying at 0)
  for ob in objs:
    me = ob.data
    if not me.materials: me.materials.append(solid_material('bake'))
    ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER'); me.color_attributes.active_color = ao
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    col = me.color_attributes['Col']; n = len(col.data)
    a, c = np.zeros(n * 4), np.zeros(n * 4); ao.data.foreach_get('color', a); col.data.foreach_get('color', c)
    k = 1 - strength * (1 - a.reshape(n, 4)[:, :1]); c = c.reshape(n, 4); c[:, :3] *= k
    col.data.foreach_set('color', c.ravel()); me.color_attributes.active_color = col; me.color_attributes.remove(me.color_attributes['AO'])
    me.color_attributes.active_color = me.color_attributes['Col']
  for ob in extra: bpy.data.objects.remove(ob, do_unlink=True)
