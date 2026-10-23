# Gridline GP pit buildings, made in Blender: `npm run models` (tools/blender/run.sh pits [preview=dir]).
# Modern European style: light aluminium panels, dark steel, glass, a roof cantilevered over the pit lane.
# Modules the game lines up along the pit straight (world.js), in the game's frame (kit.G: x along the track, y up,
# z away from the track, the garage fronts at z = 0, facing the lane):
#   bay    one team's garage: 15 m wide (x −7.5 … 7.5, centred on its door = tuning.js PIT.garages step / door), an open
#          garage with its interior (tyres in blankets, bench, screens, lights), the hospitality floor above, the roof
#   end_a  the block after the last bay (x 0 … 12 from the building's end), end_b the one before the first (x 0 … −12)
#   stand  a team's stand on the pit wall (z 0 = the wall's track side), roofed, its desk and screens
# Objects are `<module>-<role>`; the game makes one material per role: solid (vertex colours), inside (a garage's
# interior: also lit by its strip lights), team (vertex colours × the team's colour), glass, clear (see-through), light (unlit), panel (a sign the game paints: uv 0..1).
# Shading: Cycles ambient occlusion baked into the vertex colours, with the neighbouring bays in place.
import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

ARGS = args()
OUT = os.path.abspath(ARGS.get('out', 'src/game/models/pits.glb'))
PREVIEW = ARGS.get('preview')

# sizes (m); STEP / DOOR must match tuning.js PIT.garages (tests/models.test.js checks)
STEP, DOOR, DOOR_H, H1, D = 15.0, 11.0, 4.6, 6.0, 14.0     # bay width, door width / height, ground floor height, depth
UPPER, ROOF, OVER = 10.5, 11.1, 4.0                        # hospitality floor top, roof top, roof overhang over the lane
W = STEP / 2

ALU, JOINT, STEEL, CONC = (0.80, 0.82, 0.84), (0.50, 0.52, 0.55), (0.20, 0.22, 0.25), (0.70, 0.70, 0.68)
WHITE, FLOOR, TYRE, RUBBER = (0.90, 0.90, 0.91), (0.60, 0.62, 0.64), (0.07, 0.07, 0.08), (0.12, 0.12, 0.13)
LIGHT, SCREEN = (1.0, 1.0, 0.96), (0.55, 0.75, 0.95)
def glass(p):   # darker low down, the sky's reflection higher up
  t = min(1, max(0, (p.y - 6) / 5)); return (0.2 + 0.24 * t, 0.26 + 0.28 * t, 0.32 + 0.3 * t)

class Module:
  """the parts of one module, by role"""
  def __init__(self, name): self.name, self.parts = name, {}
  def __getitem__(self, role): return self.parts.setdefault(role, Part())

