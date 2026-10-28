# Gridline GP's cockpit: the driver, helmet and steering wheel fitted into the 2026 car (docs/car-plan.md, phase 5):
# tools/blender/run.sh cockpit [preview=dir]
# From CC models the user picked (2026-10-27, credited in CREDITS.md):
#   "race driver" by BELAZ (CC-BY-4.0; a Ready Player Me avatar: CC BY-NC-SA 4.0) ~/Downloads/race_driver
#   "Racing helmet" by MizuCorp (CC-BY-4.0) ~/Downloads/raceing_helmet
#   "Steering-Wheel type Formula" by OscarContrerasLithgow (CC-BY-4.0) ~/Downloads/steering_wheel
# Poses the driver in the car (each bone aimed at a target in the game frame: reclined seat, legs up the tub to the
# pedals, hands on the wheel's grips, head at the cockpit eye), fits the helmet and the wheel. stage=export (default
# preview) writes src/game/models/driver.glb for the game (export_driver); preview=dir renders the views with the car
# (views=onboard,side,... picks some). Tuning args for trials: eye, steer=x,y, pedal=x,y, wrist=back,down,out, px / pz
# (the elbows' pole), slim (the arms' thickness), recline.
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import args, G
from mathutils import Vector, Matrix, Quaternion

A = args(); PREVIEW = A.get('preview'); D = os.path.expanduser('~/Downloads')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CAR = os.path.join(ROOT, 'src', 'game', 'models', 'car.glb')
# the driver's eye = the cockpit camera (2026-10-28, user: the seat must match their camera, back 0.21 / height 0.75; then
# chose 0.72 m on a height dial and 2 cm lower: (0.20, 0.70) on this car, CarModels.eyeShift), the wheel's centre (qvist.py
# STEER: moved forward and down so the arms reach out to it, with the cowl dipped over it, qvist.py cockpit_dip)
EYE = Vector((0.20, float(os.path.basename(A.get('eye', '0.70'))), 0.0))
STEER = Vector([float(v) for v in os.path.basename(A.get('steer', '0.66,0.58')).split(',')] + [0.0])   # (fixed to the car)
FOV = 72.5                                                       # the camera's vertical field of view
SCALE = 0.94                                                     # the avatar is 1.87 m: a 1.76 m driver
RECLINE = math.radians(float(os.path.basename(A.get('recline', '36'))))   # the back, from upright (real cars: lying low)

def imp(path):
  before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=path); bpy.context.view_layer.update()
  return [o for o in bpy.data.objects if o not in before]

def game(v):  # Blender → game frame
  return Vector((v.x, v.z, -v.y))

def aim(arm, pb, head_g, dir_g):
  """pose bone `pb` so it starts at head_g and points along dir_g (game frame), turning it the least from its rest"""
  W = arm.matrix_world; Wi = W.inverted()
  head = Wi @ G(*head_g); d = (Wi.to_3x3() @ (G(*(head_g + dir_g)) - G(*head_g))).normalized()
  rest = pb.bone.matrix_local.to_3x3(); y = rest.col[1].normalized()
  R = y.rotation_difference(d).to_matrix() @ rest
  pb.matrix = Matrix.Translation(head) @ R.to_4x4()
  bpy.context.view_layer.update()

def ik2(a, c, l1, l2, pole):
  """the joint between a and c for segments l1, l2, bent toward pole (game frame)"""
  d = c - a; L = min(d.length, (l1 + l2) * 0.999); u = d.normalized()
  along = (l1 * l1 - l2 * l2 + L * L) / (2 * L); h = math.sqrt(max(0.0, l1 * l1 - along * along))
  p = (pole - u * pole.dot(u)).normalized()
  return a + u * along + p * h

ARMS = (('Left', 'LeftArm_011', 'LeftForeArm_012', 'LeftHand_013'), ('Right', 'RightArm_034', 'RightForeArm_035', 'RightHand_036'))
LOCK = 90                                                        # the wheel's degrees at full steering (design-defaults steering.lock)

def turn(v, deg):
  """v (game frame, from the wheel's centre) turned with the wheel by deg about its column (x; + = clockwise to the driver,
  as three's rotation.x: y toward +z)"""
  c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
  return Vector((v.x, v.y * c - v.z * s_, v.y * s_ + v.z * c))

