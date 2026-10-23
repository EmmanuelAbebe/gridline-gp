# Gridline GP trees, made in Blender: `npm run models` (tools/blender/run.sh), or by hand:
#   blender -b --factory-startup --python tools/blender/trees.py -- out=src/game/models/trees.glb [preview=dir]
# Writes one .glb with every tree the scenery scatters (scenery.js): spruces for the themes' 'cone' trees, broadleaf
# trees for 'ball'. Each tree is two objects, `<name>-bark` (trunk + branches, the bark texture) and `<name>-leaves`
# (leaf / needle cards, the foliage atlas, alpha-tested in the game), origin at the foot of the trunk, metres, Y up in
# the .glb. The textures are painted here too (numpy), so the script needs nothing but Blender.
# The leaves' normals point out of the crown (not the cards' own way): lit like a volume, not a pile of flat cards.
# Vertex colours carry the shading (darker deep inside the crown and under it), a cheap baked ambient occlusion.
# preview=dir also renders the trees with Cycles to dir/trees.png (for checking without the game).
# Deterministic: the same seeds give the same trees every run.
import bpy, math, random, sys, os
import numpy as np
from mathutils import Vector, Matrix, noise

ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = os.path.abspath(ARGS.get('out', 'src/game/models/trees.glb'))
PREVIEW = ARGS.get('preview')
UP = Vector((0, 0, 1))   # (Blender is Z up; the glTF export turns it Y up)

# the trees: name, kind, numbers (heights in m)
TREES = [
  ('spruce_a', 'spruce', dict(H=19, base=2.4, reach=3.7, seed=11)),
  ('spruce_b', 'spruce', dict(H=15, base=3.6, reach=2.7, seed=23)),
  ('broad_a', 'broad', dict(H=13, wide=1.0, tall=1.0, seed=5)),
  ('broad_b', 'broad', dict(H=15, wide=0.82, tall=1.22, seed=17)),
]
ATLAS = (1024, 512)              # foliage atlas: left half a broadleaf cluster, right half a spruce spray
LEAF_UV = (0.0, 0.0, 0.5, 1.0)   # (u0, v0, u1, v1) of each half
SPRAY_UV = (0.5, 0.0, 1.0, 1.0)

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

def broadleaf_cluster(c, x0, w, h, r):
  """a cluster of leaves on a twig, growing from the bottom middle of the cell"""
  twig = (0.33, 0.27, 0.19)
  tips = []
  def branch(p, ang, length, width, depth):
    q = (p[0] + math.sin(ang) * length, p[1] - math.cos(ang) * length)
    c.segment(p, q, width, twig); tips.append((q, ang))
    for k in range(1, 4): tips.append(((p[0] + (q[0] - p[0]) * k / 4, p[1] + (q[1] - p[1]) * k / 4), ang))
    if depth:
      for da in (-0.55, 0.5): branch(q, ang + da + r.uniform(-0.2, 0.2), length * 0.62, width * 0.7, depth - 1)
  branch((x0 + w / 2, h - 4), r.uniform(-0.1, 0.1), h * 0.3, 5, 2)
  for a in (-0.9, 0.85): branch((x0 + w / 2, h * 0.72), a, h * 0.26, 4, 1)
  # leaves: the back ones first and darker, so the front ones lie over them
  leaves = []
  for _ in range(240):
    (bx, by), ang = r.choice(tips)
    leaves.append((bx + r.uniform(-10, 10), by + r.uniform(-10, 10), ang + r.uniform(-1.6, 1.6), r.uniform(0.0, 1.0)))
  leaves.sort(key=lambda l: l[3])
  for bx, by, ang, depth in leaves:
    L = r.uniform(34, 58); hue = r.uniform(-1, 1)
    col = (0.36 + 0.05 * hue, 0.52 + 0.04 * hue, 0.16 - 0.02 * hue)
    c.leaf((bx, by), ang, L, L * r.uniform(0.42, 0.55), col, 0.62 + 0.42 * depth)

