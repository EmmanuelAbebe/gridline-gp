# Gridline GP: project context

A browser F1-style racing game: 1–10 cars, five-light start, lap / timed / unlimited races on five invented circuits
(Elkmoor Park 2.47 km, the original; Harrow Downs 3.89 fast; Cobalt Bay 3.01 street; Marrow Hill 2.60 twisty;
Northfold 4.91 long), picked on the start menu. Built to be driven with the user's phone tilt wheel (github.com/EmmanuelAbebe/Phone-wheel),
which shows up in the browser as a virtual Xbox 360 controller.

## Goal and roadmap (Oct 2026)
Turning the prototype into a production-grade game. Agreed order: (1) foundation [done: modules, Vite, tests],
(2) sim-cade physics in 4 parts: [done] engine/gearbox/downforce/slipstream; [done] tyre + chassis model;
[done] AI on the same chassis (racing line, racecraft, mistakes, difficulty); [done 2026-10-19] tuning screen = the garage (setup + open mods + livery), (3) merge the Phone-wheel project into this one ([done 2026-10-19] server inside Electron,
pairing from the settings menu; [done 2026-10-19] force feedback = phone vibration; still to do: rev lights on the phone, BOX button on the phone, per-device mapping for wheels/joysticks), (4) car/world visuals: [done 2026-10-14] brake lights, cockpit view (user's seat: eye 0.33 m back / 0.77 m high, wheel 0.675 m high; wheel at x 0.18 so the arms reach it, halo visible, driver's arms/legs),
F1-style curved car with textures; halo = one swept `tube` hoop (oval fairing section, teardrop from above, legs behind the shoulders) + a curved centre pillar (design v8, 2026-10-19); still to do: crash physics, scenery, (5) HUD, menus, presentation.

## Files
- `index.html`: markup only; loads `src/game/main.js` as a module.
- `src/sim/`: pure simulation (no DOM, no Three.js; runs in Node). `src/game/`: rendering, input, HUD, tools,
  `main.js` = state machine + boot. `src/styles/`: base, hud, menus, tools, fonts (bundled @fontsource woff2).
- Build: Vite 8 + vite-plugin-singlefile → **one self-contained `dist/index.html`** (code, Three.js r128 from npm,
  CSS, fonts as data URLs; ~720 KB). Opens via file://, in Electron, or served over http. `dist/` is not in git.
  `public/` (manifest, icons, sw.js) is copied into dist as is.
- npm scripts: `dev` (Vite dev server, browser), `dev:app` (dev server inside Electron, `tools/dev-app.mjs`),
  `build`, `start` (build + Electron), `test` (node:test, `tests/*.test.js`), `lint` (ESLint 10, `eslint.config.js`:
  undefined/unused names; `src/sim` gets no browser globals), `typecheck` (`tsc -p .`, TypeScript 6 on plain JS + JSDoc,
  `src/sim` only, see Car state below), `check` (lint + typecheck + test + build), `sim-test`, `sim-trace`.
- Desktop app (Electron, `desktop/main.cjs` + `desktop/preload.cjs`; package is `"type": "module"`, hence .cjs):
  loads `dist/index.html` (or `GRIDLINE_DEV_URL`) in a frameless full-screen window, single instance,
  F5/Ctrl+R reload, Ctrl+Shift+I devtools. GPU: Chromium default; `GRIDLINE_GPU=vulkan` adds the old laptop's
  ANGLE-on-Vulkan switches (they corrupt rendering on the RX 9060 XT). Preload exposes `window.gridlineApp`
  {quit, toggleFullscreen, isFullscreen, onFullscreen}; the page's `AppShell` uses it (quit buttons `[data-quit]`
  only appear in the app). `--smoke-test=out.png` renders offscreen in a throwaway profile (default setup, 10 cars;
  never touches the player's saved settings), screenshots the menu, a running race
  (`out-race.png`), the cockpit view steering right (`out-cockpit.png`) and Settings → Controller from the pause menu (`out-settings.png`), checks the race clock, clicks full screen + quit, prints JSON. Window class `gridline-gp`.
  Electron's localStorage is separate from Chrome's (export/import designs to move them).
- Installers (2026-10-21): electron-builder 26.17.0, config in package.json `build` (files: desktop, dist, public/icons,
  phone-wheel/web/dist; asar): `npm run dist` → `release/` (Linux AppImage + .deb here; Windows NSIS .exe, macOS .dmg
  arm64 + x64 on their own OS; no code signing yet, so Windows SmartScreen / macOS Gatekeeper warn). `.github/workflows/
  installers.yml` builds all three on GitHub's runners, installs each like a player (silent NSIS, dmg → /Applications,
  apt-installed .deb, the AppImage) and plays `--smoke-test` from the installed copy (SwiftShader: no GPU there),
  checked by `tools/check-smoke.mjs`; installers + screenshots as artifacts. First green run 2026-10-21 (run 39580702811):
  Windows (NSIS silent install → AppData\Local\Programs\Gridline GP), macOS arm64 (.dmg → /Applications; virtual
  Metal GPU, no SwiftShader flags: they need Vulkan, which hung the first try), Linux (.deb in /opt/Gridline GP, the
  AppImage with and without --no-sandbox) all pass the full run; ~25–46 fps in software rendering. The AI ghost lap
  times came out identical to the last millisecond on all three (same V8): good news for leaderboard replays. `release/` is excluded via
  .git/info/exclude (the user's .gitignore has uncommitted edits of their own).
- `gridline.sh`: launches the app, rebuilding first when src/index.html/public is newer than dist
  (`--windowed`, `--vulkan`); `--install`/`--uninstall` manage ~/.local/share/applications/gridline-gp.desktop.
- `public/sw.js`: network-first offline cache of index.html + icons (only over http(s)). Bump `CACHE` if rules change.
- Tests and tools: `tests/sim.test.js` (track geometry, AI race, scripted player lap, formats, contact; seeded
  Math.random via `tests/helpers.js`). `tools/sim-test.mjs` prints a race report. `tools/sim-trace.mjs` prints
  seeded hashes of every car's state per step: identical hashes = identical physics (use it to prove a refactor
  changed nothing). Since 2026-10-19 it also traces every other circuit and a 6-lap Marrow race with fuel/tyres/damage on
  (pit stops), so run-off and pit code are covered. Note: reordering a float expression (e.g. replacing
  `(1 − f)·s·s·(3 − 2s)` with `(1 − f)·smoothstep(s)`) changes the last bit and the hashes. Both take an optional other copy of `src/sim/index.js` (e.g. a worktree of an older commit) via
  `tools/load-sim.mjs` (the old single-file `.html` loader was removed 2026-10-21).

