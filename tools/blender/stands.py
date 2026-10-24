# Gridline GP grandstands and their crowd, made in Blender: `npm run models` (tools/blender/run.sh stands [preview=dir]).
# Modern European, like the pit building: concrete tiers, coloured seats, steel, a cantilevered roof.
# Modules the game lines up along the track (stands.js), in the game's frame (kit.G: x along the track, y up, z away
# from it; the front at z = 0, facing the track):
#   main         an 8 m bay of the main grandstand: 14 rows of seats, half an aisle with steps and a handrail at each
#                side, an advertising parapet, the rear wall, a roof cantilevered on a steel truss
#   small        an 8 m bay of a corner stand: 7 rows, a canopy on a column at the back
#   <kind>_end_a / _end_b   the stepped side walls closing a run of bays (+x / −x side of a bay)
#   fan_sit, fan_cheer      a seated spectator (arms down / up), origin at the top of the seat pan, facing the track
# Objects `<module>-<role>`: solid (vertex colours), seat (× the stand's seat colour), panel (an advert the game paints,
# uv 0..1), and for the fans shirt / skin / legs (each × a per-fan colour). The seat layout travels in the bays' glTF
# extras (rows, rowDepth, riser, y0, seats, seatX0, seatPitch, panZ, panY), so the game seats the crowd where the seats are.
import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

ARGS = args()
OUT = os.path.abspath(ARGS.get('out', 'src/game/models/stands.glb'))
PREVIEW = ARGS.get('preview')

W = 8.0                                   # bay width (m)
RD, RH = 0.85, 0.42                       # row depth, riser height
SEATS, X0, PITCH = 13, -3.0, 0.5          # seats per row in a bay, the first one's x, their spacing
PAN_Z, PAN_Y = 0.45, 0.46                 # the seat pan's centre: m behind the row's front edge, m above its tread
CONC, CONC2, STEEL, RAIL = (0.74, 0.74, 0.72), (0.62, 0.62, 0.61), (0.22, 0.24, 0.27), (0.75, 0.77, 0.8)
KINDS = {'main': dict(rows=14, y0=2.4, roof='truss'), 'small': dict(rows=7, y0=1.2, roof='canopy')}

class Module:
  def __init__(self, name): self.name, self.parts, self.info = name, {}, {}
  def __getitem__(self, role): return self.parts.setdefault(role, Part())

