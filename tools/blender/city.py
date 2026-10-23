# Gridline GP city blocks: a PERFORMANCE BENCHMARK, not part of the game (2026-10-23, user: put Cobalt Bay's city on
# hold in the game, but use it to test how large textures and meshes affect performance).
#   tools/blender/run.sh city dir=tools/blender/out/city [tex=512,1024,2048,4096] [detail=low,mid,high]
# writes dir/city-t<tex>-<detail>.glb for every combination: six building types (`b0` … `b5`, square towers of 6 … 16
# floors), each `<type>-facade` (its own facade texture, tex × tex px, the whole of each side mapped once: windows,
# panel joints, grime) + `<type>-roof` (vertex colours). Mesh detail:
#   low   flat walls (the windows only painted)                       ~ 12 triangles a building
#   mid   every window recessed 0.18 m (glass + 4 reveals)            ~ 9 quads a window
#   high  + a frame and a sill round every window                     ~ 24 quads a window
# The game side: src/game/bench.js, run by desktop/main.cjs --track-shots=dir --bench-city=dir (report in the shots dir).
import bpy, math, random, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

ARGS = args()
DIR = os.path.abspath(ARGS.get('dir', 'tools/blender/out/city'))
TEX = [int(t) for t in ARGS.get('tex', '512,1024,2048,4096').split(',')]
DETAIL = ARGS.get('detail', 'low,mid,high').split(',')

FLOOR, BAYW = 3.4, 1.8                  # floor height, window bay width (m)
TYPES = [  # bays per side, floors, wall colour, glass tint
  (12, 6, (0.80, 0.76, 0.68), (0.20, 0.26, 0.30)), (14, 9, (0.70, 0.71, 0.73), (0.16, 0.22, 0.28)),
  (10, 12, (0.62, 0.50, 0.42), (0.22, 0.24, 0.26)), (16, 8, (0.86, 0.86, 0.84), (0.18, 0.28, 0.34)),
  (12, 16, (0.55, 0.58, 0.62), (0.14, 0.20, 0.27)), (18, 7, (0.76, 0.66, 0.54), (0.21, 0.25, 0.28)),
]
WIN = (0.18, 0.82, 0.22, 0.78)          # a window inside its cell: u0, u1, v0, v1

def facade_texture(n, bays, floors, wall, tint, seed):
  """windows (lit or dark, curtains, reflections), panel joints at the floor slabs, grime streaks: one side, once"""
  r = np.random.default_rng(seed)
  y, x = (np.mgrid[0:n, 0:n] + 0.5) / n            # (row 0 = the top, flipped for Blender by to_image)
  y = 1 - y
  cu, cv = x * bays, y * floors; iu, iv = np.floor(cu).astype(int), np.floor(cv).astype(int); fu, fv = cu - iu, cv - iv
  win = (fu > WIN[0]) & (fu < WIN[1]) & (fv > WIN[2]) & (fv < WIN[3])
  lit = r.random((floors + 1, bays + 1)) < 0.25; curtain = r.random((floors + 1, bays + 1))
  rgb = np.ones((n, n, 3)) * np.array(wall)
  grime = 1 - 0.18 * np.abs(np.sin(x * bays * 9.1 + r.random() * 6)) ** 8 * (1 - y) - 0.06 * r.random((n, n))
  rgb *= grime[..., None]
  joint = (np.abs(fv - 0.02) < 0.012) | (np.abs(fu) < 0.006)
  rgb[joint] *= 0.7
  refl = (0.25 + 0.5 * (fv - WIN[2]) / (WIN[3] - WIN[2]))[..., None] * np.array([0.6, 0.7, 0.8])
  glass = np.array(tint) + refl * 0.35
  inside = np.where(lit[iv, iu][..., None], np.array([0.95, 0.85, 0.6]) * (0.6 + 0.4 * curtain[iv, iu][..., None]), glass)
  rgb = np.where(win[..., None], inside, rgb)
  frame = win & ((np.abs(fu - WIN[0]) < 0.02) | (np.abs(fu - WIN[1]) < 0.02) | (np.abs(fv - WIN[2]) < 0.02) | (np.abs(fv - WIN[3]) < 0.02))
  rgb[frame] = 0.25
  return np.clip(rgb, 0, 1), np.ones((n, n))