## Architecture
Tunables live in data tables (config modules), not inline in the logic.
1. **SIM** (`src/sim/`, exported as one `SIM` object from `index.js`):
   - `tuning.js`: `TUNING` (VMAX nominal, V_CAP, reverse), `CONTACT` (car capsule), `AI` (driver table, see
     driving.js), `CAR` (mass, tyre `grip` 3.0, `aero` liftArea 3.2 / dragArea 1.45, `engine` power curve + rpm
     points, `gearbox` km/h per gear at redline + auto shift points), `CHASSIS`, `SURFACES`, `ASSISTS`, `SLIP` (wake range/width/drag cut), `TRACK_DEFAULTS`,
     `GRID`, `CP`, `LAP_ZONE`, `EV` (event names, incl. SHIFT / SHIFT_DENIED).
   - `vehicle.js`: the one performance model every car uses. `lateralGrip(v)` = grip·(g + downforce/m) (grows with
     v², so corners above ~139 m radius are flat out), `brakeLimit(v)` = the tyres' straight-line ABS limit
     (min(brakeSystem, grip·longGrip·(g + downforce/m))), `cornerSpeed(|k|, share)`, `rpmAt(v, gear)`,
     `drivetrain(c, {thr, brk, shift}, dt)` → engine drive + resistances (drag ×(1 − slip·0.35), rolling, engine
     braking, launch clutch slip in 1st, limiter, shift cut) for chassis.js, `updateGear` (auto: up at 11800, down at 8000 (autoLug 6000 below full throttle without full TC, so part-throttle kick-downs don't spin the rears) on
     the throttle or as soon as the lower gear is < 11000 rpm off it; manual: paddles; a downshift that would over-rev waits in `c.downQueue` and goes in once the lower gear is under the limiter (HUD gear label shows "▼ n"; an upshift cancels the queue; stopped = 1st);
     brake at standstill = reverse). `slipstream(race, c)` sets `c.slip` 0..1 / `c.slipBy` from the leader's trail. `circuits.js`: `CIRCUITS` {name, ctrl, landmarks, blurb, samples?; `id` added}. New circuits use `corners(poly)`:
     polygon vertices [x, z, radius] → arcs of exactly that radius + straights (r 15–25 = hairpin / street corner;
     ≥ ~140 m is flat out with downforce). `landmarks` = sample index or negative = metres before the line.
     `drivers.js`: `DRIVERS`. `math.js`: `wrapA`, `clamp`, `wrapIdx(i, N)` (track-sample wrap, any integer; use it, not
     hand-written `(i + N) % N`), `smoothstep`, `speedOf(c)` = hypot(v, vy) (all on SIM too).
   - `track.js`: `buildTrack(circuit)` → track object: closed centripetal Catmull-Rom → resampled to N equal steps
     of ~`TRACK_DEFAULTS.ds` 2.06 m (Elkmoor fixes samples 1200 so its physics stay bit-identical); AI and limits
     constants are in samples, so every circuit keeps ~2 m spacing. Per sample: `PX/PZ`, tangent `TX/TZ`, right-hand normal `NX/NZ`, signed curvature `K`
     (>0 turns toward +N, i.e. right), plus `bounds`, `HW/KERB/WALL`, and the AI arrays:
     `RO` racing-line offset = a minimum-curvature line (each point moved to minimise the second difference with
     neighbours s and 2s away, s = 24 → 12 → 6 → 3 samples, kept `AI.lineMargin` inside the edge), `LK` the line's
     curvature, `VP` speed profile along the line (`cornerSpeed(|LK|, AI.grip)`, then braking look-back at
     `AI.brake × brakeLimit`; V_CAP on straights so the engine sets straight-line speed). On this line turn 1
     (~770 m) is flat out at ~320 km/h; the hairpin ~107 km/h.
     `SIM.track` is the default (Elkmoor). A new circuit = a new `CIRCUITS` entry; tests/circuits.test.js checks every
     entry (no overlapping run-off, straight before the line for the grid, solo AI lap clean, full field finishes,
     proportional test driver laps it). Fastest-AI solo laps (3-lap best): Elkmoor 32.4, Marrow 42.5, Harrow 53.8, Cobalt 57.8, Northfold 67.6 s.
   - `chassis.js` (every car: player and AI): two-axle bicycle model, 4 sub-steps per 120 Hz step. Axle grip = grip × surface ×
     (weight + downforce·(1 − dirtyAir·slip) ± load transfer from last `c.ax`); tyre curve sin(1.3·atan(Bα)) peaking
     at 0.1 rad front / 0.075 rear (stiffer, 6% grippier rear = stable); friction circle per axle (`axle()`): too
     much brake locks (fronts: understeer), too much drive spins (rears). Brakes split by axle load + 0.12 front
     bias; full pedal = `brakeMax(v)` = brakePedal 1.15 × the straight-line grip limit (≤ 70 m/s²), so only the
     last ~15% of pedal locks at any speed and trail braking works without ABS (2026-10-15: before, a fixed 70 m/s²
     locked at 30% pedal at 120 km/h). Any ABS level fully protects the rears (partial ABS used to let them lock: spins). Below 2–6 m/s of real speed (hypot(v, vy), since 2026-10-17: by v alone a car sliding sideways counted as crawling and
     every spin stopped dead near 90°; v may now go negative = travelling backwards in a spin, brakes act against it)
     blends to kinematic steering (vy = rear-axle
     geometry B_REAR·yawRate, so the rear tyres don't slip; until 2026-10-14 it was 0, which saturated the rears at
     full lock and left a car crawling at 2 m/s on grass); reverse is kinematic. Assists (`ASSISTS` off/low/medium/high, game default medium): `steer` = lock shrinks with speed to the
     tightest steady turn (`steerLock` = geometric angle × limitTurn 1.25 + steerMargin 0.01 rad, raw lock mixed back
     by (1 − assist)²; since 2026-10-15 medium full tilt ≈ the grip limit and half tilt ≈ 60–70% of the cornering: before,
     medium's lock was ~2× the limit at 300 km/h, so a small tilt already slid (user: "tiny tilt makes the car slip")), `stability` = yaw-rate correction when the rear slides + rear brake margin,
     `damping` (high only) = always-on yaw damping for on/off keys, `tc`, `abs`. Car state adds `vy`, `yawRate`,
     `slideF/slideR` (0..1 past the limit), `lockF`, `spinR`. Tuned against bots in tests/chassis.test.js:
     proportional (tilt) and key-tapping drivers lap clean on medium; full-lock keyboard needs high.
   - Assists-off feel (2026-10-21; user drives with assists OFF, "the car behaves violently", wants the real thing,
     no driving aids): measured on an endless-tarmac skidpad, the chassis itself is stable and understeers at the limit;
     the violence came from (1) the steering: without Steering help full tilt is always the 17° lock (at 300 km/h only
     ~20% of the travel is within the grip) → `speedSteer` (driving.js, `SPEED_STEER`, Settings → Controller
     Speed-sensitive steering, pref, default ON): a controller mapping, not a car change: up to 85% of the travel
     reaches medium's speed-scaled lock, the rest the full lock (opposite lock for slides); (2) lift-off / trail-
     braking oversteer at 200+ km/h snapping quicker than a real F1 car → `CHASSIS.aeroYaw` 0.0025 (+ `aeroArm` 1.5 m:
     the side area behind the centre of mass turns the nose toward the direction of travel ∝ v² × the slip angle there,
     so it also damps the rotation; without the arm term it made the bang-bang keyboard driver spin): a 220 km/h lift at
     the limit is now caught by a driver who counter-steers within 0.15 s (spun before), a passive one still spins, 120
     km/h unchanged, steady grip unchanged; AI laps within ±0.2 s (LEGEND Northfold −0.8 s). Tools: none kept; the
     skidpad = stepChassis without afterMove.
   - Off track (2026-10-18; user: "the grass is too punishing", then approved a researched plan, beaching included).
     Before, grass/sand braked at up to 22/30 m/s² down to 60 km/h. Now (`SURFACES`, chassis.js `surfaceDrag` acts
     against the whole motion, sideways slides too): grass grip 0.35 + 2.2 m/s² (keeps the speed, can't brake or turn:
     braking distance > 2× the track's), gravel grip 0.3 + 1.5 m/s² + bite 6.5 from 15 m/s, fading above 22 m/s to
     35% (≈ 0.6–1 g once slow, skims when fast, as tested/measured on real traps), artificial grass (`turf`) 0.6, tarmac
     run-off 0.9, kerb 0.92, sausage kerb 0.55 + a yaw kick (EV.SAUSAGE). `OFFTRACK`: dirty tyres (grip −10% × c.dirt,
     set by grass/gravel/turf (`ROUGH`), clean after 3 s on a hard surface; HUD chip "DIRTY TYRES"); downforce fades past
     14° of slide to 10% at 69° (a spinning car loses its wings; first tried from 8.6°: the AI spun at 330 km/h);
     gravel deeper than 2 m below 2 m/s digs in (drive × 0.2), stopped there 1.5 s = beached (EV.BEACHED), marshals put
     it back beside the track after 4 s (EV.RECOVERED, car.js `updateBeached`, dirty tyres). Keep moving and a car
     crawls out at ~18 km/h. Tests: tests/offtrack.test.js.
   - Run-off layout (`runoff.js` `buildRunoff`, `RUNOFF` in tuning.js; `track.runoff[side]` 0 = left/−N, 1 = right:
     per sample kerb / sausage / turf / gravel / wall distances + zone (ZONE grass|tarmac) + barrier (BARRIER armco|tyres|
     tecpro|concrete)). Class per sample: straight, inside, or outside of a corner by its apex speed (fast > 50 m/s:
     tarmac then gravel 9 m out, TecPro; medium: grass then gravel, tyre wall; slow: tarmac, tyres) + `heavy` m per m/s
     scrubbed in the braking zone; ramps (exit ramps longer), pit wall / grandstand wall on the main straight, then cut
     to the half-way line to any other part of the track (`freeDistance`, grid) and to 0.9/|K| inside tight corners;
     gravel edge smoothed. Outside kerbs run on 15 samples past the exit; sausage kerbs at chicane apexes. Circuit
     `style: 'street'` (Cobalt Bay): concrete walls 3 m from the road, TecPro + tarmac escape roads at corners.
     `surfaceAt(track, i, lat)` = the surface rules; `resolveWalls` uses the side's wall; a hit keeps `BARRIERS[type]
     .keep` of the speed (tyres 0.4 … concrete 0.6) and `impactHard` scales the impact sound/shake. `track.WALL` = the
     furthest barrier. Track limits now also count running wide: whole car past the outside kerb faster than
     `LIMITS.wideSpeed` 15 m/s (c.cutWide; toast "ran wide"). AI: corner speeds × sqrt(downforce lost in dirty air),
     smoothed over `AI.dirtyTime` 0.8 s (halved the run-wides in traffic); ~14 run-wides per 120 car-laps remain at
     Harrow's fast left before the hairpin (in traffic), solo laps unchanged.
   - Pit lane + stops (2026-10-19, `pit.js`, `PIT` / `WEAR` in tuning.js; user asked for a pit lane and reasons to use
     it: low fuel, damage, with messages). `track.pit` (`buildPitLane`; ranges from runoff.js `pitRange`: entry road
     `PIT.entry` samples before the pit wall, wall ±landmarkSpan around `pits`, exit road after; runoff gives the pit
     roads an outer wall (cls 253) and the pit wall (cls 255) after the smoothing). Lateral: pit wall HW+3.5, fast lane
     +2.4, boxes +8 (one per DRIVERS entry, at its garage door), garages +12.5. Entry: driving onto the entry road
     (lat > HW + 2.5) or `c.pitRequest` at its start → `c.pit` {p (unwrapped sample position), phase in/stop/out}:
     `stepPit` drives the car on a path (no chassis, no walls/limits in afterMove, no collisions), 80 km/h limiter,
     stop in the box, service (tyres always 2.4 s, fuel at 12 kg/s to what the race needs + 0.4 lap, wing 3 s, repairs
     up to 5 s), out; laps/timing carry on. Events PIT_IN/STOP/GO/OUT. Race option `createRace(…, { wear: { fuel,
     tyres, damage } })` (`setupWear`; all off by default, so tests/physics are unchanged): fuel normal/high = a tank
     lasts 8/4 laps, cars start with the race distance + 0.4 lap (≤ tank), empty = limp 15% power (FUEL_LOW/BOX/OUT);
     tyres wear over 10/5 laps (sliding × 7), grip × (1 − 0.18 wear²) (TYRES_WORN); damage from walls (nose-on share →
     wing) and contacts (hit ahead of the cockpit → wing): wing → front downforce × (1 − 0.6 w) (understeer), floor →
     downforce × (1 − 0.3 f) + drag, suspension (hard hits) → steering pull + grip (EV.DAMAGE, c.damageNote);
     `carCondition(c)` is what chassis.js applies. AI: `aiWantsPit` once a lap before the entry (fuel won't last,
     tyres > 75% with > 1.5 laps to go, wing > 45%). Tests: tests/pit.test.js (every circuit's lane, a full stop
     sequence ≤ 80 km/h in the lane, ~15–20 s lost, fuel/tyres/damage, a 6-lap thirsty AI race: everyone stops once).
     Game: Settings → Driving Fuel use / Tyre wear / Damage (`game.setup` fuel normal, tyres normal, damage on); BOX
     (B, pad X, HUD button) toggles the request; HUD rows Fuel (laps; amber/red if it won't last) / Tyres % / Damage
     in the position panel, pit status line (BOX THIS LAP / PIT LIMITER / PIT STOP); `Hud.radio` team-radio messages
     for every pit/fuel/tyre/damage event; tower shows PIT, results "n stops". world.js draws the pit roads, lane
     lines, box markings, the pit wall's TecPro nose, PIT 80 boards. The phone wheel has no X button yet.
     2026-10-20 (user: show the crew fixing the specific parts; the car slid into the box with still wheels; wait for
     the driver to leave): stepPit places the car on the path with the heading from a central difference of the path
     (smooth, no per-sample kinks), front wheels steered by the path's curvature (atan(wheelbase·k) / wheelLock), wheels
     rolling (c.roll); after the service `P.done` + EV.PIT_READY, and a player's car leaves only with the gas
     (≥ PIT.release; drivePlayer passes it; the AI goes at once); HUD "GAS TO GO". `serviceSteps(service)` = the jobs in
     order (tyres, fuel, wing, repair). Game `pit-crew.js`: 16 people per car in the race (team colours, jointed box
     rigs) waiting in front of the garage; out when the car is < 140 m away: jacks (car lifted 0.07 m), gunner + carrier
     per wheel (the wheel really comes off: CarModels `setService`), fuel man, wing men with a spare wing, repair crew,
     lollipop man (red / green); nobody stands in the car's way (`wait` / `after` spots). Pit camera (pref `pitCam`,
     Settings → Graphics; CameraRig `setShot` glides to a TV shot over the fast lane, main.js `pitShot`). Debug:
     `gridlineDebug.pitNow(m)` drops your car into the lane m before its box with a damaged wing.
   - `car.js` (locate, createCar, resolveWalls, updateSurface; car has `gear`, `rpm`, `autoShift`, `slip`, `brake`,
     and `trailLat`/`trailT` per track sample = its wake), `race.js` (formats, createRace, progress, lap +
     flag rules, checkpoints, order, gapTo), `motion.js` (afterMove), `driving.js` (drivePlayer, driveAI),
     `collide.js` (cars are capsules `CONTACT` rear 1.5 / front 2.3 m, radius 1.05: side by side fits at 2.1 m;
     rigid-body impulse at the contact point (point velocities incl. yaw, effective mass incl. rotation scaled by `spin` 0.3), restitution 0.1, changes v, vy and yaw; `carGap(a, b)`. 2026-10-18 user: crashes "too violent": the old impulse ignored rotation, a 15 m/s corner-to-corner tap yawed a car at 3.6 rad/s, now 1.5; contact camera shake lighter than walls).
   - Car state: `x, z, h`, `v`, `idx` (nearest sample), `lat`, `lap`. `progress(race, c)` = `lap * N + idx`.
     Since 2026-10-19 `createCar` declares every field, grouped by owning module (pit.js supplies `pitState(slot)`);
     `types.js` defines `Car` / `Race` / `Track` as the factories' return types, sim functions take them via JSDoc
     `@param`, and `npm run typecheck` fails on a field that is misspelt or written without being declared there
     (null-initialised fields use a cast, e.g. `pit: /** @type {PitStop} */ (null)`; Runoff, PitLane, PitStop,
     Service, Wear, Damage, Driver are explicit typedefs). The game never writes into car objects: the interpolated
     render position is `pose.js` `poseOf(c)` {x, z, h} (a WeakMap; `savePoses` before each step, `interpolatePoses`
     per frame; `CarModels.sync(car, pose, dt)`).
     After every move: `updateLap` (wrap >0.8N → <0.2N), `updateCheckpoints`, `resolveWalls`, `updateSurface`.
   - `drivePlayer(race, car, {steer, thr, brk, analog, steerRate, shift}, dt)`: steering ramp (keyboard 5/s; analog
     `steerRate`, default 14, the game sends Infinity = no smoothing unless Settings → Controller sets it), `calm` 0..1 (analog only; game default 1, Settings → Controller "Steering at speed"): `calmSteer` s' = k·s + (1−k)·s³
     with centre slope k = calmLateral 27 / lateralGrip(v), so a small tilt turns the car like the original game at any
     speed while full tilt still reaches the grip limit (the user found the downforce-scaled steering "absurd": up to
     3× the old turn per tilt at 300 km/h); state `c.steerIn` = smoothed input, `c.steer` = shaped. Slipstream, `stepChassis`;
     `driveAI(race, car, dt, skillOverride = 0)`: the AI drives the same chassis through steer/thr/brk (assists
     `AI.assists` = medium). Steering: pure pursuit to a point `look + lookTime·v` ahead on its line offset
     (`c.offset`, moved toward the target at ≤ lineSlope m/m and ≤ lineSpeed m/s) + yaw-rate correction, divided by
     `steerLock`. Speed: skill = driver skill × `race.aiPace` (difficulty); target = VP × skill, reduced off the
     racing line by the offset path's corner speed; brakes once the decel needed over `brakeLook` samples reaches
     ~0.9 × the planned decel (late, not long); no throttle at full lock. Racecraft: car ahead within followRange
     and < sideGap sideways → pass on the side with room (`passBy`/`passSide` sticky); < followLat → close only to
     followGap; within ±alongside → hard clamp of `c.offset` to keep sideGap; close ahead (cutRange) also counts
     where an AI car is heading (`o.offset`). Mistakes: at the start of a braking zone, chance × (1 − skill) × 10
     → `c.mistake` share too fast for `length` m (never with skillOverride). Pointing the wrong way → full lock at
     recoverSpeed. Tests: tests/ai.test.js. Solo fastest-rival laps: pace 0.8 ≈ 36 s, 0.88 ≈ 34, 0.95 ≈ 32.9,
     1.03 ≈ 32.1 (user's best ≈ 33.0 s on 2026-10-13, before the new AI).
   - Track limits (`LIMITS`, race.js `updateLimits`, run in afterMove): a cut = whole car (|lat| − halfWidth 1.1)
     past the edge (HW + KERB where kerbed, else HW) on the inside of a corner (`track.CK` = strongest K within ±20
     samples, > KERB_K) for ≥ cutDist 5 m of track. Each cut: EV.CUT, `c.lapInvalid` (lap can't be best/fastest;
     `c.lastLapInvalid` after the line); after `warnings` 2, each cut adds `penalty` 2 s to `c.penalty` (EV.PENALTY).
     Running wide counts too since 2026-10-18 (see Run-off layout). Classification and finished gaps use `raceTime(c)` = finishTime +
     penalty. Game: warning/penalty toasts, current/last lap time struck through red when invalid, results show
     "+N s pen". Tests: tests/limits.test.js.
   - Active aero + overtake mode (2026-10-19, `active-aero.js`, `ACTIVE_AERO` / `OVERTAKE` in tuning.js; user asked for
     wings that visibly move for corner / attack mode, and chose real physics + an overtake boost). Race option
     `createRace(…, { activeAero, overtake })` (both off by default: tests and sim-trace unchanged; aeroOpen 0 multiplies
     by exactly 1). Zones per circuit (`buildAeroZones` in buildTrack → `track.aeroZone` per sample + `track.aeroZones`):
     the AI profile flat out (VP = V_CAP) for `closeAhead` 45 m and every bend in the next 90 m flat out even with open
     wings, runs ≥ 180 m. `updateActiveAero` (drivePlayer / driveAI, before the chassis): in a zone, throttle ≥ 0.85, no
     brake, |steer| < 0.3, > 30 m/s → `c.aeroOpen` → 1 in 0.35 s (closes in 0.18 s): drag × (1 − 0.24·open) (vehicle.js
     drivetrain), downforce × (1 − 0.36·open) (chassis.js). Same rules for every car (the player's opens automatically),
     so relative pace is unchanged: AI solo laps gain Elkmoor 0.5, Harrow 1.2, Cobalt 0.4, Marrow 0.2, Northfold 1.4 s,
     top speed ~331 → ~352 km/h; rival levels not rescaled. Overtake mode: each lap start (from lap 2) within `gap` 1 s
     of the car ahead (`gapAhead`: from the other cars' trail times at this sample) → `c.boostLeft` 5 s for that lap
     (EV.BOOST_READY); while `c.boostOn` drive × 1.14 (EV.BOOST on/off). AI and `c.boostAuto` players use it in zones when
     within 1.2 s; otherwise the player toggles it (inp.boost). Tests: tests/active-aero.test.js.
     Game: Settings → Driving Active aero ON/OFF, Overtake mode AUTO (default; the phone has no spare button) / BUTTON
     (X, pad View/Back, HUD BOOST button) / OFF (`game.setup.aero/overtake`, setup-store `raceAero`); HUD chips above the
     speedo: STRAIGHT MODE, OVERTAKE READY / OVERTAKE n s; minimap zones in green; radio when the boost is earned.
     (Fixed on the way: Settings → Driving fuel / tyres / damage were written to prefs, not the race setup: settings-
     binding `isDriving` now = any RACE_SETUP.choices key.)
   - Randomness (2026-10-19): each race has its own seeded generator `race.rng` (math.js `mulberry32`, `createRace(…,
     { seed })`, default seed drawn from Math.random, kept as `race.seed`): AI line biases and mistakes use it, nothing
     else in the sim calls Math.random, so the same seed + inputs = the same race (replays, ghosts, learning rivals).
     Switching to it changed the sim-trace baseline once (different draws, same physics; verified first with a
     pass-through rng that the hashes were identical).
   - Race formats: `createRace(format, { track, drivers, aiPace = 1, wear, seed })`, format = number (laps) or { type: 'laps', laps } |
     { type: 'timed', minutes } | { type: 'unlimited' }; `race.laps` / `race.duration` are Infinity when unused.
     Chequered flag (`race.chequered`): first car past the distance, or the leader crossing after time is up;
     then every car finishes at its next crossing (lapped cars too). Finished cars sort by `finishLap`, then time.
   - `gapTo(race, leader, c)`: checkpoint every 20 samples (`cpT`); gap = now − leader's time at my checkpoint.
   - Events (`events.js` `emit(c, EV.X, details)`): cars push `{ type, ...details }` objects into `car.events`; the game
     drains them each step. Details travel in the event, not on the car (since 2026-10-19): WALL {impact, hard, front,
     barrier}, CONTACT {impact, with}, SAUSAGE {impact}, CUT {wide}, PENALTY {seconds, total}, DAMAGE {part},
     PIT_STOP {service}, LAP {time, invalid}, FASTEST {time}, SHIFT {from, to}. `resolveWalls` returns the hit (motion.js
     turns it into damage). Tests count `e.type`.
2. **Game** (`src/game/`, one module per item below, imported in dependency order by `main.js`); modules call down,
   `Input` talks up via events; no state in the DOM.
   - `config.js`: `CONFIG` (timings, intervals, fps thresholds), `SFX`, `COLORS`, `GFX_PROFILES`
     (everything Quality vs Performance changes), `RACE_SETUP`, `PHASE`.
     `RACE_SETUP.choices` = every list-type setup choice ([value, label]; assists/fuel/tyres derived from SIM.ASSISTS /
     SIM.WEAR): main.js `loadSetup` validates against it, the Settings screen and the start menu's race-type / rivals
     buttons (screens.js `fillSeg`) are built from it, `choiceWord` gives the summary words. Add a choice there, not in
     three places. The pit/wall/contact tunables live in tuning.js (`PIT` incl. `garages` shared with world.js, `WEAR`,
     `WALLS`, `CONTACT`, `OFFTRACK`); keep new numbers there too. `util.js`: `$`, formatters.
   - Split out of main.js (2026-10-19): `setup-store.js` (pure: `loadSetup(json)` / `loadPrefs(json)` validation,
     `steerRate`, `raceFormat`, `raceWear`, `buildField`, `playerSlotOf`, `assistsOf`, `setupSummary`),
     `race-messages.js` (pure: `EVENT_MESSAGES` player event → `{ toast, kind, secs }` | `{ radio, secs }` built from
     the event's details, `SAY` = the other race messages; main.js `showMessage` displays one; sounds/shake/flow
     stay in main.js `onPlayerEvent`), `settings-binding.js` (`bindSettings(game, act)`: SettingsScreen get/set/
     note/actions + open over the start/pause menu), `debug.js` (`window.gridlineDebug`: only in the Vite dev server or when desktop/main.cjs runs a test (`--smoke-test`, `--track-shots`, `GRIDLINE_DEBUG=1`): preload `gridlineApp.debug`; never in a player's game), `time-trial.js` (2026-10-21 split: ghost list, recording / EXPORT / LOAD, the see-through car, the live AI rival and delta; `createTimeTrial(ctx)`), `away.js` ("are you there?" overlay + countdown, pause on focus loss). Both pure modules are tested
     in tests/setup-store.test.js (config.js loads in Node: `globalThis.devicePixelRatio`). Add a race message to
     race-messages.js, not inline. main.js keeps state, race flow, commands/buttons, frame loop, circuit switching.
   - `Settings` (try/catch localStorage, key `gridline.gfx`), `createTimers` (race-time delayed callbacks,
     cleared on restart), `createEmitter`.
   - `Display`: renderer (recreated on canvas swap when MSAA changes), scene, camera, GPU detection
     (`gpu.weak` → default Performance), render-scale steps, `stepDown()` for adaptive resolution.
   - `Input`: keyboard/touch/Gamepad → `Input.drive`; key/button bindings are tables (`KEY_ACTIONS`, `PAD`,
     `PAD_ACTIONS`); emits `action`, `padchange`, `gesture`. Steer axes[0] dead zone 0.035, RT gas, LT brake,
     D-pad backup, A confirm, START pause, Y camera; non-standard mapping falls back to triggers on axes 5/2.
     Analog steering is shaped by `Input.setConfig(prefs)`: dead zone → full lock at `range` of travel → curve
     exponent; triggers get their own dead zone.
   - `SettingsScreen` (`settings-screen.js`; start menu SETTINGS, pause menu, HUD button, O): tabs Driving (gearbox,
     assists: they left the start menu), Controller (steering smoothing, default OFF, the only place to change it;
     dead zone, full-lock range, response curve, trigger dead zone, live raw/shaped steering bars, reset), Keys,
     Graphics (mode, FPS counter), Sound (on/off, volume via a master gain), Tools. Built from the `TABS` table; main.js
     binds get/set/note/action. Prefs (`PREFS` in config.js: defaults + limits) saved in localStorage `gridline.prefs`;
     gearbox/assists stay in `game.setup` and apply to the player at once, mid-race too. Opening it mid-race pauses;
     closing returns to the menu it came from. The start menu shows a one-line summary of these choices.
   - Sound (2026-10-16, modern V6 hybrid, all synthesised, no files): `audio/audio-config.js` `SOUND` (every tunable),
     `audio/synth.js` (noise, filters, engine PeriodicWaves, one-shots, HRTF panners; everything takes a time `t`, so
     it renders offline too), `audio/engine-worklet.js` (2026-10-17, after the user said the oscillator engine sounded like an RC toy: a physical
     model on the audio thread: 6 cylinders' combustion pulses (fast rise, decay, combustion noise; per-cylinder spread
     and per-firing jitter → energy at every half order) into 3 exhaust waveguides whose resonances stay fixed while
     the rpm sweeps; Doppler time-scales it; loaded as a Blob module, `loadEngineWorklet(ctx)` before the engine),
     `audio/engine-voice.js` (the graph around it: tanh rasp, exhaust low-pass, limiter cut, airbox / turbo (spool + lift chirp) / ERS outputs,
     overrun pops; light voice for rivals), `audio/sound-engine.js` (buses engine/fx/ambience → compressor; `cabin` EQ
     = the mix: driver (cockpit camera: helmet + earplugs, lows up, highs −9 dB, airbox on, wind down) or tv; 4 rival
     voices on the nearest cars with HRTF, air absorption and Doppler f' = f(c + v_listener·n)/(c + v_source·n) from
     real velocities; tyres, kerb/grass/gravel, wind + dirty-air buffet, crowd at the grandstand, shift crack/blip/
     clunk, shift beep, impacts with metal ring + debris, pass-by whoosh), `audio/scenarios.js` (test scenes:
     Settings → Sound → Test sounds; `npm run sound-check -- dir` renders them offline in Electron to WAVs and checks
     levels + Doppler against the formula). `sound.js` = the live AudioContext + mute/volumes; `race-audio.js` builds
     the per-frame state (listener = camera, its velocity from motion; grid revs before the lights) and turns
     `proximity.js` close passes into whoosh + `CameraRig.shake`; dirty air → `CameraRig.buffet`.
     `SOUND` is live (SOUND_DEFAULTS = shipped values); `sound-studio.js` (Settings → Sound → Sound studio) = a test
     bench (manual rpm/throttle, rev sweep, gears; cockpit/outside; a rival passing at 100/200/300) + 56 sliders over
     SOUND paths, presets Default/Warm/Raw, export/import; saves the overrides (`soundOverrides`) in localStorage
     `gridline.sound`, applied at start. Voices pick edits up live (waves rebuilt on change, `engine.refresh()`).
     2026-10-17 user: first version "a bit harsh" → defaults warmer (less rasp/brightness, more bass; old = Raw preset).
     2026-10-17 user heard a high pitch they couldn't remove: the turbo whistle (sine up to 7.4 kHz) and ERS whine
     bypassed the cabin EQ. Now both go through it (turbo ≤ 5.2 kHz, quieter; ERS a pure sine), shaper oversampling
     4×, noise colour SOUND.noise.colour (0 white / 1 pink default / 2 brown; synth.js colour buffers, live swap;
     modulators always white), SOUND.layers on/off per layer (Studio + Settings → Sound → Noise).
     `npm run sound-check -- dir --race [--colour=n]` renders a real SIM race start from the cockpit with each layer
     off in turn and lists tonal peaks above 1.5 kHz (tools/soundlab/race.js): none since this fix. Dash (`dashGear` in main.js): gear and rpm
     from the car; rev lights from `CONFIG.revLights.from` (8500) to the auto upshift point (all lit = shift).
   - Assists OFF/LOW/MEDIUM/HIGH/CUSTOM (Settings → Driving, `game.setup.assists` → `assistsOf()` → `player.assists`; CUSTOM =
     steering help / stability / traction control / ABS each OFF/LOW/ON, ON = medium's strength, `game.setup.custom`;
     the start-menu summary flags reduced traction control: the user once wondered why the car spun at half throttle on OFF); start menu has Rivals
     ROOKIE/CLUB/PRO/LEGEND (`game.setup.ai` → `RACE_SETUP.aiLevels[].pace` → createRace aiPace; default pro;
     hidden for solo). `Sound.tyres`:
     band-passed noise squeal from slideF/slideR/lock/spin.
   - Gearbox: Settings → Driving AUTO / SEMI-AUTO / MANUAL (`game.setup.gearbox` → `setGearbox`: car.autoShift, car.autoDown = semi: player shifts up, the car's automatic downshift rule also runs). Shift: Q/E, pad LB/RB, and pad A/B (phone buttons
     1/2) = down/up while racing (A still confirms in menus). Paddles in auto mode show a one-time hint.
   - `slipstream-fx.js`: fuzzy band on the road behind each car ahead of the player (≤160 m), built from the car's
     trail + `SIM.wakeHalfWidth`, brighter for the wake the player is in (fainter since 2026-10-20). HUD `#slipTag` chip
     above the speedo. In a tow, GTA-like air streaks (2026-10-20, `STREAKS`): a pool of white additive line segments
     flowing back along the leader's trail past your car, alpha per vertex, count/brightness ∝ player.slip.
   - Tyre marks (2026-10-20): world.js racing line = `markStrip` (UV along the track, per-sample vertex alpha) with
     `tyreStreaks` canvas textures (many thin broken streaks on both wheel tracks; two layers, 23 / 37 m repeats; a
     heavier layer in braking zones), darker with corner curvature and braking. `tyre-marks.js` `createTyreMarks`:
     live marks from every car (sliding / locked fronts / spinning rears, ruts off track; colour per surface), one
     ring-buffer mesh of `MARKS.max` quads, cleared per race. Debug: `gridlineDebug.autopilot(skill)` lets the AI drive
     your car (screenshots), `playerState()`.
   - Quit asks first (2026-10-20): `#quitOv` "Quit the game?" (AppShell `askQuit`; Keep playing focused, Esc / pad A
     = stay, a click beside it = stay); Alt+F4 / window close: main.cjs `close` → `app:ask-quit` → the same question,
     a running race pauses behind it; `app:quit` sets `quitting` so the close goes through.
   - Controls round 2026-10-21 (user asked; full stop / reverse via brake + gas is ON HOLD at their request):
     look back = held R / pad right-stick click (RS) / phone REAR button (bound to RS; phone store v2 adds it to old
     profiles once): CameraRig `setLook(Input.look)`, `LOOK.back` = a rear camera over the nose looking back, snapped to
     and from (the car shows from outside meanwhile); pad right stick = look left / right (`LOOK.side` ~72°, cockpit
     turns the head, chase cameras swing round). Full-lock feedback: haptics.js `l` (held) + `ls` (the moment it gets
     there) at |steer| ≥ 0.98 → phone knock + light buzz (Feedback → Full lock), HUD steer bar red with an end marker,
     phone wheel red. "Are you there?" (`presence.js`, pure, tests/presence.test.js): the phone's own `a` (web
     engine/presence.ts: flat + still, or stiller than a hand in any position, for 10 s (a "dropped / thrown" check was
     removed: spinning the phone set it off); it then sends zeros + a and shows I'M HERE; Layout → Pause when put down),
     a pad with no change at all for 10 s, the driving controller gone
     1 s → `#awayOv`, race paused; back = the phone's I'M HERE / A / Enter / the controller returning → 3-2-1, then it
     runs. Pause on focus loss (pref pauseOnBlur). Rear-view mirror strip on the HUD (pref hudMirror, off by default;
     `hud-mirror.js`: render target from over the cockpit, drawn flipped into `#rearMirror`'s place via
     Display.drawInset; layout panel; radio moves under it). Handbrake (`HANDBRAKE` in tuning.js, `inp.hb`: Space, pad
     LS, phone: a button bound to Left stick click): rears locked, no drive, stability assist off meanwhile; own branch
     so sim-trace is identical without it.
   - `input-monitor.js` (I, start-menu TEST CONTROLS, pause menu): live inputs graph, controller reports/s via
     `Gamepad.timestamp`, stalls (pause with steering moving across it), pedal ramp time, advice.
   - Circuit switching (main.js `setTrack`, start-menu Circuit stepper + outline `drawOutline` + blurb; `game.setup.track`):
     tracks built on first use and cached; world disposed and rebuilt, minimap rebuilt, a finished race on the old
     circuit dropped. `createSlipstreamFx` reads the track from the race each frame.
   - `buildWorld(scene, track, drivers)` (everything in one group; `dispose()`): ground (noise grass texture in the
     theme's colours + mown stripes), road, rubbered racing line + skid marks in braking zones (transparent overlays),
     then from `track.runoff`: kerbs, sausage kerbs, turf, tarmac run-off, gravel, barriers (Armco rails + posts, tyre
     wall + red/white belt, TecPro red/blue blocks, concrete + debris fence (alpha texture)), gantry (posts at the
     walls), grandstand, pit lane + garages; `scenery.js` `buildScenery`: braking boards 300/200/100 m before every
     corner scrubbing > 20 m/s, marshal posts every 280 m, advert boards (`BRANDS`, invented), sponsor bridge on the
     straightest stretch, TV towers + grandstands at the biggest stops, and the theme (`THEMES` in config.js by
     `circuit.theme`: forest Elkmoor, downs Harrow, harbour Cobalt (sea + buildings), woods Marrow, moor Northfold
     (lakes, rocks)). Returns `applyProfile`, `setStartLights`. `npx electron desktop/main.cjs --track-shots=dir`
     renders every circuit from an aerial, the pits and braking into / beside the slowest corners
     (`window.gridlineDebug.view/corners`).
   - One-piece body (2026-10-19; user saw visual glitches on the car: the body was ~14 separate lofts pushed into each
     other, nearly touching surfaces z-fought and the joins were jagged): design shape `body` (`car-body.js`, part
     `body` in design-defaults) = survival cell + nose (`tub`), sidepods (`pods`, mirrored, each with an automatic
     fairing to the tub), engine cover, airbox as ONE watertight skin with a real recessed cockpit (`cockpit` {from, to,
     floor, side}: rounded opening, padded lip, body-colour side walls, dark floor/bulkhead), sidepod inlets and the
     airbox intake = dark forward faces at sharp steps, nose tip in the accent (`accentFrom`). Per station: union of
     superellipses on rays from the cell's centre line (smooth max), dense + refined, resampled, Taubin-smoothed
     (fillets), vertices spaced by length + curvature (`BEND`; without it the cover/airbox crease sawtoothed), stations
     next to a step take the neighbour's directions; creased normals (55°); face `role` attribute → mergeParts colour/
     finish (`BODY_ROLES`). Cached per design (~0.4 s to build in Node), ~31k triangles. Design v6 migrates saves
     (replaces the old body parts by name, keeps the rest). Components should end inside the body, not on top of it
     (an abrupt end = spikes). Proportions checked against the 2026 rules (wheelbase ≤ 3.4 m, cockpit ~0.52 m wide).
     Tests: tests/car-body.test.js (watertight, roles, open cockpit, migration). Showroom `?cam=ex,ey,ez,ax,ay,az,fov`
     = one close-up (`npm run car-shot -- out.png "cam=...&part=body"`).
   - Rear and floor (2026-10-19, design v7): body `keel` (under the tub, down into the floor plate) and taller
     sidepods reaching the floor (narrower at the bottom) so the body sits on the floor; floor loft continues into the
     diffuser kick-up (no separate box), diffuser fences + side walls under the ramp; rear wing main plane + flap
     between curved loft endplates (LED strips on the trailing edges), twin swan-neck pylons, two-element beam wing.
     (Skirts under the sidepods were tried: a "double sausage" from the side; dropped.) Moving parts: a part with
     `open` (degrees) is its own mesh, turned about its position by `open × car.aeroOpen` (front flaps 11 / 20°, rear
     main 4°, flap 24°); tweak panel "Opens °". v7 migration replaces every default-named part with the new defaults,
     keeping the player's own parts and steering wheel. Showroom `?aero=1` = straight mode.
   - `CarModels` (`car-models.js`; shapes in `car-shapes.js`, canvas textures in `car-textures.js`): F1-style body
     from design parts merged per car into one mesh with a geometry group per finish (paint = clearcoat + sky cube
     reflection, carbon = twill weave texture, rubber, metal, light, decal); shapes include `loft` (smooth body
     through cross-sections [x, y, halfW, halfH, roundness, z]), `wing` (cambered airfoil), `rod` (suspension),
     `decal` (race number, `DRIVERS[].number`). Wheels: lathe tyre with rounded shoulders + sidewall texture,
     rim + wheel cover. Brake lights (finish `light`: rain light + endplate strips) brighten with `car.brake`
     (fade ~0.1 s) with a rear-facing additive glow. Model API `sync(car, dt)`, `place`, `useCockpitView`,
     `setMaterials`, `setPedals(thr, brk)`. Cockpit view (player): own nose-to-bulkhead monocoque + open cockpit sides
     (parts with show: cockpit), and `driver-body.js` (lazy, cockpit view only): torso, arms solved by two-bone IK to
     the wheel grips every frame (follow the steering), legs to the pedals (right foot = throttle, left = brake).
     Dev tool: `npm run car-shot -- out.png [driver=MAR&brake=0&part=wing]` renders
     `tools/showroom/` (six views) offscreen via Electron + Vite.
   - Front wing (2026-10-19, design v9): `wing` parts take `stations` [[z, rise, chord ×, pitch°, sweep back], ...]
     (car-shapes.js `sweptWing`: the airfoil lofted through them with Catmull-Rom), so the main plane and both flaps are
     flat across the neutral middle under the nose and curl up / back / twist toward the endplates (1.8 m span, as the
     2026 rules); loft endplates rising behind the flaps and toed out, dark footplates, slim loft nose pylons. The flaps
     keep `open` (active aero). An endplate-top winglet was tried and dropped (it poked through the plate).
     Rear wing (design v10): main plane + flap with stations too: a shallow spoon in the middle, tips curling down and
     growing into the endplates; the beam wing elements bow up over the crash structure.
   - Working mirrors (2026-10-19, `mirrors.js`; user: "make the mirror actually work"): every design part named
     "mirror glass …" on the player's car gets a glass plane (facing the driver) showing a render target: a camera at the
     glass looks along the driver's eye→glass line reflected off the glass (eye = the cockpit camera's back/height, in
     every camera view), `MIRROR` fov 11°, picture flipped left-right (texture repeat −1). Rendered in renderFrame before
     the main render (`Display.renderTo`) only in cockpit view or with the camera within 18 m; Performance mode: half
     resolution, one mirror per frame. Rebuilt with the car design and on graphics-mode change. Showroom `?mirrors=1`
     adds red (left) / blue (right) markers behind the car. Tests: tests/mirrors.test.js.
   - Shadows (2026-10-20; user: "improve the shadow of the car and anything else that casts shadow"): Quality mode =
     sun shadow map (`GFX_PROFILES.quality.shadows` {size 4096, range 110 m}; display.js: PCF soft, a box around where the
     camera looks, snapped to whole texels, drawn once per frame, the mirrors reuse it; sun 44° up, hemisphere 0.68 / sun
     1.08); Performance mode none. `shadows.js`: `markWorldShadows` (everything solid receives, things > 0.3 m tall cast;
     also gives InstancedMesh geometry a bounding sphere around all instances: r128 culled them by the origin),
     `markShadows` for cars / driver (see-through meshes and the ghost car don't). Every car keeps a soft contact shadow
     texture underneath (car-models.js `contactShadow`: footprint, floor, four tyre patches), lighter with sun shadows on.
     Garage: the key light casts on the floor. Design v11: floor and diffuser parts finish `rubber` (gloss paint mirrored
     the sky: a white glow under the car).
   - `CameraRig` (reads `Design.data.cameras` live), `createMinimap` (cached track canvas, dots at 30 Hz),
     `Hud` (cached DOM writes), `Screens` (overlays + start-menu controls).
   - Design tools: `DESIGN_DEFAULTS` (cameras, car parts/wheels/steering wheel, HUD theme + layouts) → `Design`
     store (localStorage `gridline.design`, debounced save, `normalize` fills missing fields; bump `version` and
     migrate there if the format changes). `HudStyle` applies theme (CSS vars) + per-panel layout (anchor/x/y/
     scale/hidden; `all` plus optional per-camera overrides). `LayoutEditor` (L): drag/scroll panels.
     `TweakPanel` (T, or DESIGN button): sliders for every design value, add/duplicate/delete parts, freeze,
     export/import JSON. Car parts are data (box/sphere/cylinder/torus, colour role, show always/outside/
     cockpit/off); car meshes rebuild once per frame after edits. Steering wheel = one assembly: `steer` parts and
     `car.screen` are positioned relative to the wheel centre; `car.steering` = { pivot (centre in car space),
     rot [x,y,z]°, scale [x,y,z], lock° }. Model: root → mount (pivot/rot/scale) → steering mesh (turns with
     input) → screen (always fixed to the wheel). Panel shows wheel width/height in metres via
     `CarModels.measure` (natural size × scale). Design format v11; `migrate()` converts v1 (car-space steer
     parts), v2 (tilt/uniform scale/screen.steer) and v3/v4 (body parts and wheels replaced by the new defaults, the
     player's steering-wheel parts and settings kept; an untouched wheel x 0.45 moves to 0.18). Parts named "… R" get a mirrored "… L" twin (`withMirrors`).
     Shapes: box, rounded (extruded rounded rectangle, `radius`), sphere, cylinder, torus, loft, wing, rod, decal, body, tube (oval section along `path` [x, y, z, halfW?, halfH?], `section`, `up`); optional `finish`.
   - `WheelScreen`: canvas texture on the player's steering wheel (top rev lights, middle speed, bottom gear),
     placed by `car.screen` (pos/rot relative to the wheel, size in metres, show), redrawn ≤ 30 Hz only when visible and values change.
     Key handling ignores keystrokes while a tool input has focus.
   - `AppShell`: full screen (V, FULL SCREEN buttons) via the app bridge or the Fullscreen API; quit buttons.
   - Race setup (start screen): `game.setup` {cars 1–10, type, laps 1–99, minutes from RACE_SETUP.minutes},
     saved in localStorage `gridline.race`. `buildField(cars)` = fastest rivals + player ~78% back; car models
     are looked up by driver code (`modelOf`) and absent ones hidden. Pause menu "End race" freezes the field
     and shows results (`game.ended`). `watchRace` announces time-up and the final lap.
   - Game: `game` state object, phases menu → lights → race → done; `newRace`, `simStep` (fixed 120 Hz),
     `renderFrame` (interpolated `rx/rz/rh`), `monitorFps` (two slow 0.5 s windows < 52 fps → step down).

## Garage: car setup, open mods, livery (2026-10-19; user asked for a car setup screen plus a garage with a free 360°
## camera and open modification of looks and physics; chose "setup + open mods (flagged)" and "your car only")
- SIM: `spec.js` `carSpec(setup, mods)` → per-car numbers (grip, dfK, dragK, aeroFront, frontGrip, rearGrip,
  brakeBias, brakeSystem, power, mass, top/ratio per gear, modified); `STOCK` = the shared car, every AI car's
  `c.spec` (createCar); vehicle.js / chassis.js / driving.js read `c.spec` (functions take a spec, default STOCK).
  `SETUP` (tuning.js) = race setup, trade-offs only: wing 1–11 (lift +7 % / drag +4.5 % per step), aero balance
  40–50 % front, brake balance 51–63 % front, gearing 310–380 km/h top gear, mechanical balance ±5 (front × (1 +
  1.2 %·n), rear × (1 − 1.2 %·n)). `MODS` = open mods, no fairness: power, mass, grip, downforce, drag, brakes; any
  off default → `spec.modified`. Defaults compute every value with the same float operations (× 1 / + 0), so the
  stock car is bit-identical (sim-trace). `spec-stats.js` `specStats(spec)`: top speed, 0–100/200, steady corner speed
  at 30/80/200 m, braking 300→100, balance slow/fast (front grip per load / rear; the garage shows it relative to
  stock). Gearing has no clean acceleration effect in this engine model (uniform ratio scale): its job is matching
  the wing (low wing / slipstream hit the limiter on short gears). Tests: tests/spec.test.js.
- Game: `garage-store.js` (pure: `loadGarage` → { livery { color, accent, rims, number, finish gloss/metallic/satin/
  matte }, setup, mods }, `playerDriver(g)` (the player's DRIVERS entry in the livery: used for the race field, so
  tower / minimap / results show it), `playerSpec(g)`, lap records `loadRecords` / `recordLap` per circuit, stock and
  modified apart), localStorage `gridline.garage` / `gridline.records`. `garage.js` (`Garage`: own Three.js studio scene
  rendered with `Display.renderWith` instead of the race scene while open; a separate car model; tabs Look / Setup /
  Open mods with live stats vs stock, presets, double-click a slider = stock; view buttons 3/4 FRONT SIDE REAR TOP,
  STILL by default, TURNING = auto-turn after 4 s idle), `orbit-camera.js` (pure state + `attachOrbit`: drag = turn, the car
  following the finger (2026-10-20: it was inverted; tested against a Three.js camera's screen-right) (yaw unlimited, pitch to just
  above the floor .. top), wheel / pinch = zoom 2.2–16 m, right / shift drag or two fingers = pan, arrow keys).
  CarModels: `setLivery(l)` (colours, number decal, finish material per car in Quality mode, rim colour role 'rim'),
  `object` = root. Start menu GARAGE button (menu only); setup + mods apply at newRace (`player.spec`), looks at once.
  Results show MODIFIED, the start menu summary "car MODIFIED" / "custom car setup", the circuit line your records,
  a new valid-lap record toasts. The design tools (button in Look) still edit every car's shape. Smoke test: garage
  screenshots `out-garage*.png` (mouse drag, paint, Setup stats, a mod → MODIFIED → reset).

## Controllers and the phone wheel in the app (2026-10-19; user: connect from Settings → Controller, phone now, Xbox pads /
## gamepads / joysticks / wheels later)
- Electron main runs the phone server itself: `desktop/phone-link.cjs` (`createPhoneLink({ dataDir, pagesDir, onInput,
  onStatus })`, `start({ link, port, renewCode })`): https on 8443 (next free up to +10) with a front door that sends TLS to
  https and anything else to a redirect; serves the phone page (phone-wheel/web/dist), `/check`,
  WebSocket `/ws` (`ws` package): `{s,g,b,k}` → onInput, link probes answered `{pong, hz, gap}`, heartbeat, release on
  close and by a 0.4 s watchdog. Self-signed cert made with node-forge (SAN = every address it was needed for, ≤ 8),
  pairing code `phone-token`; both in `<userData>/phone-wheel/`. QR = SVG (`qrcode`). `desktop/phone-net.cjs`: links
  wifi (LAN IP) / bluetooth (BT interface by /sys DEVTYPE, nmcli profile `phone-wheel-bt` like the Python server,
  re-polled every 3 s, cert follows a new address) / usb (adb reverse, plain http on localhost). No virtual pad: the
  input goes over IPC (`main.cjs` phone:start/stop/status, `phone:input` / `phone:status` events; preload
  `gridlineApp.phone`). Tests: tests/phone-link.test.js (real server on a free port).
- Game: `phone-wheel.js` (`PhoneWheel`: the bridge; `pad()` = the phone as a standard-layout gamepad snapshot, phone
  button bits → standard indices, LT/RT = brake/gas), `controllers.js` (`Controllers.list()` = phone + Gamepad API
  devices, `pick(prefs.controller)`: chosen, else phone, else standard pad, else any; `kindOf(id)` guesses wheel /
  joystick / xbox / playstation / gamepad, `KINDS` = label + note per kind: the place for per-kind mapping later),
  `Input` reads `Controllers.pick` (so PAD_ACTIONS etc. work for every device; switching device doesn't fire held
  buttons; 'padchange' (connected, label)). `controller-panel.js` = Settings → Controller top: phone card (link
  WI-FI / BLUETOOTH / USB, Connect / Stop / New pairing code, QR + URL + steps, live state CONNECTED · Hz · ms,
  Start with the game) + controller list (AUTO or USE per device). Settings item type `panel` (built once, kept,
  ticked per frame). Prefs `controller`, `phoneLink`, `phoneAuto` (PREFS.options = allowed text values). Smoke test:
  Connect phone → a WebSocket "phone" steers the car (`gridlineDebug.input()`), screenshot `out-phone.png`.
- Force feedback (2026-10-19): `haptics.js` (pure, tests/haptics.test.js; `HAPTICS` table) turns what the player's car
  feels into `{ fx: { k, kh, o, s, h?, g? } }` (kerb 0..1 + ripples/s, off-track rumble, slide/lock/spin, one-off hit
  from WALL/CONTACT/SAUSAGE, gear shift) at 20 Hz while felt, one all-zero message when it stops (menus, pause,
  finished = nothing); main.js `frame` → `PhoneWheel.feedback` → preload `phone.feedback` → ipc `phone:feedback` →
  phone-link.cjs `feedback(fx)` → every phone socket. The phone (web/src/engine/haptics.ts) makes the vibrate patterns
  and owns the settings (Settings → Feedback: on, strength, per effect, test buttons). The standalone Python server
  sends no feedback (a browser game can't reach it).
- In a plain browser there is no phone server: run phone-wheel/server.py as before (its uinput pad is a controller).
- The phone page itself (2026-10-19): `phone-wheel/web/` (React + TypeScript + Vite; see phone-wheel/web/README.md and
  phone-wheel/CLAUDE.md). `npm run build` also builds it (`phone:build`; `phone:dev` = PC preview with fake tilt,
  `phone:watch`); phone-link.cjs serves `web/dist` at `/` + `/assets/` (the old Preact page and `/v1`, `/classic` were removed 2026-10-21). `npm run typecheck`
  includes it (strict TS), `npm test` runs its tests (`node --experimental-strip-types`).

## Phone wheel notes (standalone project, now in phone-wheel/)
- Project: `phone-wheel/` in this repo since 2026-10-19 (imported with `git subtree` from ~/Downloads/Phone-wheel-main,
  github.com/EmmanuelAbebe/Phone-wheel, history kept; its own `phone-wheel/CLAUDE.md` has the details; its GitHub
  workflow, which never ran from a subfolder, was removed 2026-10-21). aiohttp `server.py` (entry point; code in `phone-wheel/phonewheel/`,
  tests `python -m unittest` in phone-wheel/) serves the
  phone page over HTTPS :8443; phone sends `{s, g, b, k}` over a WebSocket at ~60 Hz. Links: Wi-Fi, `--usb` (adb),
  `--bluetooth` (phone's Bluetooth tethering; see phone-wheel/README.md). Python deps: the old checkout's venv
  (~/Downloads/Phone-wheel-main/venv) works for `phone-wheel/server.py`.
- Gamepad mode in the wheel's server.py (`LinuxGamepadOut`, uinput, VID 045E PID 028E) → Chrome sees a
  standard-mapped Xbox pad. Press gas once with the game focused so the browser exposes it.
- Keyboard mode: server.py only sends keys when the active window title matches `--window` (default
  "slowroads"). For this game use `--window gridline` or `--any-window`.
- Running the game as a local file (not inside the claude.ai artifact frame) avoids any iframe limits on
  the Gamepad API.

## User's machine
Current (Oct 2026): **Ryzen 5 5600 + Radeon RX 9060 XT** (Mesa RADV). Performance is no longer a constraint.
ANGLE-on-Vulkan corrupts the 3D view on this GPU (checker blocks, black rectangles); Chromium's default GL path is fine.
Old laptop (kept for reference): Linux Mint (X11), Flatpak Chrome 153, Intel i7-6600U with **Intel HD Graphics 520**. WebGL is hardware
accelerated through ANGLE on **Vulkan** (flags: ignore-gpu-blocklist, Vulkan, Default ANGLE Vulkan,
Vulkan from ANGLE all Enabled). Turning the Vulkan flags off dropped the game from 30 to 12 fps, so keep
them on. Before Performance mode existed the game ran at ~30 fps; target is 60.

## History / decisions
- No real teams, drivers or liveries: fictional teams (Halcyon, Kestrel, Meridian...).
- A logarithmic depth buffer was tried and removed (slow); road layering uses polygonOffset instead.
- Road strips were wound facing down once (rendered almost black); winding is now up-facing.
- Oct 2026: player was slower on straights (extra drag only on the player); all cars now share the drivetrain, and
  since 2026-10-14 the same chassis (the old kinematic AI and `powertrain()` are gone).
  Car contact fires EV.CONTACT once per touch with `impact` speed → impact sound (walls too).
- Oct 2026: refactored into sections inside one file (pre-git copy was in `backup/`, now replaced by git history).
- 2026-10-13: split into ES modules under `src/` with a Vite single-file build; SIM output bit-identical
  (`tools/sim-trace.mjs` hashes match the last single-file version, commit 80b8966). Three.js and fonts bundled.
- Published as a claude.ai artifact ("Gridline GP"); that copy is a snapshot of the old single file.

## Fastest possible lap (`npm run lap-optimum -- [circuit] [--no-aero] [--tune] [--push=a,b,...]`, 2026-10-19)
`tools/lap-optimum.mjs`: (1) a quasi-steady-state lap model (the sim's grip, downforce, drag, engine/gearbox, brakes,
friction circle, active aero zones) on a line optimised for lap time (coordinate descent on a smooth periodic spline of
offsets, controls within HW − 0.3: centre on the tarmac, so no cuts); (2) a bot drives that line in the real physics
(drivePlayer, medium assists) on the model's corner/braking profile × push; `--tune` raises the push per corner while
the flying lap stays clean (no walls, cuts or spins). The steady skidpad grip of the chassis matches `lateralGrip`
within ~5%, yet the bot is clean up to ~1.16 × the steady profile everywhere and 1.15–1.4 per corner: it brakes
later and carries speed in, sliding wide over the full width incl. kerbs. Northfold (user's best 1:01.675 with
active aero, 1:02.275 before it): model 1:01.07 (no aero 1:02.54); bot uniform 0:58.83, per-corner **0:57.37**
(no aero 0:58.83). Fastest AI (LEGEND) 66.0 s: the AI profile (minimum-curvature line, steady corner speeds × skill)
leaves ~8 s on the table, relevant to the parked smarter-AI plan.

## LEGEND AI and racecraft (2026-10-19; user: "making them interesting enough to battle with the player is the key")
- Line: `racing-lines.js` = time-optimal lines per circuit (made by `npm run lap-optimum -- <id> --margin=2.2
  --write-line`; regenerate after changing a circuit or the car; a circuit whose N changed falls back). track.js
  `buildAiProfile`: RO = min-curvature line blended with it (`AI.lineBlend` 0.5: as fast as the full optimal line for
  the AI, but its edge-to-edge sweeps made side-by-side racing messy), clamped to `lineEdge`; + `APEX` / `BRK` per
  sample (next corner's apex, samples to its braking zone). VP from the blended line as before.
- Measured with full-field AI races (40 races: 5 circuits × 4 seeds × 2, 9 cars, 5 laps; pass = order flip held 3 s;
  hard contact > 3 m/s): following the line *exactly* turned the field into a train (~1/5 of the passes) and the
  fast line made traffic contact-prone; the old rate-limited follow (lineRate/lineSlope: every car a slightly
  different, smoothed line) is what makes passing possible, so it stays. Tried and dropped (each worse: more contacts
  or fewer passes): slipstream tuck-and-pull-out, inside dives with later braking, clean-air lines when following,
  yielding in a squeeze, braking-point traits (they never changed anything: braking comes from VP a few metres ahead).
- Kept (`AI.craft`, driving.js): defending (a real threat: within defendRange 14 m, in our slipstream, ≥ our speed,
  decided once per corner between 160 and 40 m before the braking point, never with a car alongside; one move to the
  inside held to the apex; chance × `traits.defend`), mistakes × (1 + 2.5 × `traits.nerves` × pressure) with a car close
  behind, side-by-side room from where an AI car is *heading* too, alongside window 8 m, line bias ±0.5 m (±0.8 ran
  wide on the new line's exits). Result at PRO pace: passes 410 vs old 394, hard 29 vs 27, cuts 5 vs 15, ~7 defensive
  moves per race; at LEGEND pace on par with the old LEGEND (≈ 470 passes, ~115 hard contacts / 40 races: contact
  rate rises with pace for both). Drivers have `traits { defend, nerves }`.
- Active aero hold fix: wings open at ≥ 0.85 throttle, then stay open down to `holdThr` 0.3 (a car held up behind
  another used to keep them shut on the straights).
- Levels (config AI_LEVELS): ROOKIE 0.79, CLUB 0.86, PRO 0.93, LEGEND 1.0 (old lap times kept within ~±0.6 s per
  circuit), ALIEN (`alien: true` → createRace `aiAlien`, + aiFollow 6).
- ALIEN rebuilt 2026-10-20 (user: "not as interesting as I had hoped: a car that overtakes me even if I drive well";
  ALIEN only, LEGEND and below untouched: sim-trace identical). `AI.alien` in tuning.js. Own line `track.alien` (RO/LK/VP/
  APEX/BRK): racing-lines.js `ALIEN_LINES` (lap-optimum `--margin=0.8 --write-alien`; Cobalt 1.5), car centre allowed to
  0.6 m from the edge, profile braking on the friction circle (track.js lineProfile `circle`), brakeLook 120. In clean
  air: exactly on its line (snap within 1 m), the lap-optimum bot's pedals, no mistakes, pace `AI.alien.pace` per
  circuit (createRace replaces aiPace: 1.16, Marrow 1.12, Cobalt 1.08: the most that stays clean every lap) and the
  drivers' gaps to the fastest × (1 + spread 1.5) (`race.aiTop`). Solo VOS: Elkmoor 29.1, Harrow 49.5, Cobalt 51.6,
  Marrow 38.6, Northfold 59.05 (user's best 59.975). In traffic with AI cars (`c.alienK`, drops in 0.15 s, recovers in
  0.5 s): chase 0.9 / side by side or deep in a wake 0.84 × that pace and the regular pedals (a whole ALIEN field on the
  bot's pedals: ~4× the hard contacts). Hunting the player (within huntLat 7 m, alongside .. towRange 40 m ahead): full
  pace + bot pedals, never closing on the car directly ahead (followCap), on straights sits in the tow and pulls out
  18 m behind to the inside of the next corner. Measured with a stand-in "player" at ~60.0 on pole: VOS passes it on
  lap 1 at Northfold/Harrow, the others don't; 0–1.5 hard contacts with it per race. A late-braking inside dive was
  tried (2× passes, 2.5× contacts) and dropped. Bugs found on the way: the AI never moved toward its line once more
  than `snap` away (if/else split by an inserted block).
- Tests: ai/pit/limits updated (pit: an extra stop for a broken wing is allowed). sim-trace hashes changed (new AI).

## Time trial and ghosts (2026-10-19)
`ghost.js` (pure, tests/ghost.test.js): `createRecorder` (pose x/z/h at 20 Hz + lap time every 20 samples = splits;
started at lights out and at every crossing), `ghostPose`, `ghostDelta`, store per circuit × stock/modified
(`keepGhost` = your best valid lap, localStorage `gridline.ghosts`; files loaded = `gridline.ghosts-loaded`),
`ghostFile` / `readGhostFile` (JSON). Compact form (2026-10-20; user wants players' best laps online later):
`compactGhost` / `expandGhost` = pose as whole-unit second differences (cm, cm, mrad: lossless) + splits as ms steps
(`enc: 'delta2'`); localStorage saves it (`storeJson`; old plain saves still load); EXPORT = `packGhost` (gzip via
CompressionStream, `.json.gz`, `gridlineGhost: 2`), LOAD = `unpackGhost` (gzip or an old plain .json).
`npm run ghost-bench` (tools/ghost-bench.mjs): a lap per circuit in every format: old JSON 14–29 KB → gzipped compact
1.6–2.7 KB (~10×), all five 109 → 11 KB, < 1 ms to pack or unpack. Race type TIME TRIAL (`setup.type 'trial'`): you alone,
unlimited laps, no wear; start menu ghost row (shown ghost, EXPORT your best as a file, LOAD a friend's, MINE = back to
yours); in the race a see-through car (CarModels.ghostMaterials) at the same time into its lap and the HUD "Ghost" delta
(from the first crossing). Every race records your laps (a new best becomes your ghost). Two bests per circuit × class (2026-10-21, user: their
own ghost started out of step): a standing-start lap (lap 1 from the grid at lights out, `start: true`; store slot
'stock:start' / 'modified:start') and a flying lap; in a time trial your lap 1 races the standing one (`game.ghostStart`),
later laps the flying one (`game.ghost`). Old saves without the flag are sorted by their first frames (still = from the
grid). EXPORT sends your flying lap with your standing lap inside (`standing`); LOAD keeps both. AI ghosts (2026-10-20, user: "add the ALIEN or the best driver for the ghost and a list of the AIs and their times";
then: an AI ghost must be the best driver really driving, continuously, no contact): `ai-ghosts.js` (pure,
tests/ai-ghosts.test.js). Start menu ghost row = a list (`#ghostList`): Your best / Loaded / ROOKIE..ALIEN with lap
times and the gap to your best; the pick is `game.setup.ghost` (RACE_SETUP.choices.ghost; a loaded file selects
'loaded'). The times: `aiLap(track, id, level, aero)` = the fastest AI driver (VOS) alone at that level, fixed seed, best
clean flying lap of 3 (~50 ms of sim, cached per circuit × level × aero, made 30 ms after the list first shows), plus its
`line` (x, z, kmh, thr, brk per track sample). An AI pick races `game.rival` = `createRival`: that car in a race of its
own, stepped in lockstep with yours from lights out (simStep; its poses saved/interpolated with yours), so it never
sees or touches you and drives the very laps the list timed (test). Drawn with the see-through ghost model synced to
the real car (wheels, steering, brake lights, wings); HUD Ghost = `rivalGap` (time since the car ahead passed the
other's spot, from both cars' trailT). Recorded ghosts (yours / a file's) are unchanged.
Ghost inputs (`ghost-inputs.js`, HUD `#teleBox`, layout panel "Ghost inputs", pref `ghostInputs`, Settings → Driving):
rolling 6 s charts of the AI ghost's steering / gas / brake with yours in amber, speed + gear of both.
Racing line (`racing-line.js`, pref `racingLine` full / braking / off, Settings → Driving, every race type): the ALIEN's
`aiLap` line on the race's active-aero setting as a 0.9 m ribbon of forward chevrons; colour from `lineColours`: red
where it decelerates > 5 m/s² (darker up to 35; from the speed, since the bot's brake pedal pulses), else amber → green
by its throttle. Braking mode = only the braking zones, fading in 45 m before. `gridlineDebug.showLine()` draws it
without a race (the --track-shots views use it).
The smoke test screenshots the list (`out-trial-menu.png`) and races the live ALIEN ghost (autopilot, `out-ghost.png`). Smoke test: TIME TRIAL row and a
solo start; `GRIDLINE_SMOKE_GHOST=file` loads that ghost and screenshots `out-ghost.png`.

## Ideas not done yet
- Online leaderboard with replay validation: planned 2026-10-20 in `docs/leaderboard-plan.md` (not started; the user
  asked to be reminded). First step: deterministic sim math across JS engines + an input recorder / Node replay.
- Smarter AI: started 2026-10-19 (see "LEGEND AI and racecraft"); still open: rivals that learn the player's lines.
  (Earlier notes:) parked 2026-10-19 by the user "for later once better game mechanics are made". User beat Northfold in
  1:02.275 (fastest AI solo 67.6 s) with other lines through turns 2–3 and 5–6; LEGEND "feels fair: rewards good tries,
  punishes mistakes", so keep its feel. Cause: `RO` is minimum-curvature and `VP` has no acceleration pass, so the AI
  can't trade entry speed for exit speed (corner pairs, exits onto straights). Plan: (1) minimum-time line (forward
  accel pass from the real drivetrain, optimise RO for lap time, check with AI solo laps; rescale levels so LEGEND's
  lap times stay put unless the user says otherwise), (2) an "ALIEN" level above LEGEND = theoretical max, no
  mistakes, (3) rivals that learn from the player: record the player's line/speed per corner on valid laps, adopt it
  where the player is faster (blended), saved per circuit, toggle + reset in settings.
- Qualifying session, tyre wear + pit stops, more circuits (only CTRL needs changing), halo pillar/mirrors
  as an optional cockpit detail, force feedback via phone vibration.
