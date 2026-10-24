# Gridline GP trackside structures, made in Blender: `npm run models` (tools/blender/run.sh trackside [preview=dir]).
# In the game's frame (kit.G: x along the track, y up, z across it; things beside the track face it at −z):
#   post        a lattice tower leg, 0.7 m square, 10 m tall from y 0 (the game scales its height to the span's needs)
#   truss       2 m of a box truss along z (z 0 … 2, y 0 … 1.4, x ±0.5): repeated across the road for the start gantry
#               and the sponsor bridge
#   lights      the start lights' pod, centred at the origin, the lenses facing −x (the grid): housing `solid`, and the
#               five columns `lamp0` … `lamp4` (two lenses each) so the game can light them one by one
#   marshal     a marshal post on a plinth: hut with a window toward the track, roof, steps, flag pole
#   tvtower     a scaffold TV tower, 7 m to its deck, the camera and its operator looking at the track
#   brakeboard  the frame of a braking board (300 / 200 / 100), its `panel` facing −x (the oncoming cars), uv 0..1
#   advert      the frame of an advertising board, its 8 × 1.25 m `panel` facing the track, uv 0..1
# Objects `<module>-<role>`: solid (vertex colours), panel (the game paints it), lamp0..4 (the game's lamp materials).
import bpy, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

ARGS = args()
OUT = os.path.abspath(ARGS.get('out', 'src/game/models/trackside.glb'))
PREVIEW = ARGS.get('preview')

STEEL, DARK, GALV, WHITE = (0.30, 0.32, 0.36), (0.07, 0.07, 0.08), (0.62, 0.64, 0.66), (0.92, 0.92, 0.9)
ORANGE, GLASS, GREEN, CONC = (1.0, 0.48, 0.1), (0.16, 0.22, 0.28), (0.18, 0.68, 0.29), (0.7, 0.7, 0.68)

class Module:
  def __init__(self, name): self.name, self.parts = name, {}
  def __getitem__(self, role): return self.parts.setdefault(role, Part())

def bar(part, a, b, r, col, sides=4):
  """a straight member from a to b (game frame), radius r"""
  tube(part, [G(*a), G(*b)], [r, r], sides, lambda p: col[0] if isinstance(col, tuple) else col)

def colbar(part, a, b, r, col, sides=4):
  """the same, in colour `col` (tube() takes a grey level: recolour its corners)"""
  k = len(part.col); bar(part, a, b, r, 1.0, sides)
  part.col[k:] = [(col[0], col[1], col[2], 1)] * (len(part.col) - k)

def post():
  m = Module('post'); s = m['solid']; h = 0.35
  box(s, -0.55, 0.55, 0, 0.5, -0.55, 0.55, CONC, 'xXzZY', cell=100)                    # footing
  for x, z in ((-h, -h), (h, -h), (h, h), (-h, h)): colbar(s, (x, 0.5, z), (x, 10, z), 0.06, STEEL, 6)
  for k in range(10):
    y0, y1 = 0.5 + k * 0.95, 0.5 + (k + 1) * 0.95
    sq = [(-h, -h), (h, -h), (h, h), (-h, h)]
    for a, b in zip(sq, sq[1:] + sq[:1]):
      colbar(s, (a[0], y1, a[1]), (b[0], y1, b[1]), 0.03, STEEL)
      colbar(s, (a[0], y0, a[1]), (b[0], y1, b[1]), 0.025, STEEL) if k % 2 == 0 else colbar(s, (b[0], y0, b[1]), (a[0], y1, a[1]), 0.025, STEEL)
  box(s, -0.42, 0.42, 9.95, 10.0, -0.42, 0.42, STEEL, 'Y', cell=100)
  return m

def truss():
  m = Module('truss'); s = m['solid']; L, H, w = 2.0, 1.4, 0.5
  chords = [(-w, 0), (w, 0), (w, H), (-w, H)]
  for x, y in chords: colbar(s, (x, y, 0), (x, y, L), 0.055, STEEL, 6)
  for x, y in ((-w, 0), (w, 0)): colbar(s, (x, 0, 0), (x, H, 0), 0.035, STEEL)        # the verticals at z 0
  colbar(s, (-w, H, 0), (w, H, 0), 0.03, STEEL); colbar(s, (-w, 0, 0), (w, 0, 0), 0.03, STEEL)
  for x in (-w, w): colbar(s, (x, 0, 0), (x, H, L), 0.03, STEEL)                    # side diagonals
  colbar(s, (-w, H, 0), (w, H, L), 0.025, STEEL); colbar(s, (-w, 0, L), (w, 0, 0), 0.025, STEEL)
  return m