def bay(kind):
  K = KINDS[kind]; R, y0 = K['rows'], K['y0']; m = Module(kind); s, seat, pn = m['solid'], m['seat'], m['panel']
  h = W / 2; ytop = y0 + (R - 1) * RH; zb = R * RD
  m.info = dict(rows=R, rowDepth=RD, riser=RH, y0=y0, seats=SEATS, seatX0=X0, seatPitch=PITCH, panZ=PAN_Z, panY=PAN_Y, width=W)
  # the front: the base wall, the parapet with its advert
  box(s, -h, h, 0, y0, -0.15, 0, CONC2, 'z')
  box(s, -h, h, y0, y0 + 1.0, -0.15, 0.0, CONC, 'zYZ', cell=100)
  panel(pn, (h - 0.1, y0 + 0.12, -0.16), (-(W - 0.2), 0, 0), (0, 0.76, 0), (1, 1, 1), cell=100, uv=(0, 0, 1, 1))
  # the tiers: a tread and the riser behind it per row, seats on the rear of each tread
  for k in range(R):
    y, z = y0 + k * RH, k * RD
    box(s, -h, h, y - 0.01, y, z, z + RD, CONC, 'Y', cell=2.0)
    if k: box(s, -h, h, y - RH, y, z - 0.01, z, CONC2, 'z', cell=2.0)
    for j in range(SEATS):
      x = X0 + PITCH * j; c = (1, 1, 1) if (j + k) % 9 else (0.82, 0.82, 0.82)
      box(seat, x - 0.22, x + 0.22, y + PAN_Y - 0.06, y + PAN_Y, z + PAN_Z - 0.2, z + PAN_Z + 0.18, c, 'Yz', cell=100)
      box(seat, x - 0.22, x + 0.22, y + PAN_Y, y + 0.92, z + PAN_Z + 0.16, z + PAN_Z + 0.22, c, 'zY', cell=100)
    # the aisle at each side (half of it in this bay): a half step between the rows, a rail post every other row
    for x0, x1 in ((h - 0.5, h), (-h, -h + 0.5)):
      if k + 1 < R: box(s, x0, x1, y, y + RH / 2, z + RD / 2, z + RD, CONC, 'Yz', cell=100)
    if k % 2 == 0: box(s, h - 0.03, h + 0.03, y, y + 1.0, z + 0.4, z + 0.46, RAIL, 'xXzZ', cell=100)
  rail = [G(h, y0 + k * RH + 1.0, k * RD + 0.43) for k in range(0, R, 2)]
  if len(rail) > 1: tube(s, rail, [0.03] * len(rail), 4, lambda p: RAIL[0])
  # the back: rear wall up past the top row (its parapet)
  box(s, -h, h, 0, ytop + 1.1, zb, zb + 0.25, CONC2, 'ZY', cell=2.0)
  box(s, -h, h, ytop, ytop + 1.1, zb - 0.01, zb, CONC, 'z', cell=2.0)
  # the roof
  if K['roof'] == 'truss':
    yb, yf, zf = ytop + 8.5, ytop + 7.4, -1.6                      # roof sheet: high at the back, lower at the front
    box(s, -0.22, 0.22, 0, yb + 0.3, zb + 0.5, zb + 0.95, STEEL, 'xXzZ', cell=100)        # the column behind the stand
    top = lambda t: (yb + 0.35 + (yf - yb) * t, zb + 0.7 + (zf - zb - 0.7) * t)          # truss chords, t 0 back .. 1 front
    bot = lambda t: (yb - 2.2 + (yf - 0.25 - yb + 2.2) * t, zb + 0.7 + (zf - zb - 0.7) * t)
    T = lambda f, t: G(0, *f(t))
    tube(s, [T(top, t / 6) for t in range(7)], [0.12] * 7, 6, lambda p: 0.3)
    tube(s, [T(bot, t / 6) for t in range(7)], [0.1] * 7, 6, lambda p: 0.3)
    for k in range(6):                                              # diagonals, zig-zag
      a, b = (T(top, k / 6), T(bot, (k + 1) / 6)) if k % 2 == 0 else (T(bot, k / 6), T(top, (k + 1) / 6))
      tube(s, [a, b], [0.06, 0.06], 4, lambda p: 0.3)
    for k in range(7): tube(s, [T(top, k / 6), T(bot, k / 6)], [0.05, 0.05], 4, lambda p: 0.3)
    p0 = Vector((h, yf, zf)); dv = Vector((0, yb - yf, zb + 0.9 - zf))
    panel(s, p0, (-W, 0, 0), dv, (0.9, 0.9, 0.9), cell=2.0)                       # top
    panel(s, (-h, yf - 0.05, zf), (W, 0, 0), dv, (0.82, 0.83, 0.84), cell=2.0)      # underside
    box(s, -h, h, yf - 0.6, yf + 0.15, zf - 0.12, zf, STEEL, 'zyY', cell=100)       # fascia
  else:
    yb, yf, zf = ytop + 3.6, ytop + 3.0, -0.6
    box(s, -0.15, 0.15, 0, yb, zb + 0.3, zb + 0.6, STEEL, 'xXzZ', cell=100)
    dv = Vector((0, yb - yf, zb + 0.6 - zf))
    panel(s, (h, yf, zf), (-W, 0, 0), dv, (0.88, 0.88, 0.88), cell=2.0)
    panel(s, (-h, yf - 0.05, zf), (W, 0, 0), dv, (0.8, 0.81, 0.82), cell=2.0)
    box(s, -h, h, yf - 0.35, yf + 0.1, zf - 0.1, zf, STEEL, 'zyY', cell=100)
  return m

