**This is an alpha**: an early test version for a few players. Expect rough edges, and please
[report what you find](https://github.com/EmmanuelAbebe/gridline-gp/issues/new?template=bug_report.yml).
Your saved laps and settings carry over to later versions. The game tells you on its start menu when a new version is out.

## New since alpha 1

- **Two car classes**: GP HYBRID (the 2026-style F1) and GP ELECTRIC (a Formula E style car: one gear, regenerative
  braking, a race-long energy budget, attack mode with all-wheel drive, its own model and motor sound). Pick it in the
  CAR step of Race weekend, on the time trial page or in the garage.
- **Online leaderboard**: join with a name in Settings → Tools or on the start menu's LEADERBOARD, then your best clean
  time-trial laps are checked by the server (it replays them) and ranked per circuit. Race the fastest lap's ghost.
  Website: https://gridline-leaderboard.vercel.app
- **Qualifying and a grid by lap time**: a 5 / 10 / 15 minute session, or your best lap there sets where you start.
- **Lap analysis**: sectors and corners, and a lap comparison in 2D (zoom in on the map) and 3D (chase, TV, heli,
  onboard cameras) against your best ever, the AI or a loaded ghost, with throttle, brake and gear.
- **Tyres and strategy**: soft / medium / hard, tyre temperatures, a pit plan in the garage and the pause menu.
- **Car setup**: brakes (migration, engine braking), differential, tyre pressures, suspension, dampers.
- **ECU maps**, your own straight-mode zones, button mapping per controller, a pit limiter and straight mode on buttons.
- **Physics**: wheelspin and lock-ups that build up, collisions with the car's real shape (wings break off), cars can
  be launched into the air.
- **New menus**, pause and results screens; full screen is in Settings → Graphics.
- **Phone wheel**: an ECU map row, the electric car's dash, and you can design its layout from the game.

Laps saved by alpha 1 without the throttle and brake data are removed the first time this version starts (your lap
times and sector times stay).

## Download

| Your computer | File |
|---|---|
| Windows 10 / 11 | `Gridline-GP-…-win-x64.exe` (the installer) |
| Mac with Apple silicon (M1 or newer) | `Gridline-GP-…-mac-arm64.dmg` |
| Mac with an Intel processor | `Gridline-GP-…-mac-x64.dmg` |
| Linux (Ubuntu, Mint, Debian…) | `Gridline-GP-…-linux-amd64.deb` |
| Any other Linux | `Gridline-GP-…-linux-x86_64.AppImage` |

The game isn't code-signed by Apple or Microsoft yet, so your computer warns the first time:
- **Windows**: "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS**: drag Gridline GP into Applications and open it. macOS says it can't check the app: click *Done*, then go to
  System Settings → Privacy & Security, scroll down to "Gridline GP was blocked" and click *Open Anyway*. Only needed once.
- **AppImage**: make it executable (right-click → Properties → Allow executing, or `chmod +x`), then double-click.

## Known issues and what's missing

- Not tested by real players yet: you're the first.
- The physics can behave oddly in extreme cases (huge crashes, spins at very high speed, driving the wrong way).
- No music and no intro / logo screen yet. All sound is the cars, tyres and crowd.
- The leaderboard only ranks the GP HYBRID car so far, and you can race only its fastest lap's ghost.
- The electric car has no invented name yet, and attack mode has no button on the phone wheel.
- Phone wheel: the phone and the computer must be on the same Wi-Fi (or USB / Bluetooth), and the phone warns about a
  certificate the first time.
- The Intel Mac version is built but hasn't been tested on a real Intel Mac.

Found a bug? Report it [here](https://github.com/EmmanuelAbebe/gridline-gp/issues/new?template=bug_report.yml) with
the game's log (Settings → Tools → Open log folder). For ideas and feedback on how it feels,
use [Discussions](https://github.com/EmmanuelAbebe/gridline-gp/discussions).
