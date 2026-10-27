# Our own procedural 2026 car (the fallback; the game's car.glb comes from qvist.py): tools/blender/run.sh car_own [style=a|b|c|d] [preview=dir] [ao=0]
# → tools/blender/out/car_own.glb (not loaded by the game)
# Phases 1–2 of docs/car-plan.md (2026-10-26): the blockout, then the body (one skin with the cockpit and inlets cut in). Every main part in its place and to the 2026 measurements,
# with the objects the game drives (the contract in docs/car-plan.md):
#   wheel_fl / _fr / _rl / _rr   empties at the axle centres (the game spins them about z, steers the fronts about y),
#                                tyre_* and rim_* inside
#   fw_flap1, fw_flap2, rw_flap  active-aero elements, origin on the hinge, extras open = degrees in straight mode
#   steer                        the steering wheel's centre (turns about x), with grip_l / grip_r / screen empties
#   eye, seat                    the driver's eye and seat
#   mirror_glass_l / _r          thin boxes, the game draws the mirror picture on their back face
#   rain_light, ep_light_l / _r  brake lights (material light)
# Game frame (kit.G): x forward, y up, z right, metres, origin on the ground under the middle of the wheelbase.
# Materials = roles: paint_main, paint_accent, carbon, rubber, metal, light, glass, dark (inlets, the cockpit floor).
# Every mesh carries a Col colour attribute: Cycles AO baked in (kit.bake_ao; ao=0 skips it), the game multiplies it.
import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import args, G, frames, export, bake_ao
from mathutils import Vector

ARGS = args()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'car_own.glb')
PREVIEW = ARGS.get('preview')

# ---------------------------------------------------------------- the 2026 measurements (docs/car-plan.md)
WHEELBASE = 3.40
XF, XR = WHEELBASE / 2, -WHEELBASE / 2          # axles
R_TYRE = 0.36                                    # 720 mm tyres
W_FRONT, W_REAR = 0.275, 0.375                   # tyre widths
WIDTH = 1.90                                     # over the rear tyres
ZF = 0.80                                        # front wheel centres (outer face 0.94)
ZR = WIDTH / 2 - W_REAR / 2                      # rear wheel centres (0.7625)
EYE = (-0.15, 0.90, 0.0)                         # the driver's eye (the helmet's visor; the cockpit camera follows it from phase 5)
STEER = (0.30, 0.74, 0.0)                        # steering wheel centre

COLOURS = {   # preview / glTF base colours (the game sets its own per role and the livery)
  'paint_main': (0.05, 0.16, 0.55), 'paint_accent': (1.0, 0.72, 0.05), 'carbon': (0.035, 0.035, 0.04),
  'rubber': (0.02, 0.02, 0.022), 'metal': (0.55, 0.56, 0.58), 'light': (0.5, 0.03, 0.02), 'glass': (0.2, 0.25, 0.3),
  'dark': (0.01, 0.01, 0.012),
}
MATS = {}
def mat(role):
  if role not in MATS:
    m = bpy.data.materials.new(role); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*COLOURS[role], 1)
    b.inputs['Roughness'].default_value = 0.35 if role.startswith('paint') else 0.8
    MATS[role] = m
  return MATS[role]

# ---------------------------------------------------------------- meshes in the game frame
class Mesh:
  def __init__(self): self.v, self.f = [], []
  def grid(self, rings, closed=True, caps=True):
    """rings: lists of the same number of game-frame points; quads between neighbours; closed = each ring is a loop"""
    K, base = len(rings[0]), len(self.v)
    for r in rings: self.v += [tuple(p) for p in r]
    for i in range(len(rings) - 1):
      for k in range(K if closed else K - 1):
        a, b = base + i * K + k, base + i * K + (k + 1) % K
        self.f.append((a, b, b + K, a + K))
    if caps and closed:
      self.f.append(tuple(base + k for k in reversed(range(K))))
      self.f.append(tuple(base + (len(rings) - 1) * K + k for k in range(K)))
    return self

