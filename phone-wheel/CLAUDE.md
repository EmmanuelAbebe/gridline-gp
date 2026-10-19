# Phone Wheel: project context

Goal: use a Samsung Galaxy F23 as a tilt steering wheel for the browser game slowroads.io on this PC.

## How it works
- Gridline GP's desktop app now has its own server for the same phone page (desktop/phone-link.cjs, Node; see the root
  CLAUDE.md): keep the page's protocol ({s,g,b,k}, /check, /ws, probes {p,r} → {pong,hz,gap}) compatible with both.
- Code layout (2026-10-19, split from one 944-line server.py): `server.py` = the entry point only (so
  `python server.py ...` and `phone-wheel.spec` are unchanged); the code is the `phonewheel/` package:
  `paths` (HERE/RES/DATA, data_dir, mime types), `protocol` (BUTTON_NAMES, `parse_message`, clamp, squash),
  `certs` (ensure_cert, pairing_token; both take an optional folder), `links` (local_ip, adb reverse, Bluetooth:
  bt_link / BluetoothLink + pure parsers `bt_addr_from_ip_json`, `parse_devices`, `match_phones`, `nmcli_reason`),
  `outputs` (GamepadOut, LinuxGamepadOut, KeyboardOut + pure `pulse_keys`, DryRunOut + `dry_line`, pick_output),
  `webapp` (build_app, build_pair_app + `status_snapshot`, serve_https), `main` (argparse, watch_bluetooth, run).
  Tests: `python -m unittest` from phone-wheel/ (stdlib unittest + aiohttp's test client, no extra deps; pytest
  also runs them): tests/test_pure.py (parsing, certs/token in a temp dir, Bluetooth parsers, keyboard pulses) and
  tests/test_web.py (pairing, WebSocket → output, link probe, release on disconnect + watchdog, QR page
  localhost-only). Keep new logic in pure functions so it can be tested the same way.
- `server.py` (Python, aiohttp) serves `controller.html` + `static/` to the phone over **HTTPS** on port 8443,
  using a self-signed cert it generates for the PC's LAN IP. HTTPS is required because Chrome
  on Android only provides `devicemotion` tilt data to secure pages.
- Phone UI (2026-10-19, user wanted it easier to restyle; prefers React / TS): `web/` = React 19 + TypeScript, built by
  Vite (from the Gridline GP root: `npm run phone:dev` desktop preview with fake tilt, `phone:watch`, `phone:build` →
  `web/dist`; deps in the root package.json). See `web/README.md` (theme.css = every colour / size; one component +
  CSS per screen part). `web/src/engine/engine.ts` = the hot path (tilt, pedals, 60 Hz feed, link probes, connection
  phases idle/connecting/connected/lost/unpaired, `reconnect()`), `settings/settings.ts` = defaults, sanitize,
  profiles (same `pw-store` key: old profiles load), curves, flick; `engine/preview.ts` = mouse / arrow-key tilt on a
  PC. New vs the old page: ↻ reconnect and ⛶ full screen (+ landscape lock) in the status bar, a full-screen /
  sideways prompt when the phone is upright while driving, a vibration test. Tests: `web/test/*.test.ts` (node
  --experimental-strip-types, in the root `npm test`). Both servers serve `web/dist/index.html` at `/` when built
  (assets at `/assets/`), else the previous Preact page (`controller.html` + `static/`, no build step), which also
  stays at `/v1`; the single-file one at `/classic`.
- The phone sends `{s, g, b, k}` (steer -1..1, gas 0..1, brake 0..1, button bitmask) over a WebSocket at ~60 Hz.
  Bit i of `k` = `BUTTON_NAMES[i]` in phonewheel/protocol.py = `BUTTONS[i]` in web/src/settings/settings.ts (and static/settings.js) (A B X Y LB RB BACK START GUIDE LS RS UP DOWN LEFT RIGHT).
- Flick to shift (`settings.js` `flick` + `createFlick`, `Pedal` in app.js): a thumb on a pedal flicked toward the
  screen centre (≥ distance px within time ms, ≥ 2× sideways) taps a button via `engine.tap(id)` (held 80 ms, repeats
  spaced 50 ms apart): brake = down (LB), gas = up (RB), which Gridline GP uses as paddles. Pedal value is unaffected.
- Browser check: `tools/browser-test.mjs` (Playwright vs `server.py --dry-run --port 8450`, steps in its header).
- Output backends in `phonewheel/outputs.py`:
  - `GamepadOut` (default on Windows): virtual Xbox 360 pad through `vgamepad`/ViGEmBus.
    Left stick X = steer, RT = gas, LT = brake.
  - `KeyboardOut` (`--keyboard`): arrow keys through `pynput`, partial steering done by pulsing the key.
  - `DryRunOut` (`--dry-run`): prints values only.
- Safety watchdog: everything is released if no message arrives for 0.4 s.
- Links: Wi-Fi (default, https on the LAN IP), `--usb` (http://localhost via `adb reverse`), `--bluetooth [PHONE]`
  (2026-10-19, https on the PC's address on the phone's Bluetooth tethering network: `bt_link()` = bnep*/bt-pan*
  interface (Windows: adapter described "Bluetooth", macOS "Bluetooth PAN"); `BluetoothLink` waits for it and on
  Linux brings it up with nmcli through its own profile `phone-wheel-bt` (panu, ipv4.never-default, ipv6 ignored,
  so the PC's internet never moves to the phone); `watch_bluetooth` re-polls every 3 s, reconnects, and on a new
  address reloads the TLS context and the QR page's link). The certificate covers every IP it was needed for
  (`.cert_ip` = list, up to 8), so switching Wi-Fi ↔ Bluetooth doesn't make a new one each time.
- Pairing: random token (`pairing_token` in the data dir) is in the QR link `?t=`; `/ws` and `/check`
  reject other tokens. PC page with QR + live status: `pc/pair.html` on http://127.0.0.1:<port+1>
  (localhost only, Host header checked). Opened in the browser at start only if the terminal
  couldn't print the QR code (or with `--browser`; `--no-browser` never opens it).
- Packaging: `phone-wheel.spec` (PyInstaller, one file). Frozen builds read pages from `sys._MEIPASS`
  and keep cert/token in the user config dir (`data_dir()` in phonewheel/paths.py); from source they stay next to server.py.

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
