# Gridline GP: project context

A browser F1-style racing game: 1–10 cars, five-light start, lap / timed / unlimited races on an invented 2.47 km circuit
("Elkmoor Park"). Built to be driven with the user's phone tilt wheel (github.com/EmmanuelAbebe/Phone-wheel),
which shows up in the browser as a virtual Xbox 360 controller.

## Goal and roadmap (Oct 2026)
Turning the prototype into a production-grade game. Agreed order: (1) foundation [done: modules, Vite, tests],
(2) sim-cade physics: tyre slip, downforce, load transfer, real engine/gearbox (auto + manual paddles),
slipstream, AI on the same physics, (3) merge the Phone-wheel project into this one (server inside Electron,
pairing from the settings menu, vibration + rev lights on the phone), (4) car/world visuals: brake lights,
higher-poly car, crash physics, scenery, (5) HUD, menus, presentation.

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
  only appear in the app). `--smoke-test=out.png` renders offscreen, screenshots the menu and a running race
  (`out-race.png`), checks the race clock, clicks full screen + quit, prints JSON. Window class `gridline-gp`.
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
   - `tuning.js`: `TUNING` (VMAX, ACC, LAT_AI/BRK_AI, LAT_P/BRK_P, ...), `TRACK_DEFAULTS`, `GRID`, `CP`, `LAP_ZONE`,
     `EV` (event names). `circuits.js`: `CIRCUITS` (control points + render `landmarks` sample indices).
     `drivers.js`: `DRIVERS`. `math.js`: `wrapA`, `clamp`.
   - `track.js`: `buildTrack(circuit)` → track object: closed centripetal Catmull-Rom → resampled to `N = 1200` equal steps
     (`ds` ≈ 2.06 m). Per sample: `PX/PZ`, tangent `TX/TZ`, right-hand normal `NX/NZ`, signed curvature `K`
     (>0 turns toward +N, i.e. right), plus `bounds`, `HW/KERB/WALL`, and the AI arrays:
     `VP` speed profile (sqrt(LAT_AI/|K|), then braking look-back) and `RO` racing-line offset.
     `SIM.track` is the default (Elkmoor). A new circuit = a new `CIRCUITS` entry; nothing else hardcodes it.
   - `car.js` (locate, createCar, resolveWalls, updateSurface), `race.js` (formats, createRace, progress, lap +
     flag rules, checkpoints, order, gapTo), `motion.js` (move, afterMove), `driving.js` (powertrain, drivePlayer,
     driveAI), `collide.js`.
   - Car state: `x, z, h`, `v`, `idx` (nearest sample), `lat`, `lap`. `progress(race, c)` = `lap * N + idx`.
     After every move: `updateLap` (wrap >0.8N → <0.2N), `updateCheckpoints`, `resolveWalls`, `updateSurface`.
   - `drivePlayer(race, car, {steer, thr, brk, analog}, dt)`; `driveAI(race, car, dt, skillOverride = 0)`.
   - Race formats: `createRace(format, { track, drivers })`, format = number (laps) or { type: 'laps', laps } |
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
   - `Sound` (WebAudio saw+square engine + beeps), `gearOf` (display-only gearbox).
   - `buildWorld(scene, track, drivers)`: ribbons (`strip`, `wall`, painted layers via polygonOffset `decal`),
     gantry, grandstand/crowd, pits, InstancedMesh trees, hills; returns `applyProfile`, `setStartLights`.
   - `CarModels`: merged vertex-coloured body (`mergeParts`), 4 wheels, blob shadow (6 draw calls/car);
     model API `sync(car)`, `place`, `showDriver` (cockpit camera hides helmet/halo), `setMaterials`.
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
     `CarModels.measure` (natural size × scale). Design format v3; `migrate()` converts v1 (car-space steer
     parts) and v2 (tilt/uniform scale/screen.steer).
     Shapes: box, rounded (extruded rounded rectangle, `radius`), sphere, cylinder, torus.
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

## Phone wheel notes (until it is merged in, roadmap step 3)
- Project: ~/Downloads/Phone-wheel-main (github.com/EmmanuelAbebe/Phone-wheel). aiohttp `server.py` serves the
  phone page over HTTPS :8443; phone sends `{s, g, b, k}` over a WebSocket at ~60 Hz.
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
- Oct 2026: player was slower on straights (extra drag only on the player); all cars now share `powertrain()`.
  Car contact fires EV.CONTACT once per touch with `impact` speed → impact sound (walls too).
- Oct 2026: refactored into sections inside one file (pre-git copy was in `backup/`, now replaced by git history).
- 2026-10-13: split into ES modules under `src/` with a Vite single-file build; SIM output bit-identical
  (`tools/sim-trace.mjs` hashes match the last single-file version, commit 80b8966). Three.js and fonts bundled.
- Published as a claude.ai artifact ("Gridline GP"); that copy is a snapshot of the old single file.

## Ideas not done yet
- Qualifying session, tyre wear + pit stops, more circuits (only CTRL needs changing), halo pillar/mirrors
  as an optional cockpit detail, force feedback via phone vibration.