def pose_arms(arm, P, steer):
  """the arms on the wheel turned to `steer` (−1 … 1 = −LOCK … LOCK°): shoulders to the grips, elbows down and out, the
  wrists behind and just outside the grips (so the palm, not the wrist, closes round them, seen from the eye), the arms
  slimmer across (the avatar's sleeves are baggy: from a low seat they hid the gloves) with the hands back to full size"""
  bl = lambda n: P[n].bone.length * SCALE
  k = float(os.path.basename(A.get('slim', '0.65')))
  wb = [float(v) for v in os.path.basename(A.get('wrist', '0.07,0.01,0.02')).split(',')]
  px, pz = float(os.path.basename(A.get('px', '-0.3'))), float(os.path.basename(A.get('pz', '1.6')))
  for _, ua, fa, hd in ARMS:
    for n in (ua, fa, hd): P[n].scale = (1, 1, 1)
  bpy.context.view_layer.update()
  deg = steer * LOCK
  for side, ua, fa, hd in ARMS:
    zs = 1 if side == 'Right' else -1                               # (the avatar's left = the car's left = −z)
    grip = STEER + turn(Vector((0, 0, zs * 0.135)), deg)
    wrist = grip + turn(Vector((-wb[0], -wb[1], zs * wb[2])), deg)
    shoulder = game(arm.matrix_world @ P[ua].head)
    elbow = ik2(shoulder, wrist, bl(ua), bl(fa), Vector((px, -1, zs * pz)))
    aim(arm, P[ua], shoulder, (elbow - shoulder).normalized()); aim(arm, P[fa], elbow, (wrist - elbow).normalized())
    aim(arm, P[hd], wrist, (grip + turn(Vector((0.03, 0.02, -zs * 0.02)), deg) - wrist).normalized())   # (fingers forward over the grip)
  for _, ua, fa, hd in ARMS:
    P[ua].scale = (0.9, 1, 0.9); P[fa].scale = (k / 0.9, 1, k / 0.9); P[hd].scale = (1 / k, 1, 1 / k)
  bpy.context.view_layer.update()

