# Gridline GP: project context

A browser F1-style racing game: 1–10 cars, five-light start, lap / timed / unlimited races on an invented 2.47 km circuit
("Elkmoor Park"). Built to be driven with the user's phone tilt wheel (github.com/EmmanuelAbebe/Phone-wheel),
which shows up in the browser as a virtual Xbox 360 controller.

## Files
- `gridline.html`: the whole game, one file. Loads Three.js r128 (UMD) from cdnjs; everything else is inline.
  Open it directly in Chrome (file://) or serve the folder: `python3 -m http.server 8000`.
- Desktop app (Electron, `package.json` + `desktop/`): `desktop/main.js` opens gridline.html from disk in a
  frameless full-screen window (no browser UI), applies the Chrome GPU setup as switches (ignore-gpu-blocklist,
  ANGLE on Vulkan; `GRIDLINE_GPU=default` skips), single instance, F5/Ctrl+R reload, Ctrl+Shift+I devtools.
  `desktop/preload.js` exposes `window.gridlineApp` {quit, toggleFullscreen, isFullscreen, onFullscreen};
  the page's `AppShell` uses it (quit buttons `[data-quit]` only appear in the app). `--smoke-test=out.png`
  runs hidden, screenshots, clicks full screen + quit, prints JSON. Window class `gridline-gp`.
  Electron's localStorage is separate from Chrome's (export/import designs to move them).
- `gridline.sh`: launches the Electron app (`--windowed`, `--safe-gpu`); `--install`/`--uninstall` manage
  ~/.local/share/applications/gridline-gp.desktop. Needs `npm install` once.
- `manifest.webmanifest`, `icons/`, `sw.js`: web/PWA support when served over http (not used by Electron). The service worker is network-first for
  game files (edits show on reload) and precaches Three.js + Google Fonts (CSS and font files) at install,
  so the app starts offline. Bump `CACHE` in sw.js if caching rules change. Registered only over http(s).
- `tools/sim-test.mjs`: headless race check in Node. `node tools/sim-test.mjs [path/to/gridline.html]`.
  Runs a full AI race and a one-lap scripted "player" lap; prints track length, min corner radius,
  finishing order, wall hits. Run it after touching anything inside the SIM block.

## Architecture (gridline.html)
Two `<script>` blocks. Tunables live in data tables at the top of each block, not inline in the logic.
1. **SIM** (between `/*SIM-START*/` and `/*SIM-END*/`): pure JS, no DOM or Three.js, so it runs in Node.
   - Data: `TUNING` (VMAX, ACC, LAT_AI/BRK_AI, LAT_P/BRK_P, ...), `TRACK_DEFAULTS`, `GRID`, `CIRCUITS`
     (control points + render `landmarks` sample indices), `DRIVERS`, `EV` (event names).
   - `buildTrack(circuit)` → track object: closed centripetal Catmull-Rom → resampled to `N = 1200` equal steps
     (`ds` ≈ 2.06 m). Per sample: `PX/PZ`, tangent `TX/TZ`, right-hand normal `NX/NZ`, signed curvature `K`
     (>0 turns toward +N, i.e. right), plus `bounds`, `HW/KERB/WALL`, and the AI arrays:
     `VP` speed profile (sqrt(LAT_AI/|K|), then braking look-back) and `RO` racing-line offset.
     `SIM.track` is the default (Elkmoor). A new circuit = a new `CIRCUITS` entry; nothing else hardcodes it.
   - `createRace(laps, { track, drivers })`: the race carries its track; all physics read `race.track`.
   - Car state: `x, z, h`, `v`, `idx` (nearest sample), `lat`, `lap`. `progress(race, c)` = `lap * N + idx`.
     After every move: `updateLap` (wrap >0.8N → <0.2N), `updateCheckpoints`, `resolveWalls`, `updateSurface`.
   - `drivePlayer(race, car, {steer, thr, brk, analog}, dt)`; `driveAI(race, car, dt, skillOverride = 0)`.
   - Race formats: `createRace(format, { track, drivers })`, format = number (laps) or { type: 'laps', laps } |
     { type: 'timed', minutes } | { type: 'unlimited' }; `race.laps` / `race.duration` are Infinity when unused.
     Chequered flag (`race.chequered`): first car past the distance, or the leader crossing after time is up;
     then every car finishes at its next crossing (lapped cars too). Finished cars sort by `finishLap`, then time.
   - `gapTo(race, leader, c)`: checkpoint every 20 samples (`cpT`); gap = now − leader's time at my checkpoint.
   - Cars push `EV.*` strings into `car.events`; the game drains them each step.
2. **Game**: modules in dependency order; modules call down, `Input` talks up via events; no state in the DOM.
   - Config tables: `CONFIG` (timings, intervals, fps thresholds), `SFX`, `COLORS`, `GFX_PROFILES`
     (everything Quality vs Performance changes), `CAMERAS` (chase / cockpit / high, as numbers), `PHASE`.
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

## Phone wheel notes
- Gamepad mode in the wheel's server.py (`LinuxGamepadOut`, uinput, VID 045E PID 028E) → Chrome sees a
  standard-mapped Xbox pad. Press gas once with the game focused so the browser exposes it.
- Keyboard mode: server.py only sends keys when the active window title matches `--window` (default
  "slowroads"). For this game use `--window gridline` or `--any-window`.
- Running the game as a local file (not inside the claude.ai artifact frame) avoids any iframe limits on
  the Gamepad API.

## User's machine
Linux Mint (X11), Flatpak Chrome 153, Intel i7-6600U with **Intel HD Graphics 520**. WebGL is hardware
accelerated through ANGLE on **Vulkan** (flags: ignore-gpu-blocklist, Vulkan, Default ANGLE Vulkan,
Vulkan from ANGLE all Enabled). Turning the Vulkan flags off dropped the game from 30 to 12 fps, so keep
them on. Before Performance mode existed the game ran at ~30 fps; target is 60.

## History / decisions
- No real teams, drivers or liveries: fictional teams (Halcyon, Kestrel, Meridian...).
- A logarithmic depth buffer was tried and removed (slow); road layering uses polygonOffset instead.
- Road strips were wound facing down once (rendered almost black); winding is now up-facing.
- Oct 2026: player was slower on straights (extra drag only on the player); all cars now share `powertrain()`.
  Car contact fires EV.CONTACT once per touch with `impact` speed → impact sound (walls too).
- Oct 2026: refactored into the module layout above. SIM output is bit-identical to before (seeded
  old-vs-new trace comparison). Pre-refactor copy in `backup/`.
- Published as a claude.ai artifact ("Gridline GP"); that copy is a snapshot of this file.

## Ideas not done yet
- Next performance step if still < 60 fps on the HD 520: fixed low-res render target upscaled to the canvas,
  merge static scenery (gantry, pit doors, grid boxes, hills) into fewer meshes.
- Qualifying session, tyre wear + pit stops, more circuits (only CTRL needs changing), halo pillar/mirrors
  as an optional cockpit detail, force feedback via phone vibration.
