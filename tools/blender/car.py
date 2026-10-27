# Gridline GP's 2026 car, made in Blender: tools/blender/run.sh car [preview=dir] [ao=0]
# Phase 1 of docs/car-plan.md (2026-10-26): the blockout. Every main part in its place and to the 2026 measurements,
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

# ---------------------------------------------------------------- the car
def build():
  objs = []
  # survival cell + nose: from the nose tip back to the engine cover; the top dips at the cockpit opening
  tub = [section(2.66, 0.215, 0.05, 0.045), section(2.45, 0.25, 0.10, 0.075), section(2.10, 0.31, 0.16, 0.11),
         section(1.70, 0.38, 0.215, 0.15), section(1.20, 0.43, 0.26, 0.19), section(0.70, 0.45, 0.29, 0.21),
         section(0.45, 0.43, 0.30, 0.18), section(-0.15, 0.42, 0.30, 0.17), section(-0.35, 0.45, 0.30, 0.21)]
  objs.append(obj('tub', Mesh().grid(tub), 'paint_main'))
  objs.append(obj('cockpit_floor', boxmesh(-0.32, 0.46, 0.585, 0.6, -0.24, 0.24), 'dark'))
  objs += both(lambda s, n: obj(f'cockpit_side_{n}', boxmesh(-0.36, 0.48, 0.55, 0.665, s * 0.30 - 0.03, s * 0.30 + 0.03), 'paint_main'))
  objs.append(obj('headrest', Mesh().grid([section(x, 0.62, 0.26, 0.07, e=3) for x in (-0.36, -0.16)]), 'carbon'))
  # engine cover, airbox over the driver's head, the fin to the rear wing
  cover = [section(-0.35, 0.47, 0.30, 0.23), section(-0.80, 0.47, 0.27, 0.24), section(-1.30, 0.41, 0.19, 0.19),
           section(-1.70, 0.35, 0.11, 0.13), section(-2.02, 0.31, 0.055, 0.07)]
  objs.append(obj('engine_cover', Mesh().grid(cover), 'paint_main'))
  airbox = [section(-0.24, 0.84, 0.085, 0.10, e=2.2), section(-0.42, 0.82, 0.11, 0.14), section(-0.80, 0.70, 0.09, 0.10), section(-1.15, 0.62, 0.04, 0.05)]
  objs.append(obj('airbox', Mesh().grid(airbox), 'paint_main'))
  objs.append(obj('airbox_inlet', Mesh().grid([section(x, 0.85, 0.065, 0.075, e=2.2) for x in (-0.235, -0.25)]), 'dark'))
  fin = [[(x, y0, -0.008), (x, y0, 0.008), (x, y1, 0.008), (x, y1, -0.008)] for x, y0, y1 in ((-0.85, 0.66, 0.78), (-1.5, 0.48, 0.80), (-2.05, 0.36, 0.84))]
  objs.append(obj('fin', Mesh().grid(fin), 'paint_accent'))
  # sidepods: an inlet at the front, an undercut below, tapering into the coke bottle
  def pod(s, n):
    rings = [section(x, yc, hw, hh, e=3.2, zc=s * zc) for x, yc, hw, hh, zc in
             ((0.42, 0.46, 0.15, 0.12, 0.47), (0.30, 0.44, 0.19, 0.15, 0.50), (-0.20, 0.42, 0.20, 0.15, 0.48),
              (-0.70, 0.37, 0.16, 0.13, 0.42), (-1.20, 0.30, 0.09, 0.09, 0.30), (-1.55, 0.25, 0.04, 0.05, 0.18))]
    return obj(f'sidepod_{n}', Mesh().grid(rings), 'paint_main')
  objs += both(pod)
  objs += both(lambda s, n: obj(f'pod_inlet_{n}', Mesh().grid([section(x, 0.46, 0.13, 0.10, e=3.2, zc=s * 0.47) for x in (0.425, 0.43)]), 'dark'))
  # floor: a plate from behind the front wheels to the diffuser, which kicks up behind the rear axle
  floor = []
  for x, hw, y in ((1.15, 0.38, 0.035), (0.80, 0.62, 0.035), (-1.10, 0.66, 0.035), (-1.55, 0.56, 0.05), (-1.95, 0.52, 0.22)):
    floor.append(section(x, y, hw, 0.012, e=8))
  objs.append(obj('floor', Mesh().grid(floor), 'carbon', sharp=30))
  # halo: a hoop round the driver's head on two rear mounts, a centre pillar up from the cell
  def halo_side(s, n):
    pts = [(0.40, 0.83, 0.0), (0.30, 0.84, s * 0.15), (0.12, 0.84, s * 0.25), (-0.12, 0.81, s * 0.275), (-0.26, 0.70, s * 0.28), (-0.30, 0.62, s * 0.28)]
    return obj(f'halo_{n}', tube(pts, 0.028, sides=12, flat=0.7), 'carbon')
  objs += both(halo_side)
  objs.append(obj('halo_pillar', tube([(0.62, 0.62, 0), (0.52, 0.76, 0), (0.40, 0.83, 0)], 0.022, sides=10), 'carbon'))
  # front wing: the main plane with the tips curling up, a two-element flap that opens (X-mode), endplates, nose pylons
  span = 0.94
  fw_main = airfoil([(z, 2.82, 0.10 + 0.05 * (abs(z) / span) ** 3, 1.0, 4) for z in (-span, -0.6, -0.25, 0.25, 0.6, span)], 0.32, camber=0.06)
  objs.append(obj('fw_main', fw_main, 'carbon'))
  for k, (xh, yh, ch, pitch, open_) in enumerate(((2.52, 0.150, 0.20, 16, 11), (2.36, 0.215, 0.15, 30, 20)), 1):
    flap = airfoil([(z, xh, yh + 0.04 * (abs(z) / 0.90) ** 3, 1.0, pitch) for z in (-0.90, -0.3, 0.3, 0.90)], ch, camber=0.07)
    objs.append(obj(f'fw_flap{k}', flap, 'paint_accent' if k == 2 else 'carbon', at=(xh, yh, 0), open=open_))
  objs += both(lambda s, n: obj(f'fw_endplate_{n}', boxmesh(2.24, 2.86, 0.04, 0.33, s * span - 0.006, s * span + 0.006), 'paint_accent'))
  objs += both(lambda s, n: obj(f'fw_pylon_{n}', boxmesh(2.45, 2.62, 0.13, 0.24, s * 0.06 - 0.006, s * 0.06 + 0.006), 'carbon'))
  # rear wing: main plane + the flap that opens, curved endplates, a swan-neck pylon, the rain light below
  rw = 0.50
  objs.append(obj('rw_main', airfoil([(z, -2.12, 0.80, 1.0, 8) for z in (-rw, 0, rw)], 0.30, camber=0.08), 'carbon'))
  objs.append(obj('rw_flap', airfoil([(z, -2.30, 0.92, 1.0, 34) for z in (-rw, 0, rw)], 0.22, camber=0.08), 'paint_accent', at=(-2.30, 0.92, 0), open=24))
  objs += both(lambda s, n: obj(f'rw_endplate_{n}', boxmesh(-2.62, -2.06, 0.50, 1.02, s * (rw + 0.008) - 0.006, s * (rw + 0.008) + 0.006), 'paint_main'))
  objs.append(obj('rw_pylon', tube([(-1.98, 0.36, 0), (-2.10, 0.62, 0), (-2.22, 0.86, 0)], 0.02, sides=8, flat=2.5), 'carbon'))
  objs.append(obj('crash_structure', Mesh().grid([section(x, 0.30, hw, hh, e=3) for x, hw, hh in ((-1.95, 0.08, 0.08), (-2.42, 0.05, 0.05))]), 'carbon'))
  objs.append(obj('rain_light', boxmesh(-2.47, -2.43, 0.24, 0.30, -0.035, 0.035), 'light'))
  objs += both(lambda s, n: obj(f'ep_light_{n}', boxmesh(-2.63, -2.61, 0.62, 0.98, s * (rw + 0.008) - 0.007, s * (rw + 0.008) + 0.007), 'light'))
  # suspension: wishbones and push / pull rods from the cell (front) and the gearbox (rear) to the uprights
  def arms(s, n):
    out = []
    for tag, x, z0, zw, y0, yw, uprights in (('f', XF, 0.22, ZF - W_FRONT / 2 - 0.03, 0.0, 0.0, None), ('r', XR, 0.16, ZR - W_REAR / 2 - 0.03, 0.0, 0.0, None)):
      for lvl, yi, yo in (('up', 0.50 if tag == 'f' else 0.44, 0.52), ('lo', 0.28, 0.18)):
        pts = [(x + 0.30, yi, s * z0), (x, yo, s * zw), (x - 0.30, yi, s * z0)]
        out.append(obj(f'arm_{tag}{lvl}_{n}', tube(pts, 0.016, sides=8, flat=0.45), 'carbon'))
      out.append(obj(f'rod_{tag}_{n}', tube([(x - 0.02, 0.20 if tag == 'f' else 0.48, s * zw), (x - 0.10, 0.50 if tag == 'f' else 0.24, s * z0)], 0.012, sides=8), 'carbon'))
    return out
  for side in both(arms): objs += side
  # mirrors: a housing on a stalk each side of the cockpit, the glass facing back at the driver
  def mirror(s, n):
    z = s * 0.46
    house = obj(f'mirror_{n}', Mesh().grid([section(x, 0.73, 0.085, 0.045, e=3, zc=z) for x in (0.60, 0.53)]), 'paint_main')
    stalk = obj(f'mirror_stalk_{n}', tube([(0.56, 0.64, s * 0.28), (0.565, 0.72, z - s * 0.06)], 0.01, sides=8, flat=3), 'carbon')
    glass = obj(f'mirror_glass_{n}', boxmesh(0.524, 0.528, 0.695, 0.765, z - 0.075, z + 0.075), 'glass', at=(0.526, 0.73, z))
    return [house, stalk, glass]
  for side in both(mirror): objs += side
  # the driver: helmet (seen from outside), the eye, the seat; the steering wheel with the grips and the screen
  objs.append(obj('helmet', Mesh().grid([section(x, 0.80, hw, hh, e=2.1) for x, hw, hh in
                  ((-0.22, 0.07, 0.07), (-0.27, 0.12, 0.13), (-0.37, 0.135, 0.14), (-0.47, 0.11, 0.11), (-0.51, 0.05, 0.05))]), 'paint_accent', show='outside'))
  empty('eye', EYE); empty('seat', (-0.45, 0.30, 0))
  steer = empty('steer', STEER)
  objs.append(obj('steer_wheel', Mesh().grid([section(x, STEER[1], 0.135, 0.075, e=4) for x in (STEER[0] + 0.025, STEER[0] - 0.025)]), 'carbon', at=STEER, parent=steer))
  for n, z in (('l', -0.135), ('r', 0.135)): empty(f'grip_{n}', (STEER[0], STEER[1], z), parent=steer)
  empty('screen', (STEER[0] - 0.0255, STEER[1] + 0.017, 0), parent=steer)
  # wheels: an empty at each axle centre, the tyre (rounded shoulders) and the rim inside
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