def build():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  car = imp(CAR)
  drv = imp(f'{D}/race_driver/scene.gltf'); arm = next(o for o in drv if o.type == 'ARMATURE')
  # stand the avatar in the game frame: facing +x, scaled; its root object carries the transform
  top = next(o for o in drv if o.parent is None)
  top.matrix_world = Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Scale(SCALE, 4) @ top.matrix_world
  bpy.context.view_layer.update()
  bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
  P = arm.pose.bones; bl = lambda n: P[n].bone.length * SCALE
  up = Vector((-math.sin(RECLINE), math.cos(RECLINE), 0))
  # torso: hips → neck reclined, so the eye ends up at EYE
  torso = bl('Hips_01') + bl('Spine_02') + bl('Spine1_03') + bl('Spine2_04')
  neck_dir = Vector((-0.10, 1, 0)).normalized(); headlen = bl('Neck_05') + bl('Head_06') * 0.55
  # (the eye is at the front of the head, ~9 cm ahead of its centre: the head goes that far back, onto the headrest)
  HEAD = EYE + Vector((-0.09, -0.03, 0))
  hips = HEAD - neck_dir * headlen - up * torso + Vector((0.05, 0, 0))
  pos = hips.copy()
  for n in ('Hips_01', 'Spine_02', 'Spine1_03', 'Spine2_04'): aim(arm, P[n], pos, up); pos = pos + up * bl(n)
  aim(arm, P['Neck_05'], pos, neck_dir); pos = pos + neck_dir * bl('Neck_05')
  aim(arm, P['Head_06'], pos, neck_dir)
  # legs: thighs rising to the knees, shins down to the pedals, feet up
  for s, side in ((1, 'Left'), (-1, 'Right')):
    hip = game(arm.matrix_world @ P[f'{side}UpLeg_0' + ('57' if side == 'Left' else '62')].head)
    up_n, lo_n, ft_n = (f'{side}UpLeg_057', f'{side}Leg_058', f'{side}Foot_059') if side == 'Left' else (f'{side}UpLeg_062', f'{side}Leg_063', f'{side}Foot_064')
    zs = -s * 0.11                                                  # (the avatar's left = the car's left = −z)
    pedal = Vector([float(v) for v in os.path.basename(A.get('pedal', '1.42,0.24')).split(',')] + [zs * 0.8])
    knee = ik2(hip, pedal, bl(up_n), bl(lo_n), Vector((0, 1, 0)))
    aim(arm, P[up_n], hip, (knee - hip).normalized()); aim(arm, P[lo_n], knee, (pedal - knee).normalized())
    aim(arm, P[ft_n], pedal, Vector((0.45, 0.9, 0)).normalized())
  pose_arms(arm, P, 0.0)
  # fingers curled round the grip, thumbs over the front
  for b in P:
    n = b.name
    if any(k in n for k in ('Index', 'Middle', 'Ring', 'Pinky')) and 'end' not in n:
      b.rotation_mode = 'QUATERNION'; b.rotation_quaternion = Quaternion((1, 0, 0), math.radians(70))
    elif 'Thumb' in n and 'end' not in n and not n.endswith('Thumb1_014') and not n.endswith('Thumb1_037'):
      b.rotation_mode = 'QUATERNION'; b.rotation_quaternion = Quaternion((1, 0, 0), math.radians(35))
  bpy.context.view_layer.update()
  bpy.ops.object.mode_set(mode='OBJECT')
  # gloves: the avatar's bare skin (hands, arms) in black
  for o in drv:
    if o.type == 'MESH':
      for m in o.data.materials:
        if m.name == 'Wolf3D_Body' and m.node_tree:
          bsdf = m.node_tree.nodes.get('Principled BSDF')
          for l in list(bsdf.inputs['Base Color'].links): m.node_tree.links.remove(l)
          bsdf.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1); bsdf.inputs['Roughness'].default_value = 0.6
  # the car's own stand-in helmet and visor go (the driver wears a real one)
  for o in car:
    if o.name.split('.')[0] in ('helmet', 'visor'): o.hide_render = True
  # the helmet replaces the avatar's head and headwear (seen from outside); the wheel at STEER
  for o in drv:
    if o.type == 'MESH' and any(m.name in ('Wolf3D_Headwear', 'Wolf3D_Eye', 'Wolf3D_Teeth', 'Wolf3D_Skin') for m in o.data.materials): o.hide_render = True
  hel = imp(f'{D}/raceing_helmet/scene.gltf')
  ground = [o for o in hel if o.type == 'MESH' and any(m.name == 'Material.005' for m in o.data.materials)]   # (its display plane)
  hel = [o for o in hel if o not in ground]
  for o in ground: bpy.data.objects.remove(o, do_unlink=True)
  htop = next(o for o in hel if o.parent is None)
  # (its visor comes raised: turn it down about the hinge between the side screws, the helmet's own y axis)
  vis = next((o for o in hel if o.type == 'MESH' and any(m.name == 'Material.003' for m in o.data.materials)), None)
  if vis and A.get('visor'):           # (turning it on its hinge lifted its top above the helmet: by default it goes,
    hinge = Vector((-0.08, 0.0, 1.62)); ang = math.radians(float(os.path.basename(A.get('visor', '50'))))
    bpy.context.view_layer.update()
    Wv = vis.matrix_world.copy(); hp = (htop.matrix_world @ Matrix.Identity(4)).inverted()
    shift = Vector((float(os.path.basename(A.get('vx', '0.25'))), 0, float(os.path.basename(A.get('vz', '-0.45')))))   # (snug against the shell)
    T = Matrix.Translation(shift) @ Matrix.Translation(hinge) @ Matrix.Rotation(ang, 4, 'Y') @ Matrix.Translation(-hinge)
    vis.matrix_world = htop.matrix_world @ T @ htop.matrix_world.inverted() @ Wv
    for m in vis.data.materials:   # a smoked race visor
      b = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
      if b:
        for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
        b.inputs['Base Color'].default_value = (0.02, 0.025, 0.035, 1); b.inputs['Roughness'].default_value = 0.05
        if 'Alpha' in b.inputs: b.inputs['Alpha'].default_value = 1.0
  headb = P['Head_06']; hc = game(arm.matrix_world @ headb.head) + neck_dir * bl('Head_06') * 0.55
  # (its front is −X in its file: turn it to +x, 26 cm wide)
  htop.matrix_world = Matrix.Translation(G(*(hc + Vector((-0.01, -0.13, 0))))) @ Matrix.Rotation(math.radians(180), 4, 'Z') @ Matrix.Scale(0.042, 4) @ htop.matrix_world
  # a closed tinted visor: the inside of the helmet's face opening, dark and glossy (the visor model only covers its top)
  bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)
  shade = bpy.context.object; shade.name = 'visor_shade'
  shade.scale = (0.115, 0.105, 0.11); shade.location = G(*(hc + Vector((-0.005, -0.10, 0))))
  sm = bpy.data.materials.new('visor_shade'); sm.use_nodes = True; sb = sm.node_tree.nodes['Principled BSDF']
  sb.inputs['Base Color'].default_value = (0.015, 0.02, 0.03, 1); sb.inputs['Roughness'].default_value = 0.04; sb.inputs['Metallic'].default_value = 0.6
  shade.data.materials.append(sm); hel.append(shade)
  if vis and not A.get('visor'): vis.hide_render = True; vis.hide_viewport = True   # and the shade is the closed visor)
  whl = imp(f'{D}/steering_wheel/scene.gltf'); wtop = next(o for o in whl if o.parent is None)
  wtop.matrix_world = Matrix.Translation(G(*STEER)) @ Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Translation(Vector((0, -0.04, -0.10))) @ wtop.matrix_world
  bpy.context.view_layer.update()
  return car, drv, hel, whl