def lights():
  m = Module('lights'); s = m['solid']; t = 0.25
  box(s, -t, t, -0.75, 0.75, -3.0, 3.0, DARK)                                          # the housing
  box(s, -0.06, 0.06, 0.75, 1.4, -0.06, 0.06, STEEL, 'xXzZ', cell=100)                 # its hanger
  for k in range(5):
    z = (k - 2) * 1.15; lamp = m[f'lamp{k}']
    box(s, -t - 0.02, -t, -0.7, 0.7, z - 0.52, z + 0.52, (0.12, 0.12, 0.13), 'x', cell=100)    # the column's face
    for y in (0.32, -0.32):
      cylinder(lamp, (-t - 0.03, y, z), (-1, 0, 0), 0.21, 0.01, 12, (1, 1, 1))
      box(s, -t - 0.28, -t - 0.02, y + 0.22, y + 0.25, z - 0.24, z + 0.24, DARK, 'yYx', cell=100)   # the visor
  return m

def marshal():
  m = Module('marshal'); s = m['solid']; g = m['glass']
  box(s, -1.6, 1.6, 0, 0.6, -0.4, 2.4, CONC, 'xXzZY', cell=100)                         # plinth
  box(s, -1.3, 1.3, 0.6, 3.0, 0.4, 2.4, WHITE, 'xXZ', cell=100)                         # hut: sides, back
  box(s, -1.3, 1.3, 0.6, 1.6, 0.4, 0.45, WHITE, 'z', cell=100)                           # front below the window
  box(s, -1.3, 1.3, 2.55, 3.0, 0.4, 0.45, ORANGE, 'z', cell=100)                         # front band over it
  panel(g, (1.2, 1.6, 0.39), (-2.4, 0, 0), (0, 0.95, 0), GLASS, cell=100)                # the window
  box(s, -1.32, 1.32, 2.2, 2.5, 0.38, 2.42, ORANGE, 'xX', cell=100)                     # side bands
  box(s, -1.55, 1.55, 3.0, 3.12, 0.0, 2.7, (0.6, 0.62, 0.64))                            # roof
  for k in range(3): box(s, 1.6, 2.2, 0.2 * k, 0.2 * (k + 1), 0.6 + 0.3 * k, 2.4, CONC, 'Yz', cell=100)   # steps
  colbar(s, (-1.45, 0.6, -0.2), (-1.45, 4.2, -0.2), 0.03, GALV)                          # flag pole
  panel(s, (-1.45, 3.55, -0.2), (0.75, 0, 0), (0, 0.55, 0), GREEN, cell=100)              # the flag (both faces)
  panel(s, (-0.7, 3.55, -0.21), (-0.75, 0, 0), (0, 0.55, 0), GREEN, cell=100)          # (1 cm apart: back to back, each
                                                                                         # would shade the other black in the bake)
  return m

def person(part, x, y, z):
  """someone standing, feet at (x, y, z), facing −z"""
  box(part, x - 0.17, x + 0.17, y + 0.85, y + 1.45, z - 0.1, z + 0.1, (0.1, 0.2, 0.45), 'xXzZY', cell=100)
  for sd in (-1, 1): box(part, x + sd * 0.1 - 0.07, x + sd * 0.1 + 0.07, y, y + 0.88, z - 0.08, z + 0.08, (0.15, 0.15, 0.17), 'xXzZ', cell=100)
  box(part, x - 0.09, x + 0.09, y + 1.47, y + 1.72, z - 0.1, z + 0.1, (0.78, 0.6, 0.48), 'xXzZY', cell=100)
  box(part, x - 0.11, x + 0.11, y + 1.66, y + 1.76, z - 0.12, z + 0.12, (0.1, 0.1, 0.1), 'xXzZY', cell=100)   # cap / headset

