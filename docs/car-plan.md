# The car in Blender: plan and spec

Agreed 2026-10-26. The user's choices:
- **Look:** a realistic 2026 F1 car. Proportions and parts as close to the 2026 rules cars as possible; invented team
  details, no copied real shape or livery.
- **The old part-built car stays as an option**, with its editor: the garage chooses between the Blender car and the
  design-tools car.
- **Livery:** pattern templates (stripes, two-tone, splits …) painted with the garage's main / accent colours, plus the
  number and finish.
- **One car for every team**, as in the physics: teams differ by colours and pattern only.

Built like the trees, pits, stands and trackside: a headless bpy script (`tools/blender/car.py` on `kit.py`) →
`src/game/models/car.glb`, committed, so players and CI never need Blender and every change is a number in a script.
Each phase ends with renders / screenshots for the user to look at before the next.

## Phases

| Phase | What | Review |
|---|---|---|
| 0. Spec | This page: measurements, the points the game relies on, the object and material contract | this page |
| 1. Blockout **(done 2026-10-26)** | car.py: a rough car to the spec → car.glb; the game loads it behind a switch (garage: car model) next to the current car; the anchors drive the wheels, wings, steering, mirrors, eye | Blender renders + in-game shots side by side |
| 2. Body **(first pass 2026-10-26)** | survival cell, nose, sidepods (inlets, undercut), engine cover + fin, floor (edge wings, diffuser), halo, front and rear wings with the active-aero elements as hinged objects, suspension, mirrors, cameras | 6 views |
| 3. Paint and livery | UVs, material per role, livery pattern masks (garage colours paint them), number panels, invented sponsors | garage shots, several liveries |
| 4. Wheels | rims, wheel covers, tyre sidewalls (invented brand), brake ducts; spin, steer, come off at a pit stop | close-ups, a stop |
| 5. Cockpit | interior, steering wheel (screen mount, grips for the arms), halo inside, mirror housings, helmet | cockpit shots |
| 6. Finish | a low-detail copy for distant cars, shadows, ghost car, Performance mode, tests | frame times, full grid |

## Measurements (2026 technical regulations)

