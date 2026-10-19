# Gridline GP: project context

A browser F1-style racing game: 1–10 cars, five-light start, lap / timed / unlimited races on five invented circuits
(Elkmoor Park 2.47 km, the original; Harrow Downs 3.89 fast; Cobalt Bay 3.01 street; Marrow Hill 2.60 twisty;
Northfold 4.91 long), picked on the start menu. Built to be driven with the user's phone tilt wheel (github.com/EmmanuelAbebe/Phone-wheel),
which shows up in the browser as a virtual Xbox 360 controller.

## Goal and roadmap (Oct 2026)
Turning the prototype into a production-grade game. Agreed order: (1) foundation [done: modules, Vite, tests],
(2) sim-cade physics in 4 parts: [done] engine/gearbox/downforce/slipstream; [done] tyre + chassis model;
[done] AI on the same chassis (racing line, racecraft, mistakes, difficulty); tuning screen (downforce, grip, power, brake balance), (3) merge the Phone-wheel project into this one (server inside Electron,
pairing from the settings menu, vibration + rev lights on the phone), (4) car/world visuals: [done 2026-10-14] brake lights, cockpit view (user's seat: eye 0.33 m back / 0.77 m high, wheel 0.675 m high; wheel at x 0.18 so the arms reach it, halo visible, driver's arms/legs),
F1-style curved car with textures; still to do: crash physics, scenery, (5) HUD, menus, presentation.

## Files
- `index.html`: markup only; loads `src/game/main.js` as a module.
- `src/sim/`: pure simulation (no DOM, no Three.js; runs in Node). `src/game/`: rendering, input, HUD, tools,
  `main.js` = state machine + boot. `src/styles/`: base, hud, menus, tools, fonts (bundled @fontsource woff2).
- Build: Vite 8 + vite-plugin-singlefile → **one self-contained `dist/index.html`** (code, Three.js r128 from npm,
  CSS, fonts as data URLs; ~720 KB). Opens via file://, in Electron, or served over http. `dist/` is not in git.
  `public/` (manifest, icons, sw.js) is copied into dist as is.
- npm scripts: `dev` (Vite dev server, browser), `dev:app` (dev server inside Electron, `tools/dev-app.mjs`),
  `build`, `start` (build + Electron), `test` (node:test, `tests/*.test.js`), `lint` (ESLint 10, `eslint.config.js`:
  undefined/unused names; `src/sim` gets no browser globals), `check` (lint + test + build), `sim-test`, `sim-trace`.
- Desktop app (Electron, `desktop/main.cjs` + `desktop/preload.cjs`; package is `"type": "module"`, hence .cjs):
  loads `dist/index.html` (or `GRIDLINE_DEV_URL`) in a frameless full-screen window, single instance,
  F5/Ctrl+R reload, Ctrl+Shift+I devtools. GPU: Chromium default; `GRIDLINE_GPU=vulkan` adds the old laptop's
  ANGLE-on-Vulkan switches (they corrupt rendering on the RX 9060 XT). Preload exposes `window.gridlineApp`
  {quit, toggleFullscreen, isFullscreen, onFullscreen}; the page's `AppShell` uses it (quit buttons `[data-quit]`
  only appear in the app). `--smoke-test=out.png` renders offscreen in a throwaway profile (default setup, 10 cars;
  never touches the player's saved settings), screenshots the menu, a running race
  (`out-race.png`), the cockpit view steering right (`out-cockpit.png`) and Settings → Controller from the pause menu (`out-settings.png`), checks the race clock, clicks full screen + quit, prints JSON. Window class `gridline-gp`.
  Electron's localStorage is separate from Chrome's (export/import designs to move them).
- `gridline.sh`: launches the app, rebuilding first when src/index.html/public is newer than dist
  (`--windowed`, `--vulkan`); `--install`/`--uninstall` manage ~/.local/share/applications/gridline-gp.desktop.
- `public/sw.js`: network-first offline cache of index.html + icons (only over http(s)). Bump `CACHE` if rules change.
- Tests and tools: `tests/sim.test.js` (track geometry, AI race, scripted player lap, formats, contact; seeded
  Math.random via `tests/helpers.js`). `tools/sim-test.mjs` prints a race report. `tools/sim-trace.mjs` prints
  seeded hashes of every car's state per step: identical hashes = identical physics (use it to prove a refactor
  changed nothing). Both take an optional old single-file `.html` (`git show <rev>:gridline.html`) via
  `tools/load-sim.mjs`.

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
     `drivers.js`: `DRIVERS`. `math.js`: `wrapA`, `clamp`.
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
   - `car.js` (locate, createCar, resolveWalls, updateSurface; car has `gear`, `rpm`, `autoShift`, `slip`, `brake`,
     and `trailLat`/`trailT` per track sample = its wake), `race.js` (formats, createRace, progress, lap +
     flag rules, checkpoints, order, gapTo), `motion.js` (afterMove), `driving.js` (drivePlayer, driveAI),
     `collide.js` (cars are capsules `CONTACT` rear 1.5 / front 2.3 m, radius 1.05: side by side fits at 2.1 m;
     rigid-body impulse at the contact point (point velocities incl. yaw, effective mass incl. rotation scaled by `spin` 0.3), restitution 0.1, changes v, vy and yaw; `carGap(a, b)`. 2026-10-18 user: crashes "too violent": the old impulse ignored rotation, a 15 m/s corner-to-corner tap yawed a car at 3.6 rad/s, now 1.5; contact camera shake lighter than walls).
   - Car state: `x, z, h`, `v`, `idx` (nearest sample), `lat`, `lap`. `progress(race, c)` = `lap * N + idx`.
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
   - Race formats: `createRace(format, { track, drivers, aiPace = 1 })`, format = number (laps) or { type: 'laps', laps } |
     { type: 'timed', minutes } | { type: 'unlimited' }; `race.laps` / `race.duration` are Infinity when unused.
     Chequered flag (`race.chequered`): first car past the distance, or the leader crossing after time is up;
     then every car finishes at its next crossing (lapped cars too). Finished cars sort by `finishLap`, then time.
   - `gapTo(race, leader, c)`: checkpoint every 20 samples (`cpT`); gap = now − leader's time at my checkpoint.
   - Cars push `EV.*` strings into `car.events`; the game drains them each step.