def bay():
  m = Module('bay'); s, t, g, c, l, pn, i = m['solid'], m['team'], m['glass'], m['clear'], m['light'], m['panel'], m['inside']
  dw = DOOR / 2
  # the garage: floor, back wall, the partition to the next bay, ceiling with lights
  box(i, -W, W, -0.02, 0.0, 0, D, FLOOR, 'Y')
  box(i, -W, W, 0, H1, D, D + 0.3, WHITE, 'z')
  box(i, W - 0.15, W + 0.15, 0, H1 - 0.8, 0.3, D, WHITE, 'xX')
  box(i, -W, W, H1 - 0.8, H1 - 0.75, 0.3, D, (0.82, 0.83, 0.84), 'y')
  for z in (3, 7, 11): box(l, -W + 1.2, W - 1.2, H1 - 0.83, H1 - 0.8, z, z + 0.5, LIGHT, 'y', cell=100)
  box(t, -W + 1.5, W - 1.5, 1.2, 4.0, D - 0.04, D, (1, 1, 1), 'z')                      # the team's back wall
  # the front: piers either side of the door, the lintel over it with the team's stripe and name board
  for x0, x1 in ((-W, -dw), (dw, W)):
    box(s, x0, x1, 0, H1, 0, 0.3, ALU, 'z')
    box(i, x0, x1, 0, H1, 0, 0.3, WHITE, 'Z' + ('X' if x0 < 0 else 'x'))
  box(s, -dw, dw, DOOR_H, H1, 0, 0.3, STEEL, 'zy')
  box(t, -W, W, H1 - 0.22, H1 - 0.04, -0.03, 0, (1, 1, 1), 'z', cell=100)
  panel(pn, (3.6, DOOR_H + 0.25, -0.04), (-7.2, 0, 0), (0, 0.85, 0), (1, 1, 1), cell=100, uv=(0, 0, 1, 1))
  for x in (-W + 0.02, W - 0.02):                                                       # panel joints on the piers
    box(s, x - 0.02, x + 0.02, 0, H1, -0.01, 0, JOINT, 'z', cell=100)
  # inside: tyres in the team's blankets, a bench with team cabinets, a screen tower
  for x in (-6.2, -5.3):
    for z in (12.4, 13.3):
      for k in range(3):
        y = k * 0.38
        if k < 2: cylinder(t, (x, y, z), (0, 1, 0), 0.37, 0.36, 14, (1, 1, 1))
        else: cylinder(s, (x, y, z), (0, 1, 0), 0.36, 0.36, 14, TYRE)
  box(i, W - 1.45, W - 0.15, 0, 0.9, 3, 10, (0.30, 0.31, 0.33), 'xYzZ')
  box(t, W - 1.47, W - 1.45, 0.1, 0.8, 3.2, 9.8, (1, 1, 1), 'x')
  box(i, -2.3, -1.7, 0, 1.8, 10.8, 11.2, STEEL, 'xXzZY')
  box(l, -2.6, -1.4, 1.8, 2.5, 10.85, 10.9, SCREEN, 'z', cell=100)
  # the hospitality floor: slab with a balcony, glass front with mullions, glass balustrade
  box(s, -W, W, H1, H1 + 0.35, -1.8, D + 0.3, CONC, 'yYz')
  panel(g, (W, H1 + 0.35, 0.6), (-STEP, 0, 0), (0, UPPER - H1 - 0.35, 0), glass, cell=1.0)
  for k in range(10):
    x = -W + 1.5 * k; box(s, x - 0.06, x + 0.06, H1 + 0.35, UPPER, 0.45, 0.6, STEEL, 'zxX', cell=100)
  box(s, -W, W, 8.35, 8.45, 0.45, 0.6, STEEL, 'zyY', cell=100)
  panel(c, (W, H1 + 0.35, -1.7), (-STEP, 0, 0), (0, 1.1, 0), (0.62, 0.72, 0.78), cell=100)
  box(s, -W, W, H1 + 1.45, H1 + 1.52, -1.74, -1.66, STEEL, 'zY', cell=100)
  # the roof over the lane: slab, its underside with light strips, the fascia with the team's stripe
  box(s, -W, W, UPPER, ROOF, -OVER, D + 0.3, (0.86, 0.87, 0.88), 'yY')
  box(l, -W + 1, W - 1, UPPER - 0.03, UPPER, -OVER + 0.8, -OVER + 1.1, LIGHT, 'y', cell=100)
  box(s, -W, W, UPPER - 0.1, ROOF + 0.2, -OVER - 0.1, -OVER, STEEL, 'zyY')
  box(t, -W, W, UPPER + 0.1, UPPER + 0.3, -OVER - 0.11, -OVER - 0.1, (1, 1, 1), 'z', cell=100)
  box(s, -W, W, 0, ROOF, D + 0.3, D + 0.3, CONC, 'Z')
  return m

def end(sgn):
  """the block at one end of the building: x from the bay edge (0) to 12 m beyond it, on the side `sgn` (+1 / −1)"""
  m = Module('end_a' if sgn > 0 else 'end_b'); s, g, pn = m['solid'], m['glass'], m['panel']
  def bx(part, a, b, *rest, faces='xXyYzZ', **kw):          # (mirrored: swap the x faces)
    x0, x1 = sorted((sgn * a, sgn * b))
    if sgn < 0: faces = faces.translate(str.maketrans('xX', 'Xx'))
    box(part, x0, x1, *rest, faces=faces, **kw)
  H = 13.5
  bx(s, 0, 12, 0, H, -0.5, D + 0.3, lambda p: WHITE if p.y < H1 else (0.74, 0.74, 0.72), faces='xXzZY')
  for k in range(1, 8):
    x = 1.5 * k; bx(s, x - 0.15, x + 0.15, 0, H, -0.9, -0.5, STEEL, faces='zxXY')
  x0, x1 = sorted((sgn * 0.5, sgn * 11.5))
  panel(g, (x1, H1 + 0.35, -0.51), (-(x1 - x0), 0, 0), (0, H - H1 - 1.0, 0), glass, cell=1.0)
  x0, x1 = sorted((sgn * 4, sgn * 8))
  panel(g, (x1, 0, -0.51), (-(x1 - x0), 0, 0), (0, 3, 0), glass, cell=100)
  bx(s, 0, 12, H, H + 0.6, -0.9, D + 0.3, STEEL, faces='YzXZ')
  # a big sign on the outer end wall (readable from outside: faces away from the building)
  x = sgn * 12.03
  if sgn > 0: panel(pn, (x, 6.5, D - 1.5), (0, 0, -(D - 3)), (0, 5, 0), (1, 1, 1), cell=100, uv=(0, 0, 1, 1))
  else: panel(pn, (x, 6.5, 1.5), (0, 0, D - 3), (0, 5, 0), (1, 1, 1), cell=100, uv=(0, 0, 1, 1))
  return m