def preview():
  sc = bpy.context.scene
  bpy.ops.mesh.primitive_plane_add(size=60)
  sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), 0, math.radians(30)); sc.collection.objects.link(sun)
  sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
  sc.render.engine = 'CYCLES'; sc.cycles.samples = 40; sc.cycles.device = 'CPU'; sc.render.resolution_x, sc.render.resolution_y = 1400, 760
  cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
  os.makedirs(PREVIEW, exist_ok=True)
  for name, eye, look, lens in (('onboard', EYE, EYE + Vector((10, -0.4, 0)), 0), ('side', (0.2, 1.1, 2.6), (0.2, 0.6, 0), 35),
                                ('above', (0.9, 2.0, 1.2), (0.2, 0.55, 0), 30), ('front34', (2.3, 1.3, 1.8), (0.2, 0.6, 0), 35), ('helmet', (0.9, 0.95, 0.55), (0.1, 0.80, 0), 50), ('headrest', (0.15, 1.05, 0.9), (0.05, 0.75, 0), 40)):
    cam.data.clip_start = 0.02
    if lens: cam.data.lens = lens; cam.data.sensor_fit = 'AUTO'
    else: cam.data.sensor_fit = 'VERTICAL'; cam.data.angle_y = math.radians(FOV)     # (the game's camera: vertical fov)
    cam.location = G(*eye); d = G(*look) - G(*eye); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if A.get('views') and name not in os.path.basename(A['views']).split(','): continue
    for o in HELMET: o.hide_render = name == 'onboard'       # (in the cockpit view the camera is inside the helmet)
    sc.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'cockpit-{name}-{EYE.y:.2f}.png'); bpy.ops.render.render(write_still=True)

KEYS = 9                                                         # steering keys in the clip: −1, −0.75 … 1

