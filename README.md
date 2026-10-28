# Gridline GP

> **Alpha**: an early test version. Expect rough edges, and please [report bugs](#report-a-bug).

An F1-style racing game for Windows, macOS and Linux. Race up to nine AI rivals or chase ghost laps on nine invented
circuits, three of them with real hills: a forest valley with a steep climb, a figure of eight over a bridge and a
plunging corkscrew. The car runs on a real tyre-and-downforce physics model, with a pit lane, fuel, tyre wear and damage.
Play it with a keyboard or a controller, or turn your phone into a steering wheel: tilt it to steer, and it vibrates
when you hit a kerb.

- **Races** of a set number of laps, a set time or no limit, and **time trial** against your own best lap, a friend's
  ghost lap, or an AI driver at any level from ROOKIE to ALIEN (with its racing line and inputs on screen).
- **Garage**: car setup (wings, balance, gearing), paint and number, and open mods for fun.
- **Driving help** from none up to full, plus automatic, semi-automatic or manual gears.

## Install

Download the file for your computer from the newest version on the
[**Releases page**](https://github.com/EmmanuelAbebe/gridline-gp/releases):

| Your computer | File | How |
|---|---|---|
| Windows 10 / 11 | `…-win-x64.exe` | Run it and follow the installer. Windows may say "Windows protected your PC": click *More info* → *Run anyway*. |
| Mac (M1 or newer) | `…-mac-arm64.dmg` | Open it and drag Gridline GP into Applications. The first time macOS blocks it: click *Done*, then System Settings → Privacy & Security → *Open Anyway*. |
| Mac (Intel) | `…-mac-x64.dmg` | The same as above. |
| Ubuntu, Mint, Debian | `…-linux-amd64.deb` | Double-click it to install, or run `sudo apt install ./Gridline-GP-*.deb`. |
| Other Linux | `…-linux-x86_64.AppImage` | Make it executable (right-click → Properties → Allow executing), then double-click it. |

The warnings appear because the game isn't code-signed by Apple or Microsoft yet. Then start **Gridline GP** from the
Start menu, Launchpad or applications menu. When a new version is out, the game says so on its start menu.

## Play

| | Keyboard | Controller |
|---|---|---|
| Gas / brake | ↑ ↓ or W S | right / left trigger |
| Steer | ← → or A D | left stick |
| Shift down / up | Q E (manual gears) | LB / RB |
| Camera, look back | C, hold R | Y, click the right stick |
| Pause, settings | Esc, O | START |

All controls are listed in Settings → Keys.

**Phone wheel:** go to Settings → Controller → *Connect phone*, with the phone on the same Wi-Fi as the computer.
Scan the QR code with the phone's camera. The phone then warns about the certificate (the game makes its own):
tap *Advanced* → *Proceed*. Hold the phone like a wheel and press gas. USB (Android) and Bluetooth links are in the
same place.

## Report a bug

Open an issue at **[github.com/EmmanuelAbebe/gridline-gp/issues](https://github.com/EmmanuelAbebe/gridline-gp/issues/new?template=bug_report.yml)**
and attach the game's log:

1. In the game, go to Settings → Tools → **Open log folder**.
2. Drag `gridline.log` into the issue. If the game crashed and you started it again, add `gridline-previous.log` too.

If the game doesn't start at all, the log folder is:

- Windows: `%APPDATA%\Gridline GP\logs`
- macOS: `~/Library/Logs/Gridline GP`
- Linux: `~/.config/Gridline GP/logs`

Ideas, or feedback on how it drives? Post them in [Discussions](https://github.com/EmmanuelAbebe/gridline-gp/discussions).

## Build from source

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
npm ci
npm start          # build and play in the desktop app
npm run dev        # development server in the browser
npm run check      # lint, type checks, tests, build
npm run dist       # installers for this OS in release/
```

The 3D models (trees) are made by scripts for [Blender](https://www.blender.org) in `tools/blender/`; the results
are in `src/game/models/`, so you only need Blender to change them: `npm run models`.

The code layout and design notes are in [CLAUDE.md](CLAUDE.md).

### Make a release

Set the version in `package.json` (e.g. `0.1.0-alpha.2`), commit, then push a tag with the same version:

```sh
git tag v0.1.0-alpha.2 && git push origin v0.1.0-alpha.2
```

GitHub Actions then builds the installers on Windows, macOS and Linux. It installs each one, plays a test race with
it, and publishes a release with all the installers once every OS passes. A version with a dash (`-alpha.2`,
`-beta.1`) becomes a pre-release.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE): you may play, change and share the game and its code for free, for any
noncommercial purpose, as long as the licence and its copyright notice go with every copy. Selling it, or any other
commercial use, needs the author's permission: ask in [Discussions](https://github.com/EmmanuelAbebe/gridline-gp/discussions).
Streaming and videos of the game are welcome, monetised ones too.

The 2026 car is based on "F1 2026 concept (polygon model)" by Qvist_designs (CC-BY-4.0); its driver on "race driver" by
BELAZ (CC-BY-4.0, a Ready Player Me avatar: CC BY-NC-SA 4.0), the helmet on "Racing helmet" by MizuCorp and the steering
wheel on "Steering-Wheel type Formula" by OscarContrerasLithgow (both CC-BY-4.0): see [CREDITS.md](CREDITS.md).
