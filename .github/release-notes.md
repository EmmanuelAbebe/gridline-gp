**This is an alpha**: an early test version for a few players. Expect rough edges, and please
[report what you find](https://github.com/EmmanuelAbebe/gridline-gp/issues/new?template=bug_report.yml).
Your saved laps and settings carry over to later versions. The game tells you on its start menu when a new version is out.

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
- No online leaderboard yet: share laps with friends through the ghost EXPORT / LOAD buttons in time trial.
- Phone wheel: the phone and the computer must be on the same Wi-Fi (or USB / Bluetooth), and the phone warns about a
  certificate the first time.
- The Intel Mac version is built but hasn't been tested on a real Intel Mac.

Found a bug? Report it [here](https://github.com/EmmanuelAbebe/gridline-gp/issues/new?template=bug_report.yml) with
the game's log (Settings → Tools → Open log folder). For ideas and feedback on how it feels,
use [Discussions](https://github.com/EmmanuelAbebe/gridline-gp/discussions).
