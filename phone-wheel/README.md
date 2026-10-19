# Phone Wheel for slowroads.io

Use your phone (tested layout for a Samsung Galaxy F23) as a tilt steering wheel.

## Quick start with the app

1. Run **PhoneWheel** (`PhoneWheel.exe` on Windows). Its window shows a QR code (`--browser` also
   opens a page with the code and live status at http://127.0.0.1:8444).
2. Scan the QR code with the phone camera (same Wi-Fi). The phone is now paired; phones
   without the code can't connect. `--new-code` makes a fresh code and unpairs every phone.
3. Accept the certificate warning once (Advanced → Proceed), tap **START DRIVING**.

The app keeps its certificate and pairing code in `%APPDATA%\PhoneWheel` (Windows),
`~/Library/Application Support/PhoneWheel` (macOS) or `~/.config/phone-wheel` (Linux).
The same options as below work on it, e.g. `PhoneWheel --keyboard`.

- **Windows**: the virtual controller needs the ViGEmBus driver; if it's missing the app starts its installer.
- **Linux**: needs the one-time uinput rule below (otherwise keyboard mode).
- **macOS**: keyboard mode only. Allow the app under Privacy & Security → Accessibility.

### Building the app

PyInstaller can't cross-compile, so build on each OS (or let GitHub do all three with
`.github/workflows/build.yml`, from the Actions tab):

```
pip install pyinstaller aiohttp cryptography qrcode pynput   # + vgamepad (Windows) or evdev python-xlib (Linux)
pyinstaller phone-wheel.spec                                 # -> dist/PhoneWheel
```

## One-time setup from source (on your PC)

1. Install Python 3.10+ from python.org (tick **"Add Python to PATH"**).
2. Open a terminal in this folder and run:

   ```
   pip install -r requirements.txt
   ```

   On Windows this also installs the **ViGEmBus** driver (a pop-up installer appears;
   accept it). That driver is what creates the virtual Xbox controller.

## Every time you play

1. On the PC: `python server.py`
   - If Windows Firewall asks, allow Python on **Private networks**.
2. Make sure the phone is on the **same Wi-Fi** as the PC.
3. Scan the QR code shown in the terminal (or type the `https://...` link into Chrome).
4. Chrome will say "Your connection is not private" — that's expected for a home-made
   certificate. Tap **Advanced → Proceed**.
5. Tap **START DRIVING**, hold the phone sideways like a wheel.
6. On the PC, open https://slowroads.io and click into the game window.
   Press the gas pedal once so the browser notices the controller.

## Controls

| Phone | Game |
|---|---|
| Tilt left/right | Steer (analog) |
| Right pedal | Gas (RT) |
| Left pedal | Brake (LT) |
| Flick toward the middle while on brake / gas | Shift down / up: one tap of LB / RB (change in Settings → Pedals) |
| On-screen buttons | Any Xbox button or D-pad direction you bind them to (keys `1`…`9` `0` `-` in keyboard mode) |
| **Center** | Makes the current tilt "straight ahead" |
| **⚙ Settings** | Everything below |

Settings (saved on the phone, per profile):

- **Steering**: sensitivity, smoothing, dead zone, response curve, invert, with a live meter.
- **Pedals**, separately for gas and brake: *Hold to build* (pressure grows the longer you hold),
  *Slide* (thumb higher = harder) or *On / off*, plus ramp time, start value, curve and maximum.
- **Buttons**: up to 8, each with a label, a controller button, and hold or toggle.
- **Layout**: swap pedals, pedal width, button size, show wheel, quick sliders, vibration.
- **Profiles**: save, switch, reset, and export/import as text to move settings between phones.

The old single-file page is still at `/classic` if you ever need it.

## Modes

- `python server.py` — virtual Xbox controller (best: smooth analog steering).
  On Windows it uses ViGEmBus. On Linux it uses uinput (`pip install evdev`), which needs a
  one-time permission rule:

  ```
  echo 'KERNEL=="uinput", TAG+="uaccess", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/60-uinput.rules
  sudo udevadm control --reload && sudo udevadm trigger /dev/uinput
  ```

  Without it the server falls back to keyboard mode.
- `python server.py --keyboard` — sends arrow keys instead. Works on Mac/Linux too, and is the
  fallback if the game doesn't pick up the controller. Keys are only sent while a window whose
  title contains "slowroads" (e.g. the Slow Roads tab in Chrome) is in front; switch away and the
  wheel pauses. Change the match with `--window "<title text>"`, or turn it off with `--any-window`.
- `python server.py --dry-run` — prints the values from your phone, handy for testing.

## USB mode (Linux / Mac / Windows)

Over a cable there is no certificate warning and no Wi-Fi lag.

1. Phone: Settings → About phone → Software information → tap **Build number** 7 times,
   then Developer options → turn on **USB debugging**.
2. PC: install adb (`sudo apt install adb` on Mint/Ubuntu), plug in the phone, run
   `adb devices` and tap **Allow** on the phone.
3. Run `python server.py --usb` (combine with `--dry-run` or `--keyboard` as needed).
4. On the phone open **http://localhost:8443** in Chrome.

Unplugging and replugging is fine — the server re-links automatically.

## Linux (Mint / Ubuntu) notes

- Install into a virtual environment: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`,
  then run with `.venv/bin/python server.py ...`.
- The virtual Xbox controller is Windows-only, so on Linux it uses keyboard mode (needs an X11
  session, which is the default on Linux Mint).

## Troubleshooting

- **Page won't load on phone**: wrong Wi-Fi, firewall blocked it, or the PC has several network
  adapters and picked the wrong IP. Run `ipconfig` and try `https://<your Wi-Fi IPv4>:8443`.
- **Steering does nothing / "No tilt data"**: you must use the **https** link. Also check
  Chrome → Settings → Site settings → Motion sensors is allowed.
- **Steering is backwards**: tap **Invert**.
- **Car drifts slowly**: hold the phone straight and tap **Center**.
- **Controller not detected in game**: press gas once on the phone with the game tab focused,
  or use `--keyboard`.
- Safety: if the phone disconnects or the screen turns off, all controls are released within 0.4s.