def section(x, yc, hw, hh, e=2.6, k=28, zc=0.0, bottom=None):
  """a superellipse ring across the car at x (half width hw, half height hh, exponent e: 2 = ellipse, big = box);
  bottom = a flat floor at that height"""
  out = []
  for i in range(k):
    t = 2 * math.pi * i / k; c, s = math.cos(t), math.sin(t)
    z = zc + hw * math.copysign(abs(c) ** (2 / e), c); y = yc + hh * math.copysign(abs(s) ** (2 / e), s)
    if bottom is not None: y = max(y, bottom)
    out.append((x, y, z))
  return out

def airfoil(stations, chord, thick=0.12, camber=0.05, k=18):
  """a wing along z: stations [(z, x_le, y_le, chord ×, pitch°)], the profile from the leading edge back (−x);
  pitch + = trailing edge up"""
  rings = []
  ts = [0.5 - 0.5 * math.cos(math.pi * i / (k - 1)) for i in range(k)]            # LE → TE, dense at both ends
  for z, xle, yle, cs, pitch in stations:
    c, p = chord * cs, math.radians(pitch); pts = []
    for side, along in ((1, ts), (-1, ts[::-1][1:-1])):                             # upper LE → TE, lower back to LE
      for t in along:
        th = 5 * thick * (0.2969 * math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4)
        u, v = -t * c, (camber * 4 * t * (1 - t) + side * th) * c                   # back along −x, up
        pts.append((xle + u * math.cos(p) + v * math.sin(p), yle - u * math.sin(p) + v * math.cos(p), z))
    rings.append(pts)
  return Mesh().grid(rings)

def tube(points, r, sides=10, flat=1.0):
  """a tube along game-frame points, radius r (flat < 1 squashes it vertically: a streamlined arm)"""
  P = [Vector(p) for p in points]; F = frames(P); rings = []
  for p, (t, n, b) in zip(P, F):
    rings.append([tuple(p + n * (r * math.cos(2 * math.pi * s / sides)) + b * (r * flat * math.sin(2 * math.pi * s / sides))) for s in range(sides)])
  return Mesh().grid(rings)

def lathe(profile, sides=40):
  """revolved about the z axis through the origin: profile [(radius, z)]"""
  rings = [[(r * math.cos(2 * math.pi * s / sides), r * math.sin(2 * math.pi * s / sides), z) for s in range(sides)] for r, z in profile]
  return Mesh().grid(rings, caps=False)

def boxmesh(x0, x1, y0, y1, z0, z1):
  rings = [[(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)] for x in (x0, x1)]
  return Mesh().grid(rings)

# ---------------------------------------------------------------- Blender objects
def obj(name, mesh, role, at=(0, 0, 0), parent=None, sharp=40, **extras):
  """a Blender object from a game-frame mesh; `at` = its origin (game frame, world); extras → glTF extras"""
  o = Vector(at)
  me = bpy.data.meshes.new(name); me.from_pydata([G(*(Vector(p) - o)) for p in mesh.v], [], mesh.f); me.update()
  me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
  me.set_sharp_from_angle(angle=math.radians(sharp))
  col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); col.data.foreach_set('color', [1.0] * (len(col.data) * 4))
  me.color_attributes.active_color = col
  me.materials.append(mat(role))
  ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
  place(ob, o, parent)
  for k, v in extras.items(): ob[k] = v
  return ob

def empty(name, at, parent=None, **extras):
  ob = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(ob)
  ob.empty_display_size = 0.05; place(ob, Vector(at), parent)
  for k, v in extras.items(): ob[k] = v
  return ob

def place(ob, at, parent):
  if parent: ob.parent = parent; ob.location = G(*(at - Vector(parent['at'])))
  else: ob.location = G(*at)
  ob['at'] = list(at)

def both(fn):
  """build a left/right pair: fn(side) with side = −1 (left) / +1 (right)"""
  return [fn(-1, 'l'), fn(1, 'r')]

# ---------------------------------------------------------------- phase 2 tools: smooth lofts, plates, booleans
def smooth(keys, x):
  """the key values at x: cubic Hermite through keys [(x, a, b, ...)] (x falling), tangents from the neighbours"""
  xs = [k[0] for k in keys]
  if x >= xs[0]: return list(keys[0][1:])
  if x <= xs[-1]: return list(keys[-1][1:])
  i = next(j for j in range(len(xs) - 1) if xs[j] >= x >= xs[j + 1])
  x0, x1 = xs[i], xs[i + 1]; t = (x - x0) / (x1 - x0); h = x1 - x0
  def tan(j, c):
    a, b = max(0, j - 1), min(len(keys) - 1, j + 1)
    return (keys[b][c] - keys[a][c]) / (xs[b] - xs[a])
  out = []
  for c in range(1, len(keys[0])):
    p0, p1, m0, m1 = keys[i][c], keys[i + 1][c], tan(i, c) * h, tan(i + 1, c) * h
    out.append((2*t**3 - 3*t*t + 1) * p0 + (t**3 - 2*t*t + t) * m0 + (-2*t**3 + 3*t*t) * p1 + (t**3 - t*t) * m1)
  return out