def tvtower():
  m = Module('tvtower'); s = m['solid']; h, H = 1.2, 7.0
  legs = [(-h, -h), (h, -h), (h, h), (-h, h)]
  for x, z in legs: colbar(s, (x, 0, z), (x, H + 1.0, z), 0.04, GALV, 6)
  for k in range(3):
    y0, y1 = k * H / 3, (k + 1) * H / 3
    for a, b in zip(legs, legs[1:] + legs[:1]):
      colbar(s, (a[0], y1, a[1]), (b[0], y1, b[1]), 0.03, GALV)
      colbar(s, (a[0], y0, a[1]), (b[0], y1, b[1]), 0.025, GALV)
  box(s, -h - 0.1, h + 0.1, H - 0.08, H, -h - 0.1, h + 0.1, (0.45, 0.42, 0.36))          # deck
  for a, b in zip(legs, legs[1:] + legs[:1]): colbar(s, (a[0], H + 1.0, a[1]), (b[0], H + 1.0, b[1]), 0.03, GALV)
  # the camera on its tripod, the operator behind it
  for dx, dz in ((-0.3, 0.2), (0.3, 0.2), (0, -0.25)): colbar(s, (dx, H, dz), (0, H + 1.2, 0), 0.02, DARK)
  box(s, -0.18, 0.18, H + 1.2, H + 1.55, -0.45, 0.25, DARK, 'xXzZY', cell=100)
  cylinder(s, (0, H + 1.38, -0.45), (0, 0, -1), 0.1, 0.4, 10, (0.05, 0.05, 0.06))
  person(s, 0, H, 0.6)
  return m

def brakeboard():
  m = Module('brakeboard'); s = m['solid']
  colbar(s, (0.05, 0, 0), (0.05, 1.9, 0), 0.05, GALV, 6)
  box(s, -0.04, 0.0, 0.95, 2.85, -0.7, 0.7, (0.12, 0.13, 0.15), 'xXzZY', cell=100)       # the frame behind the board
  panel(m['panel'], (-0.05, 1.0, -0.65), (0, 0, 1.3), (0, 1.8, 0), (1, 1, 1), cell=100, uv=(0, 0, 1, 1))
  return m

def advert():
  m = Module('advert'); s = m['solid']
  for x in (-3.6, 3.6):
    box(s, x - 0.05, x + 0.05, 0, 1.75, 0.02, 0.12, GALV, 'xXzZ', cell=100)
    colbar(s, (x, 1.4, 0.1), (x, 0, 0.75), 0.025, GALV)                                  # back strut
  box(s, -4.08, 4.08, 0.36, 1.73, 0.0, 0.04, (0.12, 0.13, 0.15), 'xXyYZ', cell=100)     # the board's back and edges
  panel(m['panel'], (4.0, 0.42, -0.01), (-8.0, 0, 0), (0, 1.25, 0), (1, 1, 1), cell=100, uv=(0, 0, 1, 1))
  return m

def main():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  objs = []
  for mod in (post(), truss(), lights(), marshal(), tvtower(), brakeboard(), advert()):
    made = [to_object(f'{mod.name}-{role}', p, solid_material(role)) for role, p in mod.parts.items() if p.faces]
    bake_ao([o for o in made if o.name.endswith(('-solid', '-glass'))], (), distance=1.5)
    for o in made: o.hide_render = True
    objs += made
  for o in objs: o.hide_render = False
  for o in objs: print(f'{o.name}: {len(o.data.polygons) * 2} triangles')
  export(OUT)
  if PREVIEW: preview(objs)

def preview(objs):
  sc = bpy.context.scene; spots = {'post': -9, 'truss': -6, 'lights': -3, 'marshal': 1, 'tvtower': 6, 'brakeboard': 10, 'advert': 15}
  for o in objs: o.location = G(spots[o.name.split('-')[0]], 0, 0)
  for m in bpy.data.materials:
    nt = m.node_tree; bsdf = nt.nodes.get('Principled BSDF') if nt else None
    if not bsdf: continue
    va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'; nt.links.new(va.outputs['Color'], bsdf.inputs['Base Color'])
  bpy.ops.mesh.primitive_plane_add(size=300)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-20))
  sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.62, 0.8, 1)
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.location = (3, -24, 6); cam.rotation_euler = (math.radians(80), 0, 0)
  cam.data.lens = 22; sc.collection.objects.link(cam); sc.camera = cam
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 32; sc.cycles.device = 'CPU'
  sc.render.resolution_x, sc.render.resolution_y = 1600, 800
  os.makedirs(PREVIEW, exist_ok=True); sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), 'trackside.png')
  bpy.ops.render.render(write_still=True)

main()
