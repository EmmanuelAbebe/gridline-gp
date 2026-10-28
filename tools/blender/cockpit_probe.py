# Prints what the cockpit models are made of (tools/blender/run.sh cockpit_probe): objects, bones, boxes in Blender's frame.
import bpy, sys, os
from mathutils import Vector
D = os.path.expanduser('~/Downloads')
for name in ('race_driver', 'raceing_helmet', 'steering_wheel'):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=f'{D}/{name}/scene.gltf')
  bpy.context.view_layer.update()
  print('=====', name)
  for o in bpy.context.scene.objects:
    if o.type == 'MESH':
      ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
      lo = [round(min(v[i] for v in ws), 3) for i in range(3)]; hi = [round(max(v[i] for v in ws), 3) for i in range(3)]
      print('mesh', o.name, len(o.data.polygons), lo, hi, [m.name for m in o.data.materials])
    elif o.type == 'ARMATURE':
      print('armature', o.name)
      for b in o.data.bones:
        if any(k in b.name for k in ('Hips', 'Spine', 'Neck', 'Head_', 'Shoulder', 'Arm', 'ForeArm', 'Hand_', 'LeftHand0', 'UpLeg', 'Leg_', 'Foot', 'Toe')) and 'Thumb' not in b.name and 'Index' not in b.name and 'Middle' not in b.name and 'Ring' not in b.name and 'Pinky' not in b.name:
          h = o.matrix_world @ b.head_local; t = o.matrix_world @ b.tail_local
          print('  bone', b.name, [round(c, 3) for c in h], '→', [round(c, 3) for c in t], 'parent', b.parent.name if b.parent else '-')