def body_loft(keys, step=0.05, k=36, bottom=None):
  """a smooth body through key sections [(x, yc, hw, hh, e, zc)] from the front back"""
  x0, x1 = keys[0][0], keys[-1][0]; n = max(2, round((x0 - x1) / step))
  rings = []
  for i in range(n + 1):
    x = x0 + (x1 - x0) * i / n; yc, hw, hh, e, zc = smooth(keys, x)
    rings.append(section(x, yc, max(hw, 0.004), max(hh, 0.004), e=max(e, 2), k=k, zc=zc, bottom=bottom))
  return Mesh().grid(rings)

def plate(profile, z, thick):
  """a flat plate: a side-view outline [(x, y)] (convex, either winding) at z, `thick` across"""
  ring0 = [(x, y, z - thick / 2) for x, y in profile]; ring1 = [(x, y, z + thick / 2) for x, y in profile]
  return Mesh().grid([ring0, ring1])

def boolean(target, cutter, op='DIFFERENCE'):
  """target ± cutter (Blender's exact solver; the cutter's faces keep its material), the cutter removed"""
  if cutter.data.materials[0].name not in [m.name for m in target.data.materials]: target.data.materials.append(cutter.data.materials[0])
  m = target.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
  try: m.material_mode = 'TRANSFER'
  except (AttributeError, TypeError): pass
  bpy.context.view_layer.objects.active = target; bpy.ops.object.modifier_apply(modifier=m.name)
  bpy.data.objects.remove(cutter, do_unlink=True)

def resmooth(ob, sharp=40):
  me = ob.data; me.polygons.foreach_set('use_smooth', [True] * len(me.polygons)); me.set_sharp_from_angle(angle=math.radians(sharp))

# ---------------------------------------------------------------- the car
# Measured from the FIA's 2026 renders (2026-10-26, docs/car-plan.md): side view 275 px/m, top view 232 px/m, heights
# above the ground, half widths. Four styles on the same measured base (style=a|b|c|d), for the user to pick from:
#   a CONCEPT   the FIA car's own lines: high broad nose, wide downwash sidepods, crescent front wing
#   b SLIM      narrow sidepods with tall inlets, a wide exposed floor
#   c BATHTUB   high-shouldered sidepods with a channel along the top
#   d RAMP      a lower nose, sidepods ramping steeply down to the floor
STYLE = os.path.basename(ARGS.get('style', 'a'))        # (run.sh turns every value into a path)
P = {'a': dict(nose=0.0, pod_w=1.0, pod_drop=1.0, inlet_h=1.0, tub=False),
     'b': dict(nose=0.0, pod_w=0.55, pod_drop=0.8, inlet_h=1.9, tub=False),
     'c': dict(nose=0.0, pod_w=1.0, pod_drop=0.55, inlet_h=0.9, tub=True),
     'd': dict(nose=-0.13, pod_w=0.95, pod_drop=2.0, inlet_h=0.8, tub=False)}[STYLE]

def k6(x, top, bottom, hw, e, zc=0.0):
  """a key section from its top and bottom heights"""
  return (x, (top + bottom) / 2, hw, (top - bottom) / 2, e, zc)

def bevel(ob, width=0.012, segments=3, angle=32):
  """rounds every edge sharper than `angle` (the joins the booleans leave): fillets"""
  m = ob.modifiers.new('bevel', 'BEVEL'); m.width = width; m.segments = segments; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
  m.harden_normals = False
  bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier=m.name)

