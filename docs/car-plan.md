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
| 1. Blockout | car.py: a rough car to the spec → car.glb; the game loads it behind a switch (garage: car model) next to the current car; the anchors drive the wheels, wings, steering, mirrors, eye | Blender renders + in-game shots side by side |
| 2. Body | survival cell, nose, sidepods (inlets, undercut), engine cover + fin, floor (edge wings, diffuser), halo, front and rear wings with the active-aero elements as hinged objects, suspension, mirrors, cameras | 6 views |
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