def end(kind, sgn):
  """the stepped side wall at a run's end, on the +x (sgn 1) or −x (−1) side of the last bay"""
  K = KINDS[kind]; R, y0 = K['rows'], K['y0']; m = Module(f'{kind}_end_{"a" if sgn > 0 else "b"}'); s = m['solid']
  x = sgn * (W / 2 + 0.2); ytop = y0 + (R - 1) * RH
  def side(z0, z1, y1):                                 # a piece of the wall's outer face
    if sgn > 0: panel(s, (x, 0, z1), (0, 0, -(z1 - z0)), (0, y1, 0), CONC2, cell=2.0)
    else: panel(s, (x, 0, z0), (0, 0, z1 - z0), (0, y1, 0), CONC2, cell=2.0)
  side(-0.15, 0, y0 + 1.0)
  for k in range(R): side(k * RD, (k + 1) * RD, y0 + k * RH + 1.0)
  side(R * RD, R * RD + 0.25, ytop + 1.1)
  for k in range(R):                                    # the wall's top, stepping up with the rows
    x0, x1 = sorted((sgn * W / 2, x)); box(s, x0, x1, y0 + k * RH + 0.96, y0 + k * RH + 1.0, k * RD, (k + 1) * RD, CONC, 'Yz', cell=100)
  return m

def fan(name, cheer):
  """a seated spectator, the seat pan's top centre at the origin, facing −z (the track)"""
  m = Module(name); sh, sk, lg = m['shirt'], m['skin'], m['legs']
  box(sh, -0.17, 0.17, 0.02, 0.56, -0.04, 0.17, (1, 1, 1), 'xXzZY', cell=100)              # torso
  box(sh, -0.19, 0.19, 0.42, 0.58, -0.05, 0.18, (1, 1, 1), 'xXzZY', cell=100)              # shoulders
  for sd in (-1, 1):
    x = sd * 0.1
    box(lg, x - 0.08, x + 0.08, 0.0, 0.14, -0.44, 0.08, (1, 1, 1), 'xXzY', cell=100)       # thigh
    box(lg, x - 0.07, x + 0.07, -0.44, 0.06, -0.46, -0.32, (1, 1, 1), 'xXzZ', cell=100)     # shin
    box(lg, x - 0.07, x + 0.07, -0.46, -0.4, -0.58, -0.32, (0.4, 0.4, 0.4), 'xXzYZ', cell=100)   # shoe
    sx = sd * 0.21
    if cheer:
      tube(sh, [G(sx, 0.54, 0.06), G(sd * 0.28, 0.8, 0.0)], [0.055, 0.05], 5, lambda p: 1.0)
      tube(sk, [G(sd * 0.28, 0.8, 0.0), G(sd * 0.3, 1.06, -0.06)], [0.045, 0.04], 5, lambda p: 1.0)
    else:
      tube(sh, [G(sx, 0.54, 0.06), G(sd * 0.22, 0.3, -0.04)], [0.055, 0.05], 5, lambda p: 1.0)
      tube(sk, [G(sd * 0.22, 0.3, -0.04), G(sd * 0.14, 0.16, -0.3)], [0.045, 0.04], 5, lambda p: 1.0)
  box(sk, -0.05, 0.05, 0.56, 0.64, 0.0, 0.1, (1, 1, 1), 'xXzZ', cell=100)                   # neck
  head(sk, (0, 0.74, 0.04), 0.11)
  return m

def head(part, c, r, seg=8, rings=5):
  """a low-poly sphere"""
  c = Vector(c)
  pt = lambda a, b: Vector((math.sin(b) * math.cos(a), math.cos(b), math.sin(b) * math.sin(a)))
  for i in range(seg):
    for j in range(rings):
      a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg; b0, b1 = math.pi * j / rings, math.pi * (j + 1) / rings
      ds = [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)]          # (wound to face out)
      part.quad([G(*(c + d * r)) for d in ds], [(0, 0)] * 4, [(1, 1, 1, 1)] * 4, [Vector((d.x, -d.z, d.y)) for d in ds])