def build():
  objs = []
  n0 = P['nose']
  nose_lift = lambda x: n0 * max(0.0, min(1.0, (x - 1.2) / 1.5))          # (style d: the nose dropping toward the tip)
  tub = [k6(2.88, 0.40 + nose_lift(2.88), 0.31 + nose_lift(2.88), 0.060, 2.2), k6(2.65, 0.46 + nose_lift(2.65), 0.285 + nose_lift(2.65), 0.105, 2.4),
         k6(2.35, 0.53 + nose_lift(2.35), 0.26 + nose_lift(2.35), 0.140, 2.6), k6(2.05, 0.615 + nose_lift(2.05), 0.24 + nose_lift(2.05), 0.155, 2.8),
         k6(1.70, 0.68, 0.22, 0.180, 3.0), k6(1.30, 0.74, 0.20, 0.210, 3.2), k6(0.90, 0.77, 0.18, 0.245, 3.4),
         k6(0.50, 0.79, 0.16, 0.270, 3.4), k6(0.00, 0.80, 0.15, 0.290, 3.4), k6(-0.35, 0.86, 0.15, 0.290, 3.2), k6(-0.55, 0.92, 0.15, 0.285, 3.0)]
  cover = [k6(-0.30, 0.93, 0.30, 0.230, 3.0), k6(-0.75, 0.985, 0.36, 0.165, 2.5), k6(-1.15, 0.92, 0.36, 0.120, 2.3),
           k6(-1.50, 0.85, 0.30, 0.085, 2.2), k6(-1.80, 0.74, 0.26, 0.065, 2.2), k6(-2.06, 0.56, 0.24, 0.055, 2.2)]
  airbox = [k6(-0.10, 1.05, 0.93, 0.065, 2.2), k6(-0.25, 1.065, 0.91, 0.110, 2.3), k6(-0.45, 1.05, 0.86, 0.125, 2.4),
            k6(-0.80, 1.00, 0.78, 0.100, 2.5), k6(-1.10, 0.93, 0.74, 0.060, 2.4)]
  W, D = P['pod_w'], P['pod_drop']
  def pod(s):
    out = []
    for x, outer, top, bottom, e in ((0.74, 0.50, 0.69, 0.52, 3.0), (0.66, 0.64, 0.72, 0.44, 3.4), (0.45, 0.69, 0.73, 0.36, 3.6), (0.20, 0.73, 0.71, 0.32, 3.5),
                                     (-0.17, 0.71, 0.66, 0.30, 3.3), (-0.56, 0.62, 0.58, 0.26, 3.0), (-0.95, 0.47, 0.51, 0.22, 2.8),
                                     (-1.21, 0.31, 0.46, 0.20, 2.6), (-1.42, 0.14, 0.40, 0.20, 2.4)):
      inner = 0.20
      o = inner + (outer - inner) * W
      drop = (0.72 - top) * (D - 1)                                           # style: a steeper or gentler downwash
      out.append(k6(x, max(bottom + 0.06, top - drop), bottom, (o - inner) / 2 + 0.06, e, s * ((o + inner) / 2 - 0.03)))
    return out
  body = obj('body', body_loft(tub, bottom=0.07), 'paint_main', sharp=50)
  for name, keys in (('cover', cover), ('airbox', airbox), ('pod_l', pod(-1)), ('pod_r', pod(1))):
    boolean(body, obj(name, body_loft(keys), 'paint_main'), 'UNION')
  bevel(body, 0.03, 4, 28)                                                       # the joins flow into each other
  ih = 0.075 * P['inlet_h']
  pz = lambda s: s * (0.20 + (0.70 - 0.20) * W) / 2 + s * 0.10
  cuts = [('cockpit', [k6(0.50, 1.20, 0.60, 0.20, 4.0), k6(0.35, 1.20, 0.58, 0.235, 4.5), k6(-0.12, 1.20, 0.58, 0.245, 4.5), k6(-0.24, 1.20, 0.60, 0.21, 4.0)]),
          ('airbox_in', [k6(-0.05, 1.03, 0.94, 0.05, 2.2), k6(-0.35, 1.03, 0.94, 0.05, 2.2)]),
          ('outlet', [k6(-1.95, 0.52, 0.42, 0.04, 2.2), k6(-2.30, 0.52, 0.42, 0.04, 2.2)])]
  for s, n in ((-1, 'l'), (1, 'r')):
    cuts.append((f'inlet_{n}', [k6(0.80, 0.69 + ih * 0.2, 0.69 - ih * 1.8, 0.13 * W + 0.03, 4.0, pz(s)), k6(0.42, 0.69 + ih * 0.2, 0.69 - ih * 1.8, 0.13 * W + 0.03, 4.0, pz(s))]))
    if P['tub']:   # the bathtub: a channel along the top of the sidepod
      cuts.append((f'tub_{n}', [k6(0.40, 0.90, 0.62, 0.11, 3.0, s * 0.50), k6(0.0, 0.88, 0.60, 0.12, 3.0, s * 0.50), k6(-0.50, 0.80, 0.52, 0.10, 3.0, s * 0.44), k6(-1.00, 0.70, 0.46, 0.05, 2.6, s * 0.33)]))
  for name, keys in cuts: boolean(body, obj(name, body_loft(keys, step=0.04), 'dark' if not name.startswith('tub') else 'paint_main'))
  bevel(body, 0.008, 2, 50)                                                      # soft lips on the openings
  resmooth(body, 45); objs.append(body)
  objs.append(obj('headrest', body_loft([k6(-0.16, 0.86, 0.74, 0.23, 3), k6(-0.30, 0.90, 0.74, 0.23, 3)], step=0.03), 'carbon'))
  objs.append(obj('seat_back', plate([(-0.26, 0.55), (-0.21, 0.55), (-0.23, 0.80), (-0.28, 0.80)], 0, 0.40), 'dark'))
  objs.append(obj('tcam', body_loft([k6(-0.18, 1.10, 1.07, 0.02, 2.2), k6(-0.26, 1.12, 1.08, 0.075, 2.6), k6(-0.36, 1.115, 1.075, 0.075, 2.6)], step=0.02), 'paint_accent'))
  # ---- floor (1.55 m wide), the wheel-wake boards ahead of the sidepods, the diffuser
  fl = [(1.02, 0.55), (0.86, 0.76), (-1.25, 0.77), (-1.36, 0.60), (-1.45, 0.56)]
  rings = [[(x, 0.035, -hw), (x, 0.035, hw), (x, 0.055, hw), (x, 0.055, -hw)] for x, hw in fl]
  floor = obj('floor', Mesh().grid(rings), 'carbon', sharp=30); bevel(floor, 0.008, 2, 30); objs.append(floor)
  for s, n in ((-1, 'l'), (1, 'r')):
    objs.append(obj(f'floor_edge_{n}', plate([(0.80, 0.055), (-1.22, 0.055), (-1.22, 0.10), (0.40, 0.12), (0.80, 0.075)], s * 0.765, 0.012), 'carbon'))
    board = plate([(1.08, 0.055), (0.74, 0.055), (0.72, 0.30), (0.90, 0.34), (1.06, 0.20)], 0, 0.014)
    board.v = [(x, y, s * (0.80 - (1.08 - x) * 0.25) + z) for x, y, z in board.v]
    objs.append(obj(f'wake_board_{n}', board, 'carbon'))
  dif = [(-1.45, 0.055, 0.56), (-1.70, 0.10, 0.55), (-1.92, 0.20, 0.54), (-2.06, 0.27, 0.53)]
  rings = [[(x, yb, -hw), (x, yb, hw), (x, yb + 0.02, hw), (x, yb + 0.02, -hw)] for x, yb, hw in dif]
  objs.append(obj('diffuser', Mesh().grid(rings), 'carbon', sharp=25))
  for z in (-0.50, -0.26, 0.26, 0.50):
    objs.append(obj(f'strake_{"lr"[z > 0]}{abs(round(z * 4))}', plate([(-1.45, 0.04), (-2.06, 0.04), (-2.06, 0.29), (-1.45, 0.06)], z, 0.01), 'carbon'))
  # ---- halo: the hoop round the head on two rear mounts, a faired centre pillar (top 0.97 m)
  def halo_side(s, n):
    pts = [(0.48, 0.965, 0.0), (0.38, 0.97, s * 0.15), (0.20, 0.965, s * 0.25), (-0.02, 0.945, s * 0.275), (-0.14, 0.89, s * 0.28), (-0.20, 0.82, s * 0.28), (-0.22, 0.76, s * 0.28)]
    return obj(f'halo_{n}', tube(pts, 0.027, sides=14, flat=0.75), 'paint_main')
  objs += both(halo_side)
  objs.append(obj('halo_pillar', tube([(0.70, 0.76, 0), (0.62, 0.86, 0), (0.55, 0.93, 0), (0.48, 0.965, 0)], 0.025, sides=12, flat=0.6), 'paint_main'))
  # ---- front wing: a crescent (the middle forward, the tips swept back), rising to the nose in the middle, low at
  # mid-span, up again at the endplates; the two-element flap that opens in straight mode
  span = 0.87
  def fw_y(z):
    a = abs(z)
    return 0.27 - 0.17 * min(1.0, a / 0.30) + 0.10 * max(0.0, (a - 0.55) / 0.32) ** 2
  fw_x = lambda z: 2.86 - 0.28 * (abs(z) / span) ** 2
  zs = [-span, -0.80, -0.70, -0.58, -0.45, -0.34, -0.25, -0.15, 0, 0.15, 0.25, 0.34, 0.45, 0.58, 0.70, 0.80, span]
  objs.append(obj('fw_main', airfoil([(z, fw_x(z), fw_y(z), 1.0, 3) for z in zs], 0.30, camber=0.06), 'carbon'))
  for k, (back, up, ch, pitch, open_) in enumerate(((0.27, 0.035, 0.19, 15, 11), (0.42, 0.095, 0.15, 30, 20)), 1):
    xh, yh = fw_x(0) - back, fw_y(0.5) + up
    flap = airfoil([(z, fw_x(z) - back, fw_y(z) + up, 1.0, pitch) for z in zs[1:-1]], ch, camber=0.07)
    objs.append(obj(f'fw_flap{k}', flap, 'paint_accent' if k == 2 else 'carbon', at=(xh, yh, 0), open=open_))
  for s, n in ((-1, 'l'), (1, 'r')):
    objs.append(obj(f'fw_endplate_{n}', plate([(2.62, 0.035), (2.30, 0.035), (2.26, 0.09), (2.30, 0.24), (2.40, 0.275), (2.52, 0.25), (2.62, 0.14)], s * (span + 0.006), 0.010), 'paint_accent'))
    objs.append(obj(f'fw_pylon_{n}', plate([(2.80, 0.23), (2.55, 0.22), (2.50, 0.32), (2.76, 0.33)], s * 0.07, 0.01), 'carbon'))
  # ---- rear wing (2026: a three-element wing, simple tall endplates, no beam wing): main plane + two flaps that open
  rw = 0.60
  spoon = lambda z: -0.03 * (1 - (z / rw) ** 2)
  rzs = (-rw, -0.42, -0.2, 0, 0.2, 0.42, rw)
  objs.append(obj('rw_main', airfoil([(z, -2.04, 0.80 + spoon(z), 1.0, 7) for z in rzs], 0.26, camber=0.08), 'carbon'))
  objs.append(obj('rw_flap', airfoil([(z, -2.27, 0.875 + spoon(z) * 0.6, 1.0, 26) for z in rzs], 0.17, camber=0.08), 'paint_accent', at=(-2.27, 0.875, 0), open=20))
  objs.append(obj('rw_flap2', airfoil([(z, -2.40, 0.945 + spoon(z) * 0.4, 1.0, 40) for z in rzs], 0.12, camber=0.08), 'carbon', at=(-2.40, 0.945, 0), open=26))
  for s, n in ((-1, 'l'), (1, 'r')):
    objs.append(obj(f'rw_endplate_{n}', plate([(-2.00, 0.55), (-1.99, 0.93), (-2.03, 0.98), (-2.12, 1.00), (-2.42, 1.00), (-2.50, 0.96), (-2.52, 0.88), (-2.52, 0.62), (-2.44, 0.50), (-2.14, 0.48)],
                    s * (rw + 0.008), 0.012), 'paint_main'))
    objs.append(obj(f'ep_light_{n}', boxmesh(-2.528, -2.516, 0.64, 0.90, s * (rw + 0.008) - 0.004, s * (rw + 0.008) + 0.004), 'light'))
  objs.append(obj('rw_pylon', plate([(-1.92, 0.50), (-2.02, 0.48), (-2.18, 0.80), (-2.08, 0.82)], 0, 0.014), 'carbon'))
  objs.append(obj('crash_structure', body_loft([k6(-1.95, 0.50, 0.24, 0.08, 3), k6(-2.25, 0.46, 0.28, 0.06, 3), k6(-2.48, 0.42, 0.30, 0.04, 2.6)], step=0.04), 'carbon'))
  objs.append(obj('rain_light', boxmesh(-2.495, -2.475, 0.33, 0.39, -0.03, 0.03), 'light'))
  # ---- suspension: wishbones (two legs to the upright), push rods at the front, pull rods at the rear, track rods
  def arms(s, n):
    out = []
    for tag, x, z0, zw, yi_up in (('f', XF, 0.17, ZF - W_FRONT / 2 - 0.03, 0.56), ('r', XR, 0.13, ZR - W_REAR / 2 - 0.03, 0.46)):
      for lvl, yi, yo in (('up', yi_up, 0.56), ('lo', 0.26, 0.17)):
        pts = [(x + 0.34, yi, s * z0), (x, yo, s * zw), (x - 0.30, yi, s * z0)]
        out.append(obj(f'arm_{tag}{lvl}_{n}', tube(pts, 0.018, sides=8, flat=0.35), 'carbon'))
      rod = [(x - 0.02, 0.19, s * zw), (x - 0.14, 0.58, s * z0)] if tag == 'f' else [(x + 0.02, 0.54, s * zw), (x + 0.16, 0.22, s * z0)]
      out.append(obj(f'rod_{tag}_{n}', tube(rod, 0.013, sides=8), 'carbon'))
      tx = x + (0.12 if tag == 'f' else -0.12)
      out.append(obj(f'track_{tag}_{n}', tube([(tx, 0.40, s * (z0 + 0.02)), (tx, 0.38, s * zw)], 0.012, sides=8, flat=0.5), 'carbon'))
    return out
  for side in both(arms): objs += side
  # ---- mirrors: wide on stalks from the sidepod fronts (FIA render), the glass facing back
  def mirror(s, n):
    z = s * 0.64
    house = obj(f'mirror_{n}', body_loft([k6(0.70, 0.84, 0.80, 0.03, 2.2, z), k6(0.66, 0.86, 0.78, 0.09, 2.8, z), k6(0.61, 0.865, 0.775, 0.092, 3.2, z)], step=0.012), 'paint_main')
    stalk = obj(f'mirror_stalk_{n}', plate([(0.68, 0.70), (0.63, 0.70), (0.635, 0.79), (0.665, 0.79)], s * 0.62, 0.008), 'carbon')
    glass = obj(f'mirror_glass_{n}', boxmesh(0.606, 0.609, 0.785, 0.855, z - 0.085, z + 0.085), 'glass', at=(0.6075, 0.82, z))
    return [house, stalk, glass]
  for side in both(mirror): objs += side
  # ---- the driver: helmet (centre 0.88 m) with its visor, the eye, the seat; the steering wheel, grips and screen
  objs.append(obj('helmet', body_loft([k6(-0.06, 0.92, 0.84, 0.05, 2.1), k6(-0.10, 1.005, 0.755, 0.115, 2.1), k6(-0.20, 1.02, 0.74, 0.135, 2.1),
                  k6(-0.31, 1.00, 0.77, 0.115, 2.1), k6(-0.36, 0.93, 0.83, 0.05, 2.1)], step=0.02), 'paint_accent', show='outside'))
  objs.append(obj('visor', body_loft([k6(-0.075, 0.935, 0.875, 0.07, 2.4), k6(-0.11, 0.94, 0.87, 0.11, 2.4)], step=0.01), 'glass', show='outside'))
  empty('eye', EYE); empty('seat', (-0.30, 0.30, 0))
  steer = empty('steer', STEER)
  objs.append(obj('steer_wheel', Mesh().grid([section(x, STEER[1], 0.135, 0.075, e=4) for x in (STEER[0] + 0.025, STEER[0] - 0.025)]), 'carbon', at=STEER, parent=steer))
  for n, z in (('l', -0.135), ('r', 0.135)): empty(f'grip_{n}', (STEER[0], STEER[1], z), parent=steer)
  empty('screen', (STEER[0] - 0.0255, STEER[1] + 0.017, 0), parent=steer)
  # ---- wheels: an empty at each axle centre, the tyre (rounded shoulders) and the rim inside
  for n, x, z, w in (('fl', XF, -ZF, W_FRONT), ('fr', XF, ZF, W_FRONT), ('rl', XR, -ZR, W_REAR), ('rr', XR, ZR, W_REAR)):
    hub = empty(f'wheel_{n}', (x, R_TYRE, z), front=n[0] == 'f')
    h = w / 2; c = Vector((x, R_TYRE, z))
    tyre = lathe([(0.235, -h), (0.30, -h), (R_TYRE - 0.025, -h + 0.006), (R_TYRE, -h + 0.035), (R_TYRE, h - 0.035), (R_TYRE - 0.025, h - 0.006), (0.30, h), (0.235, h)])
    tyre.v = [tuple(c + Vector(p)) for p in tyre.v]
    objs.append(obj(f'tyre_{n}', tyre, 'rubber', at=c, parent=hub, sharp=60))
    # the rim behind a dished wheel cover (2026: covers on every wheel), a hub nut; a coloured band on each sidewall
    out = 1 if z > 0 else -1
    rim = lathe([(0.235, -h + 0.012), (0.235, h - 0.012), (0.215, h - 0.012), (0.215, -h + 0.012)])
    rim.v = [tuple(c + Vector(p)) for p in rim.v]
    objs.append(obj(f'rim_{n}', rim, 'metal', at=c, parent=hub))
    cover = lathe([(0.0, out * (h - 0.030)), (0.10, out * (h - 0.026)), (0.20, out * (h - 0.018)), (0.226, out * (h - 0.012)), (0.226, out * (h - 0.05))], sides=40)
    cover.f.append(tuple(range(0, 40)) if out > 0 else tuple(range(0, 40))[::-1])
    cover.v = [tuple(c + Vector(p)) for p in cover.v]
    objs.append(obj(f'cover_{n}', cover, 'carbon', at=c, parent=hub, sharp=70))
    nut = lathe([(0.0, out * (h - 0.012)), (0.045, out * (h - 0.012)), (0.045, out * (h - 0.03))], sides=16); nut.f.append(tuple(range(16)) if out > 0 else tuple(range(16))[::-1])
    nut.v = [tuple(c + Vector(p)) for p in nut.v]
    objs.append(obj(f'nut_{n}', nut, 'paint_accent', at=c, parent=hub))
    for side in (-1, 1):
      band = lathe([(0.272, side * (h + 0.0005)), (0.283, side * (h + 0.0005))], sides=48)
      band.v = [tuple(c + Vector(p)) for p in band.v]
      objs.append(obj(f'band_{n}{"io"[side > 0]}', band, 'paint_accent', at=c, parent=hub))
  return objs