def export_driver(car, drv, hel, whl):
  """driver.glb for the game (car-glb.js), in the car's frame like car.glb: the driver (skinned, its head meshes gone:
  the helmet replaces them) with a clip 'steer' whose frame k = the arms on the wheel at steering −1 + 2k/(KEYS − 1);
  'helmet' (an empty at the head, the helmet and its closed visor inside; the game hangs it on the head bone, extras
  show 'outside'); 'wheel' (an empty at the wheel's centre, the steering wheel inside; the game puts its contents on
  the car's own steer node, which turns it). Textures: no normal / metal maps, colour maps cut to 512 px (the wheel's
  1024), JPEG."""
  for o in car: bpy.data.objects.remove(o, do_unlink=True)
  for o in list(drv):
    if o.type == 'MESH' and o.hide_render: drv.remove(o); bpy.data.objects.remove(o, do_unlink=True)
  for o in list(hel):
    if o.hide_render: hel.remove(o); bpy.data.objects.remove(o, do_unlink=True)
  arm = next(o for o in drv if o.type == 'ARMATURE'); P = arm.pose.bones
  bl = lambda n: P[n].bone.length * SCALE
  # the helmet's empty at the head's centre; the game attaches it to Head_06 keeping where it is
  hc = game(arm.matrix_world @ P['Head_06'].head) + Vector((-0.10, 1, 0)).normalized() * bl('Head_06') * 0.55
  def holder(name, at, objs, **extras):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e); e.location = G(*at)
    for k, v in extras.items(): e[k] = v
    bpy.context.view_layer.update()
    for o in objs:
      if o.parent is None or o.parent not in objs: mw = o.matrix_world.copy(); o.parent = e; o.matrix_parent_inverse = e.matrix_world.inverted(); o.matrix_world = mw
    return e
  # cut down (10 drivers on the grid): the helmet's two shells (16k faces each) to a quarter, the wheel (30k) to 30 %
  for o, r in [(o, 0.25) for o in hel] + [(o, 0.3) for o in whl]:
    if o.type == 'MESH' and len(o.data.polygons) > 4000:
      m = o.modifiers.new('cut', 'DECIMATE'); m.ratio = r
      bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
  holder('helmet', hc, hel, show='outside')
  wh = holder('wheel', STEER, whl)
  # the wheel's display (where the game's live screen goes): its faces facing the driver near the middle
  dg = bpy.context.evaluated_depsgraph_get(); pts = []
  for o in whl:
    if o.type != 'MESH': continue
    me = o.data; W = o.matrix_world; N = W.to_3x3().inverted().transposed()
    for f in me.polygons:
      c = game(W @ f.center); n = game((N @ f.normal).normalized())
      if n.x < -0.9 and abs(c.z) < 0.07 and abs(c.y - STEER.y) < 0.07: pts.append((c, f.area * W.median_scale ** 2))
  if pts:
    x = min(c.x for c, a in pts)                                   # (the nearest flat part facing the driver: the display)
    big = [c for c, a in pts if c.x < x + 0.004]
    lo = Vector([min(c[i] for c in big) for i in range(3)]); hi = Vector([max(c[i] for c in big) for i in range(3)])
    sc = bpy.data.objects.new('wheel_screen', None); bpy.context.scene.collection.objects.link(sc)
    sc.location = G(x - 0.003, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2); sc['size'] = [0.10, 0.068]   # (the display's own size: its frame is in the same plane)
    bpy.context.view_layer.update(); mw = sc.matrix_world.copy(); sc.parent = wh; sc.matrix_parent_inverse = wh.matrix_world.inverted(); sc.matrix_world = mw
    print('wheel screen', [round(v, 3) for v in (x, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)], 'front face', [round(hi.z - lo.z, 3), round(hi.y - lo.y, 3)])
  # the clip: every bone keyed on every frame (the seated pose is the clip, not the rest pose)
  bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
  arm.animation_data_create(); arm.animation_data.action = bpy.data.actions.new('steer')
  for b in P:
    if b.rotation_mode != 'QUATERNION': q = b.matrix_basis.to_quaternion(); b.rotation_mode = 'QUATERNION'; b.rotation_quaternion = q
  for k in range(KEYS):
    pose_arms(arm, P, -1 + 2 * k / (KEYS - 1))
    for b in P:
      for path in ('location', 'rotation_quaternion', 'scale'): b.keyframe_insert(path, frame=k)
  bpy.ops.object.mode_set(mode='OBJECT')
  sc = bpy.context.scene; sc.frame_start, sc.frame_end = 0, KEYS - 1; sc.frame_set((KEYS - 1) // 2)
  # materials: colour maps only, small
  for m in bpy.data.materials:
    if not m.node_tree: continue
    for n in list(m.node_tree.nodes):
      if n.type == 'NORMAL_MAP' or (n.type == 'TEX_IMAGE' and any(l.to_socket.name in ('Metallic', 'Roughness', 'Normal', 'Color') and l.to_node.type in ('SEPARATE_COLOR', 'SEPRGB', 'NORMAL_MAP') for l in n.outputs[0].links)):
        m.node_tree.nodes.remove(n)
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
      for name in ('Metallic', 'Roughness', 'Normal'):
        for l in list(b.inputs[name].links): m.node_tree.links.remove(l)
  for img in bpy.data.images:
    if img.size[0] == 0: continue
    lim = 1024 if 'Root' in img.name else 512
    if max(img.size) > lim: f = lim / max(img.size); img.scale(max(1, round(img.size[0] * f)), max(1, round(img.size[1] * f)))
  tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
  print('driver.glb:', tris, 'triangles;', [(o.name, len(o.data.polygons)) for o in bpy.context.scene.objects if o.type == 'MESH'])
  bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_texcoords=True, export_normals=True,
    export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=85, export_yup=True, export_apply=False,
    export_cameras=False, export_lights=False, export_extras=True, export_skins=True, export_animations=True,
    export_animation_mode='ACTIONS', export_force_sampling=True, export_copyright=COPYRIGHT)
  print('wrote', OUT, os.path.getsize(OUT), 'bytes')

COPYRIGHT = ('Driver: based on "race driver" by BELAZ (sketchfab.com/asset_for_games), CC-BY-4.0, a Ready Player Me avatar '
  '(readyplayer.me, CC BY-NC-SA 4.0); helmet: "Racing helmet" by MizuCorp, CC-BY-4.0; steering wheel: "Steering-Wheel '
  'type Formula" by OscarContrerasLithgow, CC-BY-4.0; changed for Gridline GP (see CREDITS.md)')
OUT = os.path.join(ROOT, 'src', 'game', 'models', 'driver.glb')

car, drv, HELMET, whl = build()
if os.path.basename(A.get('stage', 'preview')) == 'export': export_driver(car, drv, HELMET, whl)
else:
  HELMET = [o for o in HELMET if o.type == 'MESH']
  if PREVIEW: preview()