def spruce_spray(c, x0, w, h, r):
  """a spruce branch tip seen from above: a twig with side twigs, dense short needles on both sides"""
  twig = (0.30, 0.22, 0.15)
  def needles(p, q, n, length):
    for k in range(n):
      t = (k + r.random()) / n; px, py = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
      ang = math.atan2(q[0] - p[0], -(q[1] - p[1]))
      L = length * (1 - 0.45 * t) * r.uniform(0.75, 1.1)
      for side in (-1, 1):
        a = ang + side * r.uniform(0.6, 1.25)
        shade = r.uniform(0.6, 1.1); col = (0.15 * shade, 0.30 * shade, 0.17 * shade)
        c.segment((px, py), (px + math.sin(a) * L, py - math.cos(a) * L), r.uniform(2.2, 3.2), col)
  base, top = (x0 + w / 2, h - 2), (x0 + w / 2 + r.uniform(-12, 12), 14)
  c.segment(base, top, 5, twig)
  for k in range(12):                                 # side twigs, alternating, shorter toward the tip
    t = 0.04 + k * 0.075; side = -1 if k % 2 else 1
    p = (base[0] + (top[0] - base[0]) * t, base[1] + (top[1] - base[1]) * t)
    L = w * 0.44 * (1 - t * 0.75); a = side * r.uniform(0.85, 1.1)
    q = (p[0] + math.sin(a) * L, p[1] - math.cos(a) * L)
    c.segment(p, q, 3, twig); needles(p, q, int(L / 2.6), 30)
    for f in (0.35, 0.65):                           # its own side twigs
      m = (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)
      for sa in (-0.8, 0.8):
        b = a + sa; l2 = L * 0.35 * (1.1 - f)
        e = (m[0] + math.sin(b) * l2, m[1] - math.cos(b) * l2); c.segment(m, e, 2.2, twig); needles(m, e, int(l2 / 2.6), 24)
  needles(base, top, int(h / 2.6), 32)

def foliage_atlas():
  r = random.Random(3); w, h = ATLAS
  c = Canvas(w, h)
  broadleaf_cluster(c, 0, w // 2, h, r)
  spruce_spray(c, w // 2, w // 2, h, r)
  return c.result()

def bark_texture(n=256):
  """tileable bark: vertical furrows that wander a little, fine grain"""
  r = np.random.default_rng(9)
  y, x = np.mgrid[0:n, 0:n] / n
  wander = sum(a * np.sin(2 * np.pi * (k * y + p)) for k, a, p in ((1, 0.05, r.random()), (2, 0.03, r.random()), (3, 0.015, r.random())))
  ridge = np.zeros_like(x)
  for k, a in ((5, 0.6), (9, 0.3), (17, 0.15)):
    ridge += a * np.abs(np.sin(np.pi * (k * (x + wander) + r.random() + 0.3 * np.sin(2 * np.pi * (2 * y + r.random())))))
  ridge /= 1.05
  grain = sum(0.5 ** o * np.sin(2 * np.pi * (2 ** o * 6 * y + 3 * np.sin(2 * np.pi * (2 ** o * x + r.random())))) for o in range(4)) * 0.04
  v = np.clip(ridge ** 0.6 + grain, 0, 1)[..., None]
  dark, light = np.array([0.16, 0.12, 0.09]), np.array([0.46, 0.39, 0.32])
  return dark + (light - dark) * v, np.ones((n, n))

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

def spruce(H, base, reach, seed):
  r = random.Random(seed); bark, leaves = Part(), Part()
  crown = lambda z: reach * max(0.0, (H - z) / (H - base)) ** 0.92   # the crown's radius at height z
  lean = Vector((r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.15), 0))
  axis = lambda z: lean * (z / H) ** 2 + Vector((0, 0, z))
  R0 = 0.019 * H
  zs = [H * (k / 14) ** 1.15 for k in range(15)]
  def bark_shade(p):   # darker inside the crown
    return 0.85 if p.z < base else 0.5 + 0.25 * (p.z / H)
  tube(bark, [axis(z) for z in zs], [R0 * (1 - z / H) ** 0.9 + 0.02 + R0 * 0.6 * math.exp(-z / 0.45) for z in zs], 8, bark_shade)
  def normal(p):       # the cone's surface normal there, a little toward the sky
    c = axis(p.z); rad = Vector((p.x - c.x, p.y - c.y, 0))
    rad = rad.normalized() if rad.length > 0.05 else Vector((1, 0, 0))
    return rad * (H - base) + UP * (reach * 1.4)
  def leaf_shade(p):
    c = axis(p.z); R = max(crown(p.z), 0.3); depth = min(1.0, math.hypot(p.x - c.x, p.y - c.y) / R)
    return (0.42 + 0.58 * depth ** 0.8) * (0.72 + 0.28 * min(1.0, max(0.0, p.z - base) / (H - base)))
  z = base * 0.85
  while z < H - 0.5:
    t = (z - base) / (H - base); n = r.randint(6, 8); az0 = r.random() * 6.283
    for j in range(n):
      az = az0 + j * 6.283 / n + r.uniform(-0.35, 0.35); L = crown(z) * r.uniform(0.82, 1.08)
      if L < 0.35: continue
      d = Vector((math.cos(az), math.sin(az), 0)); side_h = Vector((-d.y, d.x, 0))
      el0 = -0.30 + 0.62 * t                          # low branches droop, the top ones reach up
      pts = [axis(z)]
      for k in range(1, 5):                           # sags along the branch, the tip turned up a little
        el = el0 - 0.32 * (k / 4) + (0.22 if k == 4 else 0)
        pts.append(pts[-1] + (d * math.cos(el) + UP * math.sin(el)) * (L / 4))
      low = min(q.z for q in pts)
      if low < 0.35:                                  # the lowest sweep down to the grass, not into it
        k = (pts[0].z - 0.35) / (pts[0].z - low)
        pts = [Vector((q.x, q.y, pts[0].z + (q.z - pts[0].z) * k)) for q in pts]
      if L > 1.6 and j % 2 == 0: tube(bark, pts[::2], [0.012 * L + 0.02, 0.006 * L + 0.01, 0.004], 3, lambda p: 0.45)
      m = max(1, round(L / 1.05))
      for q in range(m):                              # needle sprays: two crossed cards per stretch
        s0, s1 = q / m, (q + 1) / m
        p0, p1 = path_at(pts, max(0.0, s0 - 0.12)), path_at(pts, min(1.0, s1 + 0.12))
        hw = (0.55 + 0.3 * (1 - s0)) * min(1.0, 0.45 + L / 3)
        for roll in (0.5, -0.5):                       # a shallow tent over the branch
          side = (side_h * math.cos(roll) - UP * math.sin(roll) * (1 if roll > 0 else -1)) * hw
          card(leaves, p0, p1 - p0, side, SPRAY_UV, leaf_shade, normal, flip=r.random() < 0.5)
        hang = (p1 - p0).length * 0.8
        if L > 0.9 and min(p0.z, p1.z) - hang > 0.4:             # and a curtain of twigs hanging under it
          card(leaves, (p0 + p1) / 2 - UP * hang * 0.15 + side_h * 0.0, -UP * hang + (p1 - p0) * 0.2, (p1 - p0).normalized() * hw * 0.8,
               SPRAY_UV, leaf_shade, normal, flip=r.random() < 0.5)
    z += r.uniform(0.42, 0.6) * (1 - 0.35 * t)
  top = axis(H - 1.3)                                 # the leader at the top
  for k in range(3):
    a = k * math.pi / 3; side = Vector((math.cos(a), math.sin(a), 0)) * 0.32
    card(leaves, top, axis(H) - top + UP * 0.2, side, SPRAY_UV, leaf_shade, normal)
  return bark, leaves

def path_at(pts, s):
  """the point a share `s` along a polyline"""
  seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]; d = s * sum(seg)
  for i, l in enumerate(seg):
    if d <= l or i == len(seg) - 1: return pts[i].lerp(pts[i + 1], min(1.0, d / l if l else 0))
    d -= l

