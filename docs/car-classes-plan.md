# Car classes, step 1: one physics engine, the car as data

Asked 2026-11-06 (user: other car types later, "from formula E to karts", with "a single physics mechanism to
accommodate all of them"). This step changes **no physics**: today's 2026 F1 becomes the first car class, and the
sim must stay bit-identical (`node tools/sim-trace.mjs` against a worktree of HEAD) at every stage. New car types
(Formula E, karts, GT) and new physics (four-wheel loads, a solid axle, regen-only rear braking) are later steps.

## Where things are today

- Only part of the car goes through the per-car `c.spec` (spec.js `carSpec` → `STOCK`). The rest is read straight from
  global tables in tuning.js:

  | Table | Read by | Fields used |
  |---|---|---|
  | `CHASSIS` | chassis.js (23 fields as `CH.*`), vehicle.js, driving.js, track.js, collide.js, spec.js, spec-stats.js | wheelbase, track, cgHeight, gyration, tyre curve, brakes, steering, spin, assist gains |
  | `CAR` | vehicle.js, track.js, driving.js, sectors.js, spec.js | loadSens, muMin, engine curve, pedal map, rolling |
  | `ERS` / `ECU` | vehicle.js, chassis.js, car.js, ecu.js, active-aero.js, sectors.js, spec-stats.js | the hybrid power unit |
  | `TYRE_TEMP`, `COMPOUNDS` | tyre-temp.js, pit.js, driving.js | tyre heat, windows, compounds |
  | `WEAR` | pit.js | tank, burn, tyre life, damage |
  | `ACTIVE_AERO`, `OVERTAKE` | vehicle.js, chassis.js, active-aero.js | straight mode, overtake mode |
  | `HITBOX` | collide.js, race.js | the car's shape |
  | `AI` | driving.js, track.js, race.js, active-aero.js | the AI's grip margin, brake share, feel, ALIEN paces |
  | `SETUP`, `MODS`, `SUSPENSION`, `DAMPER`, `DIFF`, `PRESSURE` | spec.js, chassis.js | the garage's ranges and models, as changes from the F1's stock |

- Things computed once **per circuit** use the F1 (`STOCK`): the AI's speed profile and braking points (track.js),
  the active-aero zones (active-aero.js), the corners and sectors (sectors.js), the precomputed racing lines
  (racing-lines.js).
- The game reads `SIM.SETUP`, `MODS`, `ERS`, `ECU`, `COMPOUNDS`, `WEAR` and `HITBOX` in config.js, garage.js,
  garage-store.js, hud.js, main.js, settings-screen.js, starting-grid.js and car-models.js.
- Saved data is keyed by circuit and stock / modified, never by car type: records, ghosts, sectors, lap runs, the
  garage, and the leaderboard's boards (`physics:circuit:aero`).

## The design

A **car class** is one frozen object holding everything that belongs to the car, not the world:

```js
// src/sim/classes/f1-2026.js
export const F1_2026 = Object.freeze({
  id: 'f1', name: 'Formula 1 (2026)',
  body:      { mass, wheelbase, track, cgHeight, frontWeight, gyration },
  tyres:     { grip, loadSens, muMin, peakSlip, rearPeakSlip, rearGrip, falloff, longGrip, lockLateral, slideLong,
               spin, temp: TYRE_TEMP, compounds: COMPOUNDS, pressure: PRESSURE },
  aero:      { rho, liftArea, dragArea, aeroFront, aeroYaw, aeroArm, dirtyAir, active: ACTIVE_AERO },
  power:     { type: 'hybrid', engine, gearbox, ers: ERS, ecu: ECU, overtake: OVERTAKE },
  brakes:    { system, full, rearBrakeMargin },
  steering:  { maxSteer, limitTurn, steerMargin, calmLateral, calmMinSlope },
  chassis:   { suspension: SUSPENSION, damper: DAMPER, diff: DIFF },
  garage:    { setup: SETUP, mods: MODS },
  hitbox:    HITBOX, wear: WEAR,
  ai:        { grip, brake, feel, alien, lines: { racing, alien } },
});
```

`power.type` is the hook later classes use ('hybrid' now; 'electric', 'direct' later). Nothing branches on it in
step 1.

**What stays global** (the world and the integrator, the same for every car): `SURFACES`, `ROUGH`, `OFFTRACK`,
`RUNOFF`, `BARRIERS`, `WALLS`, `ELEVATION`, `LIMITS`, `GRID`, `PIT` (the lane's layout), `CONTACT`, `AIR`, `ASSISTS`,
`SLIP`, `SECTORS`, `EV`, `CHASSIS.substeps`, `lowSpeed` / `blendSpeed`, the assist gains.

**How a car finds its class:** `carSpec(setup, mods, cls = F1_2026)` puts `cls` on the spec; `stockOf(cls)` is cached,
and `STOCK = stockOf(F1_2026)` as today. Physics code reads `c.spec.cls.…` (once per function, into a local, as
chassis.js already does with `CH`). The setup items stay "changes from this class's stock", so each class brings
its own stock baseline.

**Per circuit × class:** the AI profile (RO, VP, BRK, APEX and the ALIEN line), the aero zones and the sectors move
from `track.x` to a cache `aiOf(track, cls)` (the F1's is built where it is built today, so nothing moves in time
or order). The aero zones and the sector layout stay the F1's for every class in step 1: they are part of the
circuit for now, and the sector `key` gets the class so saved bests never compare across classes.

## Stages

Each stage ends with: `npm run check`, sim-trace identical against a worktree of HEAD, `npm run car-bench` showing
the same numbers, `npm run sim-version` and the smoke test. One commit per stage.

1. **Move the tables.** (Done 2026-11-06: the class keeps the tables' shapes for now, one key per table: `car`,
   `chassis`, `ers` …; regroup only where a second class needs it. sim-version now hashes sub-folders.)
   Create `src/sim/classes/f1-2026.js` from the tables above; tuning.js re-exports the old names
   (`export const CHASSIS = F1_2026…`), so no other file changes. A pure move. Also add `CarClass` to types.js.
2. **The spec carries the class.** `carSpec(…, cls)`, `stockOf(cls)`, `c.spec.cls`; `createRace({ carClass })`
   (default F1) gives every car its class's stock spec. Mixed fields are not allowed yet: one class per race.
3. **Physics reads the car's class**, a file at a time, smallest first: collide.js, tyre-temp.js, pit.js,
   active-aero.js, ecu.js, vehicle.js, spec-stats.js, driving.js, then chassis.js. Keep every float expression in
   the same order (a reordering changes the last bit and the hashes; sim-trace finds it at once).
4. **Per circuit × class.** track.js, active-aero.js, sectors.js and racing-lines.js through `aiOf(track, cls)`.
   The AI plans with its own class's spec, not `STOCK`.
5. **A guard.** A test fails if a sim module other than `classes/` and spec.js imports a per-car table from
   tuning.js; then drop the re-exports. A second test races a throwaway class (the F1 with +100 kg, a narrower
   track) to prove nothing still reads the F1 behind its back: the lap must be slower, and the stock F1 unchanged.
6. **The game.** The game asks the race's class for its setup ranges, ECU maps, compounds, wear and hitbox instead
   of `SIM.SETUP` etc.; car-models.js maps a class to its model (`car.glb` for the F1).
7. **Saved data gets the class.** A missing class reads as `'f1'`, so no save needs converting: records, ghosts,
   sectors, lap runs, the garage (setup + mods per class), the ai-ghosts cache key, the replay header, and the
   leaderboard (`physics:class:circuit:aero`; the server reads the old boards as F1, `verify.js` checks the
   replay's class). SIM_VERSION changes with the sim, so the leaderboard needs a redeploy after this stage.

No class picker in the menus yet: with one class there is nothing to pick. It comes with the second class.

## Risks

- **Hidden F1 assumptions in the numbers**, e.g. the brake share the AI learns (0.8 … 1.05), the kinematic blend
  speeds, `spin.mass` "car mass / ~100 kg", the steering's `calmLateral`. Step 1 moves them into the class where
  they belong to the car, and lists in the class file every number that was tuned *only* on the F1, for whoever
  makes the next class.
- **Speed:** one more property lookup per read. Measure the sim's step time before and after (sim-test's race
  timing); it should be lost in the noise.
- **The AI's tables** mix the driver (racecraft, traits, mistakes: global) and the car (grip margin, ALIEN paces,
  lines: per class). Stage 4 splits them.
- **Tools** (lap-optimum, car-bench, sim-test, ghost-bench) take `--class=f1`, default F1.

## After step 1

2. Formula E: a powertrain type 'electric' (motor curve, one gear, battery, regen front and rear, no rear hydraulic
   brakes), little downforce, its own setup ranges.
3. Loads on all four wheels and a solid-axle option, checked against the F1 so its lap times don't move.
4. Karts: inside rear wheel lift, rear-only brakes, direct drive, no suspension.
5. GT cars: mostly data.
