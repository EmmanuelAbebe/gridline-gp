# Phone Wheel: project context

Goal: use a Samsung Galaxy F23 as a tilt steering wheel for the browser game slowroads.io on this PC.

## How it works
- `server.py` (Python, aiohttp) serves `controller.html` + `static/` to the phone over **HTTPS** on port 8443,
  using a self-signed cert it generates for the PC's LAN IP. HTTPS is required because Chrome
  on Android only provides `devicemotion` tilt data to secure pages.
- Phone UI: Preact via htm's standalone build, vendored at `static/vendor/preact-htm.js`, no build step.
  `static/engine.js` = sensors/steering/WebSocket hot path (kept outside Preact rendering),
  `static/settings.js` = defaults, sanitize, profiles in localStorage, curve math,
  `static/app.js` = UI. Old single-file page kept at `/classic` (`static/classic.html`).
- The phone sends `{s, g, b, k}` (steer -1..1, gas 0..1, brake 0..1, button bitmask) over a WebSocket at ~60 Hz.
  Bit i of `k` = `BUTTON_NAMES[i]` in server.py = `BUTTONS[i]` in settings.js (A B X Y LB RB BACK START GUIDE LS RS UP DOWN LEFT RIGHT).
- Flick to shift (`settings.js` `flick` + `createFlick`, `Pedal` in app.js): a thumb on a pedal flicked toward the
  screen centre (≥ distance px within time ms, ≥ 2× sideways) taps a button via `engine.tap(id)` (held 80 ms, repeats
  spaced 50 ms apart): brake = down (LB), gas = up (RB), which Gridline GP uses as paddles. Pedal value is unaffected.
- Browser check: `tools/browser-test.mjs` (Playwright vs `server.py --dry-run --port 8450`, steps in its header).
- Output backends in `server.py`:
  - `GamepadOut` (default on Windows): virtual Xbox 360 pad through `vgamepad`/ViGEmBus.
    Left stick X = steer, RT = gas, LT = brake.
  - `KeyboardOut` (`--keyboard`): arrow keys through `pynput`, partial steering done by pulsing the key.
  - `DryRunOut` (`--dry-run`): prints values only.
- Safety watchdog: everything is released if no message arrives for 0.4 s.
- Pairing: random token (`pairing_token` in the data dir) is in the QR link `?t=`; `/ws` and `/check`
  reject other tokens. PC page with QR + live status: `pc/pair.html` on http://127.0.0.1:<port+1>
  (localhost only, Host header checked). Opened in the browser at start only if the terminal
  couldn't print the QR code (or with `--browser`; `--no-browser` never opens it).
- Packaging: `phone-wheel.spec` (PyInstaller, one file). Frozen builds read pages from `sys._MEIPASS`
  and keep cert/token in the user config dir (`data_dir()` in server.py); from source they stay next to server.py.

## Status
- Works end to end on the user's Linux PC (X11, Flatpak Chrome) as of 2026-10-04:
  user confirmed it drives slowroads perfectly, including the Preact settings UI and QR pairing.
- Not yet run: the GitHub Actions Windows/macOS builds (project isn't a git repo yet).
- Linux gamepad mode = `LinuxGamepadOut` (uinput via python-evdev, Xbox 360 layout). Needs
  writable `/dev/uinput` (udev rule in README) and, for Flatpak Chrome,
  `flatpak override --user --filesystem=/run/udev:ro com.google.Chrome` + Chrome restart.
- Phone steering uses `deviceorientation` (gyro-fused) with `devicemotion` accel fallback;
  tilt math is wrap-safe and handles either gravity sign convention.

## Suggested first steps
1. Check OS and Python version, then install the requirements.
2. Run `python server.py --dry-run`, have the user open the link on their phone, and confirm values change.
3. Run `python server.py` (gamepad mode) and test in slowroads.io.