| | Spec | The game now |
|---|---|---|
| Wheelbase | 3.40 m (max) | physics 3.4; drawn car 3.30 (wheels at x +1.75 / −1.55): **fix** |
| Width | 1.90 m (max) | ~1.9 |
| Track (wheel centres) | ~1.60 m (physics `track`) | 1.72 / 1.76: **narrower tyres move them in** |
| Front tyre | 275 mm wide, 18" rim | 0.36 m wide: **fix** |
| Rear tyre | 375 mm wide, 18" rim | 0.46 m wide: **fix** |
| Tyre diameter | ~720 mm (2022's, assumed until checked) | 0.72 / 0.76 |
| Front wing | 100 mm narrower than 2022, two-element flap that opens (X-mode) | 3 elements |
| Rear wing | main plane + flap that opens; no beam wing in 2026 | beam wing: **drop** |
| Floor | narrower (100–150 mm), smaller diffuser | |
| Mass | 768 kg min (physics 770) | |

Sources: formula1.com "12 rule changes you need to know in 2026" and "unpicking the 2026 aerodynamics regulations",
GPFans "How big are the new F1 cars?", Motor Sport "smaller, nimbler, raceable" (2026-10-26). Check the floor and front
wing figures against the FIA text before phase 2.

## What the game needs from the model (the contract)

Game frame: x forward, y up, z right; origin on the ground under the middle of the wheelbase. Metres.

- **Wheels:** four `wheel_<fl|fr|rl|rr>` objects, each at its axle centre (spin about z, the fronts steer about y);
  `tyre` and `rim` parts inside. A pit stop slides a wheel out along z.
- **Active aero:** `fw_flap` (front flap, ×2 elements) and `rw_flap` (rear flap) with their origin on the hinge line and
  `extras.open` = degrees in straight mode (now 11 / 20 front, 24 rear).
- **Steering wheel:** `steer` object at the wheel centre (now x 0.18, y 0.675), `grip_l` / `grip_r` empties for the
  driver's hands, `screen` empty for the live screen (now 0.088 × 0.052 m).
- **Driver:** `eye` empty (cockpit camera: 0.33 m back, 0.77 m high), `seat`, `pedal_thr` / `pedal_brk` empties.
- **Mirrors:** `mirror_glass_l` / `_r` planes (mirrors.js renders into them).
- **Lights:** `rain_light` + `endplate_light_*` with the `light` material (brake lights), a `glow` empty behind each.
- **Views:** objects tagged `extras.show` = `outside` / `cockpit` / `always` (the cockpit hides the outside of the nose).
- **Materials by role:** `paint_main`, `paint_accent`, `carbon`, `rubber`, `metal`, `light`, `glass`, `number`,
  `livery_mask` (phase 3: a texture whose channels say where pattern A / B / C go).
- **Budget:** car ≤ 60k triangles near, ≤ 10k far (10 cars ≈ 0.15 ms per frame at ~0.22 ms per million triangles on the
  RX 9060 XT, docs/city-benchmark.md).

tests/models.test.js will check car.glb: object names, the wheelbase / track / tyre sizes against the physics,
triangle budgets, every anchor present.

## Status

- Phase 1 (2026-10-26): `tools/blender/car.py` → car.glb (~480 KB, ~18k triangles, AO baked; `ao=0` skips the bake,
  `preview=dir` renders four views). Game: `car-glb.js` (the same per-car API as the part-built car), `CarModels.setKind`
  ('classic' | '2026') swaps every car (the field, the garage's, the ghost); the garage's Look → Car picks it
  (`livery.model`, default classic until the model is finished). Mirrors come from `mirror_glass_*`, the steering screen
  from `screen`, the hands from `grip_*`. Smoke test with `GRIDLINE_SMOKE_CAR=2026`. tests/models.test.js checks the
  wheelbase against SIM.CHASSIS, the 2026 tyre sizes, the moving parts and the budget.
- Phase 2, first pass (2026-10-26): the survival cell, engine cover, airbox and sidepods are smooth lofts (key sections
  through a cubic Hermite, `body_loft`) joined into one skin with Blender's exact boolean, the cockpit, the sidepod
  inlets, the airbox inlet and the cooling outlet cut into it (their walls in `dark`); T-camera, fin, floor with turned-up
  edges, diffuser with strakes, faired halo pillar, front wing raised in the neutral middle and curling up at the tips,
  footplates, pylons, a spoon rear wing with rounded endplates and their lights, swan-neck pylon, wishbones with push /
  pull / track rods, streamlined mirrors, a visor. ~30k triangles, car.glb 1.4 MB (to shrink in phase 6).

## The car is now based on an open model (2026-10-26/27)

The user found the procedural car looked "like a bunch of attached fancy geometries" and asked for real references /
free models. Four styles measured from the FIA's 2026 renders were offered, then a search of Sketchfab's CC-BY
models; the user picked "F1 2026 concept (polygon model)" by Qvist_designs (CC-BY-4.0, credited in CREDITS.md, the
README, Settings → Tools → Credits, the installers and car.glb's asset.copyright).
- `tools/blender/qvist.py` (stage=build): the download is one fused CAD surface in mm (~1M faces). It is turned into
  the game frame, split into its pieces (four wheels, two mirror glasses, the body), the rear wing's two flaps cut out
  (separate elements in the model), the front wing's flaps cut from the fused wing (faces > 5 cm above the wing's lowest
  across the span), each with a hinge axis (`extras.axis`, swept), painted by region on the full model (numpy), then
  cut down to ~64k triangles keeping the borders between colours (a vertex group), AO baked. Brake lights, a helmet,
  a steering wheel, `eye` / `steer` / `grip_*` / `screen` added. ~13 s plus renders (it took 46+ min with per-face
  Python loops: keep the face work in numpy).
- Game: car-glb.js turns every node with `extras.open` about its `extras.axis`; CarModels.eyeShift (the model's eye
  − the classic seat) moves the cockpit camera (CameraRig.setEyeShift), the mirrors' viewpoint and the driver's body.
- `car_own.py` = our own procedural car (four styles), kept as a fallback, writes tools/blender/out/car_own.glb only.
- To do: car.glb is 4.8 MB (normals + colours per corner): shrink (quantize / weld) in phase 6; UVs for the livery
  patterns (phase 3); the cockpit (phase 5); the car's own mirror glasses sit at the edge of the cockpit view.

### Clean colours and joints (2026-10-27; user: glitches and wrong colours at sharp curves, thin pieces and the joints round the wheels)
The body is one fused surface (one 22 m² patch: no creases between the arms, the floor and the bodywork) made of long
thin CAD triangles, so a colour rule by position cut them into a sawtooth. Now `cut_borders` bisects the faces near
every colour border with its plane first (`body_cuts`: suspension inner ends |z| 0.30 and its box, floor line, wing
edges, endplates, diffuser, T-camera; ~15k faces added), then `body_role` colours per face with exactly those limits:
straight borders. The wheels are coloured by patch (`paint_islands`, faces joined across edges flatter than 30°, a
patch's mean distance from the axle: tyre / rim / nut). Keeping sharp creases in the cut-down was tried and dropped
(everything else flattened into panels). Wheels at 9 % (were 6 %: faceted rims). ~74k triangles. car-glb.js: metal
inside a wheel takes the livery's rim colour.