def building(bays, floors, detail):
  """a square tower in the game frame (x, z = ±half, y up), each side's texture mapped once"""
  f, roof = Part(), Part(); half = bays * BAYW / 2; H = floors * FLOOR
  for side in range(4):
    a = side * math.pi / 2; c, s = math.cos(a), math.sin(a)
    def P(u, v, d=0.0):  # u across the side (0 … 1, left to right seen from outside), v up (m), d into the wall (m)
      x = -half + u * 2 * half; z = -half + d
      return Vector((x * c - z * s, v, x * s + z * c))
    n = Vector((s, 0, -c))                            # outward, in the game frame
    def q(ps, uvs, nrm):                             # (wound to face `nrm`)
      if (ps[1] - ps[0]).cross(ps[2] - ps[0]).dot(nrm) < 0: ps, uvs = ps[::-1], uvs[::-1]
      part.quad([G(*p) for p in ps], uvs, [(1, 1, 1, 1)] * 4, [Vector((nrm.x, -nrm.z, nrm.y))] * 4)
    part = f
    if detail == 'low':
      q([P(1, 0), P(0, 0), P(0, H), P(1, H)], [(1, 0), (0, 0), (0, 1), (1, 1)], n); continue
    du, dv = 1 / bays, FLOOR
    for i in range(bays):
      for j in range(floors):
        u0, u1, v0, v1 = i * du, (i + 1) * du, j * dv, (j + 1) * dv
        wu0, wu1 = u0 + WIN[0] * du, u0 + WIN[1] * du; wv0, wv1 = v0 + WIN[2] * dv, v0 + WIN[3] * dv
        uv = lambda u, v: (u, v / H)
        def rect(ua, ub, va, vb, d=0.0, nrm=n):
          q([P(ub, va, d), P(ua, va, d), P(ua, vb, d), P(ub, vb, d)], [uv(ub, va), uv(ua, va), uv(ua, vb), uv(ub, vb)], nrm)
        rect(u0, u1, v0, wv0); rect(u0, u1, wv1, v1); rect(u0, wu0, wv0, wv1); rect(wu1, u1, wv0, wv1)   # the wall round it
        D = 0.18; rect(wu0, wu1, wv0, wv1, D)                                                            # the glass, set back
        # reveals (the window's sides, inward faces): along the depth
        q([P(wu0, wv0, 0), P(wu1, wv0, 0), P(wu1, wv0, D), P(wu0, wv0, D)], [uv(wu0, wv0)] * 4, Vector((0, 1, 0)))
        q([P(wu1, wv1, 0), P(wu0, wv1, 0), P(wu0, wv1, D), P(wu1, wv1, D)], [uv(wu0, wv1)] * 4, Vector((0, -1, 0)))
        q([P(wu0, wv1, 0), P(wu0, wv0, 0), P(wu0, wv0, D), P(wu0, wv1, D)], [uv(wu0, wv0)] * 4, P(1, 0) - P(0, 0))
        q([P(wu1, wv0, 0), P(wu1, wv1, 0), P(wu1, wv1, D), P(wu1, wv0, D)], [uv(wu1, wv0)] * 4, P(0, 0) - P(1, 0))
        if detail == 'high':                         # a frame standing 6 cm proud, and a sill
          t, o = 0.05, -0.06
          for ua, ub, va, vb in ((wu0 - t / (2 * half), wu1 + t / (2 * half), wv1, wv1 + t), (wu0 - t / (2 * half), wu0, wv0, wv1),
                                 (wu1, wu1 + t / (2 * half), wv0, wv1), (wu0 - 0.1 / (2 * half), wu1 + 0.1 / (2 * half), wv0 - 0.08, wv0)):
            rect(ua, ub, va, vb, o)
            q([P(ua, vb, o), P(ub, vb, o), P(ub, vb, 0), P(ua, vb, 0)], [uv(ua, vb)] * 4, Vector((0, 1, 0)))
            q([P(ub, va, o), P(ua, va, o), P(ua, va, 0), P(ub, va, 0)], [uv(ua, va)] * 4, Vector((0, -1, 0)))
            q([P(ua, vb, o), P(ua, va, o), P(ua, va, 0), P(ua, vb, 0)], [uv(ua, va)] * 4, P(0, 0) - P(1, 0))
            q([P(ub, va, o), P(ub, vb, o), P(ub, vb, 0), P(ub, va, 0)], [uv(ub, va)] * 4, P(1, 0) - P(0, 0))
  # roof: slab, parapet, plant rooms
  box(roof, -half, half, H - 0.01, H, -half, half, (0.45, 0.46, 0.47), 'Y', cell=100)
  box(roof, -half, half, H, H + 1.0, -half - 0.2, -half, (0.6, 0.6, 0.6), 'zY', cell=100)
  box(roof, -half, half, H, H + 1.0, half, half + 0.2, (0.6, 0.6, 0.6), 'ZY', cell=100)
  box(roof, -half - 0.2, -half, H, H + 1.0, -half, half, (0.6, 0.6, 0.6), 'xY', cell=100)
  box(roof, half, half + 0.2, H, H + 1.0, -half, half, (0.6, 0.6, 0.6), 'XY', cell=100)
  box(roof, -half * 0.4, half * 0.3, H, H + 3.0, -half * 0.3, half * 0.4, (0.72, 0.72, 0.7), 'xXzZY', cell=100)
  return f, roof

def main():
  os.makedirs(DIR, exist_ok=True)
  for detail in DETAIL:
    for n in TEX:
      bpy.ops.wm.read_factory_settings(use_empty=True)
      tris = 0
      for k, (bays, floors, wall, tint) in enumerate(TYPES):
        img = to_image(f'b{k}', *facade_texture(n, bays, floors, wall, tint, k))
        f, roof = building(bays, floors, detail)
        to_object(f'b{k}-facade', f, material(f'b{k}', img, False)); to_object(f'b{k}-roof', roof, solid_material('roof'))
        tris += 2 * (len(f.faces) + len(roof.faces))
      path = os.path.join(DIR, f'city-t{n}-{detail}.glb')
      export(path, image_format='JPEG')
      print(f'{os.path.basename(path)}: {tris} triangles for the six types')

main()