def stand():
  """a team's stand on the pit wall (the wall: z 0 … 0.4, 1.1 m high; its fence on the track side up to 4.2 m)"""
  m = Module('stand'); s, t, l = m['solid'], m['team'], m['light']
  box(s, -3.5, 3.5, 1.1, 1.2, 0.4, 1.3, (0.32, 0.33, 0.35))
  for x in (-3.3, 3.3):
    box(s, x - 0.06, x + 0.06, 0, 1.1, 1.18, 1.3, STEEL, 'xXzZ', cell=100)
    box(s, x - 0.06, x + 0.06, 1.2, 3.5, 1.18, 1.3, STEEL, 'xXzZ', cell=100)
  box(s, -3.3, 3.3, 1.2, 1.95, 0.45, 0.8, (0.18, 0.19, 0.2), 'xXzZY')
  for k in range(4):
    x = -2.4 + 1.6 * k
    box(s, x - 0.6, x + 0.6, 1.95, 2.55, 0.55, 0.6, RUBBER, 'zxXY', cell=100)
    box(l, x - 0.56, x + 0.56, 1.99, 2.51, 0.6, 0.61, SCREEN, 'Z', cell=100)
    box(s, x - 0.25, x + 0.25, 1.2, 1.7, 0.95, 1.22, RUBBER, 'xXzZY', cell=100)
    box(s, x - 0.25, x + 0.25, 1.7, 2.25, 1.18, 1.24, RUBBER, 'xXzZ', cell=100)
  box(s, -3.6, 3.6, 3.5, 3.62, 0.25, 2.0, (0.78, 0.79, 0.8))
  box(t, -3.62, 3.62, 3.42, 3.67, 2.0, 2.06, (1, 1, 1), 'Z', cell=100)
  box(t, -3.62, 3.62, 3.42, 3.67, 0.19, 0.25, (1, 1, 1), 'z', cell=100)
  return m

def build(mod, occluders_fn=None):
  """the module's objects (baked), hidden from the next modules' bakes"""
  mats = {}
  objs = []
  for role, part in mod.parts.items():
    if not part.faces: continue
    mat = mats.setdefault(role, solid_material(role))
    objs.append(to_object(f'{mod.name}-{role}', part, mat))
  occ = occluders_fn(objs) if occluders_fn else []
  bake_ao([o for o in objs if not o.name.endswith(('-light', '-panel'))], occ)
  for o in objs: o.hide_render = True
  return objs

def copies(objs, offsets):
  """linked copies of a module where its neighbours stand (they only shade it)"""
  out = []
  for o in objs:
    for dx in offsets:
      c = o.copy(); c.location = G(dx, 0, 0); bpy.context.scene.collection.objects.link(c); out.append(c)
  return out

def main():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  objs = []
  b = build(bay(), lambda o: copies(o, (-STEP, STEP)))
  for o in b: o.hide_render = False
  objs += b
  for sgn in (1, -1):                                 # the ends, shaded by the bays beside them
    e = end(sgn)
    def occ(_, sgn=sgn):
      out = copies(b, (-sgn * W, -sgn * (W + STEP)))
      for o in out: o.hide_render = False
      return out
    objs += build(e, occ)
  for o in b: o.hide_render = True
  def wall(_):                                        # the pit wall under the stand (shading only)
    p = Part(); box(p, -6, 6, 0, 1.1, 0, 0.4, CONC); return [to_object('wall-tmp', p, solid_material('tmp'))]
  objs += build(stand(), wall)
  for o in objs: o.hide_render = False
  for o in objs: print(f'{o.name}: {len(o.data.polygons) * 2} triangles')
  export(OUT)
  if PREVIEW: preview(objs)

def preview(objs):
  """three bays, an end and the stands, rendered with Cycles"""
  sc = bpy.context.scene
  for o in objs:
    if o.name.startswith('bay'):
      for k in (-1, 1):
        c = o.copy(); c.location = G(k * STEP, 0, 0); sc.collection.objects.link(c)
    if o.name.startswith('end_a'): o.location = G(W + STEP, 0, 0)
    if o.name.startswith('end_b'): o.location = G(-W - STEP, 0, 0)
    if o.name.startswith('stand'): o.location = G(0, 0, -8.5)
  for m in bpy.data.materials:
    if not m.node_tree: continue
    nt = m.node_tree; bsdf = nt.nodes.get('Principled BSDF')
    if not bsdf: continue
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
    if m.name.startswith('team'):
      mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
      nt.links.new(va.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (0.7, 0.05, 0.03, 1); nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    else: nt.links.new(va.outputs['Color'], bsdf.inputs['Base Color'])
    if m.name.startswith(('light', 'panel')): nt.links.new(va.outputs['Color'], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = 1
  bpy.ops.mesh.primitive_plane_add(size=300); gr = bpy.context.object
  gm = bpy.data.materials.new('lane'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.08, 0.09, 1); gr.data.materials.append(gm)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
  sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.62, 0.8, 1)
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.location = (-34, 30, 9); cam.rotation_euler = (math.radians(80), 0, math.radians(-128))
  cam.data.lens = 22; sc.collection.objects.link(cam); sc.camera = cam
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
  sc.render.resolution_x, sc.render.resolution_y = 1600, 900
  os.makedirs(PREVIEW, exist_ok=True); sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), 'pits.png')
  bpy.ops.render.render(write_still=True)

main()