def broad(H, wide, tall, seed):
  r = random.Random(seed); bark, leaves = Part(), Part()
  C = Vector((0, 0, 0.6 * H * (1 + 0.1 * (tall - 1)))); A, B = 0.36 * H * wide, 0.32 * H * tall
  off = Vector((seed * 1.7, seed * 0.3, seed * 2.9))
  lump = lambda d: 1 + 0.14 * noise.noise(d * 1.8 + off)          # a lumpy crown, not an ellipsoid
  def local(p): q = p - C; return Vector((q.x / A, q.y / A, q.z / B))
  def normal(p):       # out of the crown (its ellipsoid), a little toward the sky
    q = local(p); return Vector((q.x / A, q.y / A, q.z / B)).normalized() + UP * 0.25
  def shade(p):
    q = local(p); depth = min(1.0, q.length)
    under = max(0.0, -q.z / max(q.length, 1e-6))
    return (0.38 + 0.62 * depth ** 1.6) * (1 - 0.3 * under)
  # the trunk splits into limbs, each into branches, aimed at the crown's outside
  R0 = 0.026 * H; Hs = 0.3 * H * (1 + 0.2 * (tall - 1))
  lean = Vector((r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), 0))
  zs = [Hs * k / 6 for k in range(7)]
  pts = [Vector((0, 0, z)) + lean * (z / Hs) ** 2 for z in zs]
  tube(bark, pts, [R0 * (1 - 0.25 * z / Hs) + R0 * 0.7 * math.exp(-z / 0.4) for z in zs], 8, lambda p: 0.8 if p.z < Hs * 0.6 else 0.6)
  tips = []
  def grow(p, d, length, rad, depth):
    pts = [p]
    for k in range(1, 4):
      d = (d + Vector((r.uniform(-0.12, 0.12), r.uniform(-0.12, 0.12), r.uniform(-0.05, 0.1)))).normalized()
      pts.append(pts[-1] + d * (length / 3))
    tube(bark, pts, [rad, rad * 0.85, rad * 0.72, rad * 0.62], max(3, 6 - 2 * (2 - depth)) if depth > 0 else 3, lambda p: 0.55)
    end = pts[-1]
    if depth == 0 or rad < 0.03: tips.append(end); return
    for _ in range(r.randint(2, 3)):
      out = (end - C); out.z *= 0.6
      nd = (d * 0.55 + out.normalized() * 0.45 + Vector((r.uniform(-0.5, 0.5), r.uniform(-0.5, 0.5), r.uniform(-0.1, 0.4)))).normalized()
      grow(end, nd, length * r.uniform(0.58, 0.72), rad * 0.6, depth - 1)
  n = r.randint(3, 4); az0 = r.random() * 6.283
  for j in range(n):
    az = az0 + j * 6.283 / n + r.uniform(-0.4, 0.4); el = r.uniform(0.75, 1.05)
    grow(pts[-1], Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))), 0.22 * H * wide, R0 * 0.62, 2)
  # leaf clusters: over the crown's (lumpy) shell, mostly near its outside, and round every branch tip
  spots, N = [], 300
  for k in range(N):
    zz = 1 - 2 * (k + 0.5) / N; rr = math.sqrt(1 - zz * zz); a = k * 2.39996 + r.uniform(-0.2, 0.2)
    d = Vector((rr * math.cos(a), rr * math.sin(a), zz))
    if d.z < -0.75: continue                            # (the underside is open: the branches show)
    f = lump(d) * r.uniform(0.7, 1.0) ** 0.5
    spots.append(C + Vector((d.x * A, d.y * A, d.z * B)) * f)
  for t in tips: spots += [t + Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.5, 1))) for _ in range(2)]
  S = 2.1 * H / 13
  for p in spots:
    s = S * r.uniform(0.8, 1.2)
    nrm = (normal(p).normalized() + Vector((r.uniform(-0.7, 0.7), r.uniform(-0.7, 0.7), r.uniform(-0.5, 0.5)))).normalized()
    up = (UP - nrm * nrm.dot(UP)); up = up.normalized() if up.length > 0.1 else nrm.orthogonal().normalized()
    up = Matrix.Rotation(r.uniform(-0.6, 0.6), 3, nrm) @ up
    card(leaves, p - up * (s * 0.45), up * s, nrm.cross(up) * (s / 2), LEAF_UV, shade, normal, flip=r.random() < 0.5)
  return bark, leaves