def build(mod, occluders_fn=None, bake=True):
  objs = []
  for role, part in mod.parts.items():
    if not part.faces: continue
    ob = to_object(f'{mod.name}-{role}', part, solid_material(role))
    if role == 'solid' or (role == 'seat'):
      for k, v in mod.info.items(): ob[k] = v                         # (glTF extras: the seat layout)
    objs.append(ob)
  if bake:
    occ = occluders_fn(objs) if occluders_fn else []
    bake_ao([o for o in objs if not o.name.endswith('-panel')], occ, distance=2.0)
  for o in objs: o.hide_render = True
  return objs

def copies(objs, offsets):
  out = []
  for o in objs:
    for dx in offsets:
      c = o.copy(); c.location = G(dx, 0, 0); bpy.context.scene.collection.objects.link(c); c.hide_render = False; out.append(c)
  return out

def main():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  objs = []
  for kind in KINDS:
    b = build(bay(kind), lambda o: copies(o, (-W, W)))
    objs += b
    for sgn in (1, -1):
      objs += build(end(kind, sgn), lambda _, b=b: copies(b, (0,)))
  objs += build(fan('fan_sit', False), bake=False) + build(fan('fan_cheer', True), bake=False)
  for o in objs: o.hide_render = False
  for o in objs: print(f'{o.name}: {len(o.data.polygons) * 2} triangles')
  export(OUT, extras=True)
  if PREVIEW: preview(objs)

def preview(objs):
  """three main bays with their ends and some fans, rendered with Cycles"""
  sc = bpy.context.scene; import random; r = random.Random(1)
  for o in list(objs):
    n = o.name.split('-')[0]
    if n == 'main':
      for k in (-1, 1): c = o.copy(); c.location = G(k * W, 0, 0); sc.collection.objects.link(c)
    elif n == 'main_end_a': o.location = G(W, 0, 0)
    elif n == 'main_end_b': o.location = G(-W, 0, 0)
    elif n.startswith('fan'): o.hide_render = True
    else: o.location = G(0, 0, 60)
  fans = [o for o in objs if o.name.startswith('fan_')]
  for row in range(14):
    for j in range(39):
      if r.random() > 0.8: continue
      x = -W - W / 2 + 1.0 + j * 0.5 + (0.5 if j >= 13 else 0) + (0.5 if j >= 26 else 0)
      kind = 'fan_cheer' if r.random() < 0.15 else 'fan_sit'
      for o in fans:
        if o.name.startswith(kind + '-'):
          c = o.copy(); c.hide_render = False; c.location = G(x, 2.4 + row * RH + PAN_Y, row * RD + PAN_Z); sc.collection.objects.link(c)
  for m in bpy.data.materials:
    nt = m.node_tree; bsdf = nt.nodes.get('Principled BSDF') if nt else None
    if not bsdf: continue
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
    tint = {'seat': (0.1, 0.25, 0.7), 'shirt': (0.8, 0.2, 0.1), 'skin': (0.75, 0.55, 0.42), 'legs': (0.15, 0.18, 0.3)}.get(m.name)
    if tint:
      mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
      nt.links.new(va.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (*tint, 1); nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    else: nt.links.new(va.outputs['Color'], bsdf.inputs['Base Color'])
  bpy.ops.mesh.primitive_plane_add(size=300)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
  sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.62, 0.8, 1)
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.location = (-22, 22, 6); cam.rotation_euler = (math.radians(82), 0, math.radians(-135))
  cam.data.lens = 22; sc.collection.objects.link(cam); sc.camera = cam
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
  sc.render.resolution_x, sc.render.resolution_y = 1600, 900
  os.makedirs(PREVIEW, exist_ok=True); sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), 'stands.png')
  bpy.ops.render.render(write_still=True)

main()