def main():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  objs = build()
  if os.path.basename(ARGS.get('ao', '1')) != '0': bake_ao([o for o in objs if o.type == 'MESH'], (), distance=0.6, samples=32, strength=0.7)
  tris = sum(len(p.vertices) - 2 for o in objs if o.type == 'MESH' for p in o.data.polygons)
  print(f'car: {len(objs)} meshes, {tris} triangles')
  for o in bpy.data.objects:
    if 'at' in o: del o['at']
  export(OUT, extras=True)
  if PREVIEW: preview()

def preview():
  """four views rendered with Cycles (the AO in the colours × the role colours)"""
  sc = bpy.context.scene
  for m in bpy.data.materials:
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF') if nt else None
    if not b: continue
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    mix.inputs[6].default_value = b.inputs['Base Color'].default_value[:]
    nt.links.new(va.outputs['Color'], mix.inputs[7]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
  bpy.ops.mesh.primitive_plane_add(size=60); bpy.context.object.data.materials.append(mat('metal'))
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), 0, math.radians(30))
  sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
  sc.render.resolution_x, sc.render.resolution_y = 1400, 760
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
  os.makedirs(PREVIEW, exist_ok=True)
  for name, eye, look in (('front34', (5.2, 2.0, 3.6), (0.2, 0.35, 0)), ('side', (0, 1.0, 8.5), (0, 0.45, 0)),
                          ('rear34', (-5.4, 2.2, -3.4), (-0.3, 0.4, 0)), ('top', (0.01, 9.0, 0), (0, 0, 0))):
    cam.location = G(*eye); d = G(*look) - G(*eye)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'car-{STYLE}-{name}.png')
    bpy.ops.render.render(write_still=True)

main()
