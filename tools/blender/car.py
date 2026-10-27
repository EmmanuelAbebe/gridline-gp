# Gridline GP's 2026 car, made in Blender: tools/blender/run.sh car [preview=dir] [ao=0]
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
OUT = os.path.abspath(ARGS.get('out', 'src/game/models/car.glb'))
PREVIEW = ARGS.get('preview')

# ---------------------------------------------------------------- the 2026 measurements (docs/car-plan.md)
WHEELBASE = 3.40
XF, XR = WHEELBASE / 2, -WHEELBASE / 2          # axles
R_TYRE = 0.36                                    # 720 mm tyres
W_FRONT, W_REAR = 0.275, 0.375                   # tyre widths
WIDTH = 1.90                                     # over the rear tyres
ZF = 0.80                                        # front wheel centres (outer face 0.94)
ZR = WIDTH / 2 - W_REAR / 2                      # rear wheel centres (0.7625)
EYE = (-0.33, 0.77, 0.0)                         # the cockpit camera (design-defaults cameras: back 0.33, height 0.77)
STEER = (0.18, 0.675, 0.0)                       # steering wheel centre

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
def build():
  objs = []
  # ---- the body: survival cell + nose, engine cover, airbox and sidepods joined into one skin, then the cockpit, the
  # sidepod inlets, the airbox inlet and the cooling outlet cut into it (their walls: material dark)
  #            x     yc     hw     hh     e    zc
  tub = [(2.64, 0.200, 0.040, 0.040, 2.2, 0), (2.48, 0.222, 0.080, 0.060, 2.3, 0), (2.20, 0.262, 0.130, 0.085, 2.5, 0),
         (1.90, 0.308, 0.172, 0.108, 2.6, 0), (1.55, 0.360, 0.205, 0.135, 2.7, 0), (1.20, 0.405, 0.236, 0.162, 2.8, 0),
         (0.85, 0.440, 0.262, 0.185, 3.0, 0), (0.50, 0.458, 0.288, 0.198, 3.2, 0), (0.10, 0.460, 0.305, 0.200, 3.3, 0),
         (-0.35, 0.470, 0.310, 0.215, 3.3, 0), (-0.55, 0.480, 0.300, 0.24, 3.0, 0)]
  cover = [(-0.30, 0.480, 0.300, 0.240, 3.0, 0), (-0.70, 0.495, 0.270, 0.255, 2.8, 0), (-1.10, 0.440, 0.210, 0.220, 2.7, 0),
           (-1.45, 0.385, 0.150, 0.170, 2.6, 0), (-1.75, 0.340, 0.100, 0.130, 2.5, 0), (-2.00, 0.310, 0.066, 0.085, 2.4, 0),
           (-2.12, 0.300, 0.050, 0.062, 2.3, 0)]
  airbox = [(-0.18, 0.865, 0.060, 0.080, 2.2, 0), (-0.30, 0.872, 0.098, 0.115, 2.3, 0), (-0.50, 0.842, 0.115, 0.150, 2.4, 0),
            (-0.80, 0.760, 0.100, 0.150, 2.5, 0), (-1.10, 0.640, 0.070, 0.110, 2.5, 0), (-1.40, 0.520, 0.045, 0.075, 2.4, 0)]
  pod = lambda s: [(x, yc, hw, hh, e, s * zc) for x, yc, hw, hh, e, zc in (
         (0.60, 0.470, 0.090, 0.085, 3.4, 0.455), (0.50, 0.468, 0.160, 0.128, 3.6, 0.470), (0.30, 0.462, 0.190, 0.150, 3.5, 0.480),
         (-0.05, 0.445, 0.192, 0.156, 3.3, 0.470), (-0.42, 0.405, 0.172, 0.150, 3.0, 0.440), (-0.78, 0.345, 0.140, 0.130, 2.8, 0.385),
         (-1.12, 0.278, 0.100, 0.100, 2.6, 0.305), (-1.42, 0.225, 0.060, 0.070, 2.4, 0.225), (-1.64, 0.200, 0.030, 0.040, 2.2, 0.160))]
  body = obj('body', body_loft(tub, bottom=0.075), 'paint_main', sharp=50)
  for name, keys in (('cover', cover), ('airbox', airbox), ('pod_l', pod(-1)), ('pod_r', pod(1))):
    boolean(body, obj(name, body_loft(keys), 'paint_main'), 'UNION')
  cuts = [('cockpit', [(0.44, 0.80, 0.19, 0.27, 4.0, 0), (0.30, 0.80, 0.225, 0.27, 4.5, 0), (-0.20, 0.80, 0.235, 0.27, 4.5, 0), (-0.32, 0.80, 0.20, 0.27, 4.0, 0)]),
          ('airbox_in', [(-0.14, 0.870, 0.050, 0.062, 2.2, 0), (-0.40, 0.870, 0.050, 0.062, 2.2, 0)]),
          ('outlet', [(-1.98, 0.305, 0.038, 0.045, 2.2, 0), (-2.30, 0.305, 0.038, 0.045, 2.2, 0)])]
  cuts += [(f'inlet_{n}', [(0.70, 0.470, 0.150, 0.090, 4.0, s * 0.475), (0.36, 0.470, 0.150, 0.090, 4.0, s * 0.475)]) for s, n in ((-1, 'l'), (1, 'r'))]
  for name, keys in cuts: boolean(body, obj(name, body_loft(keys, step=0.04), 'dark'))
  resmooth(body, 50); objs.append(body)
  objs.append(obj('headrest', body_loft([(-0.20, 0.64, 0.23, 0.06, 3, 0), (-0.33, 0.66, 0.23, 0.08, 3, 0)], step=0.03), 'carbon'))
  objs.append(obj('seat_back', plate([(-0.30, 0.50), (-0.25, 0.50), (-0.27, 0.70), (-0.32, 0.70)], 0, 0.40), 'dark'))
  # the T-camera on the airbox and the fin from the airbox to the rear wing
  objs.append(obj('tcam', body_loft([(-0.24, 0.965, 0.022, 0.018, 2.2, 0), (-0.30, 0.975, 0.07, 0.022, 2.6, 0), (-0.40, 0.970, 0.07, 0.020, 2.6, 0)], step=0.02), 'paint_accent'))
  objs.append(obj('fin', plate([(-0.95, 0.74), (-2.02, 0.48), (-2.02, 0.36), (-1.20, 0.60)], 0, 0.01), 'paint_main'))
  # ---- floor: the plank and floor with the edge turned up, cut in ahead of the rear tyres, the diffuser behind them
  fl = [(1.05, 0.30), (0.78, 0.55), (0.30, 0.70), (-1.05, 0.70), (-1.32, 0.58)]
  rings = [[(x, 0.035, -hw), (x, 0.035, hw), (x, 0.055, hw), (x, 0.055, -hw)] for x, hw in fl]
  objs.append(obj('floor', Mesh().grid(rings), 'carbon', sharp=30))
  for s, n in ((-1, 'l'), (1, 'r')):
    objs.append(obj(f'floor_edge_{n}', plate([(0.55, 0.055), (-1.05, 0.055), (-1.05, 0.11), (0.30, 0.13), (0.55, 0.075)], s * 0.695, 0.012), 'carbon'))
  dif = [(-1.32, 0.055, 0.035, 0.58), (-1.60, 0.10, 0.06, 0.54), (-1.88, 0.20, 0.09, 0.52), (-2.02, 0.27, 0.11, 0.50)]
  rings = [[(x, yb, -hw), (x, yb, hw), (x, yb + 0.02, hw), (x, yb + 0.02, -hw)] for x, yb, _, hw in dif]
  objs.append(obj('diffuser', Mesh().grid(rings), 'carbon', sharp=25))
  for z in (-0.50, -0.25, 0.25, 0.50):
    objs.append(obj(f'strake_{"lr"[z > 0]}{abs(round(z * 4))}', plate([(-1.32, 0.04), (-2.02, 0.04), (-2.02, 0.28), (-1.32, 0.06)], z, 0.01), 'carbon'))
  # ---- halo: the hoop round the head on two rear mounts, a faired centre pillar
  def halo_side(s, n):
    pts = [(0.42, 0.835, 0.0), (0.33, 0.845, s * 0.14), (0.16, 0.85, s * 0.245), (-0.06, 0.835, s * 0.275), (-0.20, 0.775, s * 0.28), (-0.27, 0.68, s * 0.28), (-0.29, 0.62, s * 0.28)]
    return obj(f'halo_{n}', tube(pts, 0.026, sides=14, flat=0.75), 'carbon')
  objs += both(halo_side)
  objs.append(obj('halo_pillar', tube([(0.64, 0.60, 0), (0.58, 0.70, 0), (0.50, 0.79, 0), (0.42, 0.835, 0)], 0.024, sides=12, flat=0.6), 'carbon'))
  # ---- front wing (2026: narrower, a two-element flap that opens in straight mode): the main plane raised in the
  # neutral middle, curling up at the tips into the endplates; footplates; nose pylons
  span = 0.92
  rise = lambda z: 0.035 if abs(z) < 0.25 else 0.035 * max(0.0, 1 - (abs(z) - 0.25) / 0.10) + 0.06 * max(0.0, (abs(z) - 0.55) / 0.37) ** 2
  zs = [-span, -0.82, -0.70, -0.55, -0.42, -0.34, -0.25, 0, 0.25, 0.34, 0.42, 0.55, 0.70, 0.82, span]
  objs.append(obj('fw_main', airfoil([(z, 2.84, 0.085 + rise(z), 1.0, 3) for z in zs], 0.31, camber=0.06), 'carbon'))
  for k, (xh, yh, ch, pitch, open_) in enumerate(((2.56, 0.135, 0.19, 15, 11), (2.41, 0.195, 0.15, 30, 20)), 1):
    flap = airfoil([(z, xh - 0.04 * (abs(z) / 0.88) ** 2, yh + rise(z) * 0.9, 1.0, pitch) for z in zs[1:-1]], ch, camber=0.07)
    objs.append(obj(f'fw_flap{k}', flap, 'paint_accent' if k == 2 else 'carbon', at=(xh, yh, 0), open=open_))
  for s, n in ((-1, 'l'), (1, 'r')):
    objs.append(obj(f'fw_endplate_{n}', plate([(2.86, 0.03), (2.30, 0.03), (2.24, 0.10), (2.30, 0.25), (2.52, 0.27), (2.80, 0.16), (2.87, 0.09)], s * (span + 0.006), 0.012), 'paint_accent'))
    objs.append(obj(f'fw_foot_{n}', boxmesh(2.20, 2.88, 0.03, 0.04, s * (span + 0.006) - s * 0.06, s * (span + 0.006)) if s > 0 else boxmesh(2.20, 2.88, 0.03, 0.04, s * (span + 0.006), s * (span + 0.006) + 0.06), 'carbon'))
    objs.append(obj(f'fw_pylon_{n}', plate([(2.62, 0.115), (2.40, 0.12), (2.34, 0.25), (2.58, 0.21)], s * 0.065, 0.01), 'carbon'))
  # ---- rear wing (no beam wing in 2026): a spoon-shaped main plane, the flap that opens, rounded endplates, a swan-neck
  # pylon over the crash structure, the rain light under it
  rw = 0.50
  spoon = lambda z: -0.025 * (1 - (z / rw) ** 2)
  objs.append(obj('rw_main', airfoil([(z, -2.10, 0.80 + spoon(z), 1.0, 7) for z in (-rw, -0.35, -0.15, 0, 0.15, 0.35, rw)], 0.30, camber=0.08), 'carbon'))
  objs.append(obj('rw_flap', airfoil([(z, -2.36, 0.915 + spoon(z) * 0.6, 1.0, 32) for z in (-rw, -0.25, 0, 0.25, rw)], 0.23, camber=0.08), 'paint_accent', at=(-2.36, 0.915, 0), open=24))
  for s, n in ((-1, 'l'), (1, 'r')):
    objs.append(obj(f'rw_endplate_{n}', plate([(-2.06, 0.70), (-2.05, 0.92), (-2.10, 0.98), (-2.20, 1.01), (-2.44, 1.02), (-2.56, 0.98), (-2.60, 0.90), (-2.60, 0.66), (-2.50, 0.60), (-2.22, 0.60)],
                    s * (rw + 0.008), 0.012), 'paint_main'))
    objs.append(obj(f'ep_light_{n}', boxmesh(-2.608, -2.596, 0.68, 0.92, s * (rw + 0.008) - 0.004, s * (rw + 0.008) + 0.004), 'light'))
  objs.append(obj('rw_pylon', plate([(-1.96, 0.38), (-2.04, 0.36), (-2.26, 0.84), (-2.18, 0.86)], 0, 0.014), 'carbon'))
  objs.append(obj('crash_structure', body_loft([(-2.00, 0.30, 0.075, 0.085, 3, 0), (-2.25, 0.29, 0.06, 0.065, 3, 0), (-2.46, 0.28, 0.04, 0.045, 2.6, 0)], step=0.04), 'carbon'))
  objs.append(obj('rain_light', boxmesh(-2.475, -2.455, 0.235, 0.29, -0.03, 0.03), 'light'))
  # ---- suspension: wishbones (two legs to the upright), push rods at the front, pull rods at the rear, track rods
  def arms(s, n):
    out = []
    for tag, x, z0, zw in (('f', XF, 0.20, ZF - W_FRONT / 2 - 0.03), ('r', XR, 0.15, ZR - W_REAR / 2 - 0.03)):
      for lvl, yi, yo in (('up', 0.50 if tag == 'f' else 0.44, 0.54), ('lo', 0.26, 0.17)):
        pts = [(x + 0.32, yi, s * z0), (x, yo, s * zw), (x - 0.28, yi, s * z0)]
        out.append(obj(f'arm_{tag}{lvl}_{n}', tube(pts, 0.017, sides=8, flat=0.4), 'carbon'))
      rod = [(x - 0.02, 0.19, s * zw), (x - 0.12, 0.50, s * z0)] if tag == 'f' else [(x + 0.02, 0.52, s * zw), (x + 0.15, 0.22, s * z0)]
      out.append(obj(f'rod_{tag}_{n}', tube(rod, 0.012, sides=8), 'carbon'))
      out.append(obj(f'track_{tag}_{n}', tube([(x + (0.10 if tag == 'f' else -0.12), 0.36, s * (z0 + 0.02)), (x + (0.10 if tag == 'f' else -0.12), 0.36, s * zw)], 0.011, sides=8, flat=0.5), 'carbon'))
    return out
  for side in both(arms): objs += side
  # ---- mirrors: a streamlined housing on two stalks each side of the cockpit, the glass facing back at the driver
  def mirror(s, n):
    z = s * 0.47
    house = obj(f'mirror_{n}', body_loft([(0.62, 0.735, 0.03, 0.02, 2.2, z), (0.58, 0.735, 0.085, 0.045, 2.8, z), (0.535, 0.735, 0.088, 0.046, 3.2, z)], step=0.012), 'paint_main')
    stalk = obj(f'mirror_stalk_{n}', plate([(0.60, 0.62), (0.55, 0.62), (0.555, 0.70), (0.59, 0.70)], s * 0.36, 0.008), 'carbon')
    glass = obj(f'mirror_glass_{n}', boxmesh(0.530, 0.533, 0.70, 0.77, z - 0.08, z + 0.08), 'glass', at=(0.5315, 0.735, z))
    return [house, stalk, glass]
  for side in both(mirror): objs += side
  # ---- the driver: helmet with its visor (seen from outside), the eye, the seat; the steering wheel with the grips and the screen
  objs.append(obj('helmet', body_loft([(-0.20, 0.80, 0.05, 0.05, 2.1, 0), (-0.24, 0.80, 0.115, 0.125, 2.1, 0), (-0.34, 0.80, 0.135, 0.14, 2.1, 0),
                  (-0.45, 0.80, 0.115, 0.115, 2.1, 0), (-0.50, 0.80, 0.05, 0.05, 2.1, 0)], step=0.02), 'paint_accent', show='outside'))
  objs.append(obj('visor', body_loft([(-0.215, 0.825, 0.07, 0.03, 2.4, 0), (-0.25, 0.825, 0.11, 0.035, 2.4, 0)], step=0.01), 'glass', show='outside'))
  empty('eye', EYE); empty('seat', (-0.45, 0.30, 0))
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
    rim = lathe([(0.001, -h + 0.02), (0.235, -h + 0.02), (0.235, h - 0.02), (0.001, h - 0.02)])
    rim.f.append(tuple(range(0, 40))[::-1]); rim.f.append(tuple(range(120, 160)))
    rim.v = [tuple(c + Vector(p)) for p in rim.v]
    objs.append(obj(f'rim_{n}', rim, 'metal', at=c, parent=hub))
  return objs

def main():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  objs = build()
  if ARGS.get('ao', '1') != '0': bake_ao([o for o in objs if o.type == 'MESH'], (), distance=0.6, samples=32, strength=0.7)
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
    sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'car-{name}.png')
    bpy.ops.render.render(write_still=True)

main()