# ---------------------------------------------------------------- Blender scene, export
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

def main():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  atlas = to_image('foliage', *foliage_atlas()); bark_img = to_image('bark', *bark_texture())
  m_bark, m_leaves = material('bark', bark_img, False), material('leaves', atlas, True)
  objs = []
  for name, kind, p in TREES:
    b, l = (spruce if kind == 'spruce' else broad)(**p)
    objs += [to_object(name + '-bark', b, m_bark), to_object(name + '-leaves', l, m_leaves)]
    print(f'{name}: {len(b.faces) * 2} bark + {len(l.faces) * 2} leaf triangles')
  os.makedirs(os.path.dirname(OUT), exist_ok=True)
  kw = dict(filepath=OUT, export_format='GLB', use_selection=False, export_texcoords=True, export_normals=True,
            export_materials='EXPORT', export_image_format='AUTO', export_yup=True, export_apply=False,
            export_cameras=False, export_lights=False, export_vertex_color='ACTIVE')
  bpy.ops.export_scene.gltf(**kw)
  print('wrote', OUT, os.path.getsize(OUT), 'bytes')
  if PREVIEW: preview(objs, m_bark, m_leaves)

def preview(objs, m_bark, m_leaves):
  """the four trees in a row on a lawn, rendered with Cycles"""
  sc = bpy.context.scene
  for m in (m_bark, m_leaves):                         # (the shading colours multiply in, as in the game)
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']; tex = [n for n in nt.nodes if n.type == 'TEX_IMAGE'][0]
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    nt.links.new(tex.outputs['Color'], mix.inputs['A']); nt.links.new(va.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
  for k, name in enumerate(dict.fromkeys(o.name.split('-')[0] for o in objs)):
    for o in objs:
      if o.name.split('-')[0] == name: o.location.x = k * 13 - 20
  bpy.ops.mesh.primitive_plane_add(size=200)
  g = bpy.data.materials.new('grass'); g.use_nodes = True; g.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.16, 0.04, 1)
  bpy.context.object.data.materials.append(g)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(46), 0, math.radians(35))
  sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.6, 0.85, 1)
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.location = (0, -48, 7); cam.rotation_euler = (math.radians(86), 0, 0)
  cam.data.lens = 30; sc.collection.objects.link(cam); sc.camera = cam
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
  sc.cycles.transparent_max_bounces = 128
  for img in bpy.data.images:                           # the textures too
    if img.size[0]: img.filepath_raw = os.path.join(os.path.abspath(PREVIEW), img.name + '.png'); img.save()
  sc.render.resolution_x, sc.render.resolution_y = 1600, 800
  os.makedirs(PREVIEW, exist_ok=True); sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), 'trees.png')
  bpy.ops.render.render(write_still=True)

main()