2. **Game** (`src/game/`, one module per item below, imported in dependency order by `main.js`); modules call down,
   `Input` talks up via events; no state in the DOM.
   - `config.js`: `CONFIG` (timings, intervals, fps thresholds), `SFX`, `COLORS`, `GFX_PROFILES`
     (everything Quality vs Performance changes), `RACE_SETUP`, `PHASE`. `util.js`: `$`, formatters.
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
     trail + `SIM.wakeHalfWidth`, brighter for the wake the player is in. HUD `#slipTag` chip above the speedo.
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
     `CarModels.measure` (natural size × scale). Design format v5; `migrate()` converts v1 (car-space steer
     parts), v2 (tilt/uniform scale/screen.steer) and v3/v4 (body parts and wheels replaced by the new defaults, the
     player's steering-wheel parts and settings kept; an untouched wheel x 0.45 moves to 0.18). Parts named "… R" get a mirrored "… L" twin (`withMirrors`).
     Shapes: box, rounded (extruded rounded rectangle, `radius`), sphere, cylinder, torus, loft, wing, rod, decal; optional `finish`.
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

## Phone wheel notes (roadmap step 3: merging it in)
- Project: `phone-wheel/` in this repo since 2026-10-19 (imported with `git subtree` from ~/Downloads/Phone-wheel-main,
  github.com/EmmanuelAbebe/Phone-wheel, history kept; its own `phone-wheel/CLAUDE.md` has the details; its GitHub
  workflow in `phone-wheel/.github` doesn't run from a subfolder). aiohttp `server.py` serves the
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

## Ideas not done yet
- Smarter AI (parked 2026-10-19 by the user "for later once better game mechanics are made"). User beat Northfold in
  1:02.275 (fastest AI solo 67.6 s) with other lines through turns 2–3 and 5–6; LEGEND "feels fair: rewards good tries,
  punishes mistakes", so keep its feel. Cause: `RO` is minimum-curvature and `VP` has no acceleration pass, so the AI
  can't trade entry speed for exit speed (corner pairs, exits onto straights). Plan: (1) minimum-time line (forward
  accel pass from the real drivetrain, optimise RO for lap time, check with AI solo laps; rescale levels so LEGEND's
  lap times stay put unless the user says otherwise), (2) an "ALIEN" level above LEGEND = theoretical max, no
  mistakes, (3) rivals that learn from the player: record the player's line/speed per corner on valid laps, adopt it
  where the player is faster (blended), saved per circuit, toggle + reset in settings.
- Qualifying session, tyre wear + pit stops, more circuits (only CTRL needs changing), halo pillar/mirrors
  as an optional cockpit detail, force feedback via phone vibration.
