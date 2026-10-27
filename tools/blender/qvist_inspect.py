# Looks inside a downloaded car model (glTF): its size and orientation, and its connected pieces with their boxes
# (tools/blender/run.sh qvist_inspect src=<scene.gltf> dir=<out dir>).
import bpy, bmesh, sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import args
from mathutils import Vector
A = args(); SRC, DIR = A['src'], A['dir']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
n0 = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5 * max(ob.dimensions))
print('verts', n0, '→', len(bm.verts), 'faces', len(bm.faces))
bm.to_mesh(me); bm.free()
lo = Vector([min(v.co[i] for v in me.vertices) for i in range(3)]); hi = Vector([max(v.co[i] for v in me.vertices) for i in range(3)])
print('bbox lo', tuple(round(c, 3) for c in lo), 'hi', tuple(round(c, 3) for c in hi), 'size', tuple(round(c, 3) for c in hi - lo))
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
parts = []
for o in bpy.context.scene.objects:
  if o.type != 'MESH': continue
  vs = o.data.vertices; l = Vector([min(v.co[i] for v in vs) for i in range(3)]); h = Vector([max(v.co[i] for v in vs) for i in range(3)])
  parts.append(dict(name=o.name, faces=len(o.data.polygons), lo=list(l), hi=list(h)))
parts.sort(key=lambda p: -p['faces'])
print('pieces', len(parts))
for p in parts[:60]: print(p['faces'], [round(c, 3) for c in p['lo']], [round(c, 3) for c in p['hi']])
os.makedirs(DIR, exist_ok=True)
json.dump(dict(lo=list(lo), hi=list(hi), parts=parts), open(os.path.join(DIR, 'parts.json'), 'w'))
