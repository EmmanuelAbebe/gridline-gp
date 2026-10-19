#!/usr/bin/env python3
"""
Phone Wheel - use your phone as a steering wheel for slowroads.io

Run this on your PC, open the printed https:// link on your phone
(same Wi-Fi), tilt to steer, press the on-screen pedals.

Output modes:
  gamepad   (default on Windows) - virtual Xbox 360 controller, analog steering
  keyboard  (--keyboard)         - arrow keys, steering simulated by fast tapping
  dry run   (--dry-run)          - just prints values, for testing the phone side

Connection:
  Wi-Fi (default) - https on the LAN with a self-signed certificate
  USB   (--usb)   - plain http on localhost, tunnelled to the phone with `adb reverse`
"""
import argparse
import asyncio
import collections
import datetime
import hmac
import os
import secrets
import ipaddress
import json
import mimetypes
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from aiohttp import WSMsgType, web

HERE = Path(__file__).resolve().parent
FROZEN = getattr(sys, "frozen", False)
# Read-only files (web pages) live next to the script, or inside the bundle when packaged.
RES = Path(getattr(sys, "_MEIPASS", HERE))


def data_dir():
    """Where the certificate and pairing code are kept. Next to the script when run from
    source; in the user's settings folder when packaged (the bundle itself is read-only)."""
    if not FROZEN:
        return HERE
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
        d = base / "PhoneWheel"
    elif sys.platform == "darwin":
        d = Path.home() / "Library" / "Application Support" / "PhoneWheel"
    else:
        d = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "phone-wheel"
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA = data_dir()

# The phone page loads ES modules, which browsers refuse unless served as JavaScript.
# Some Windows installs map .js to text/plain in the registry, so pin it here.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# Bit i of the phone's `k` field = BUTTON_NAMES[i] (same order as static/settings.js).
BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "BACK", "START", "GUIDE", "LS", "RS",
                "UP", "DOWN", "LEFT", "RIGHT"]
BUTTON_MASK = (1 << len(BUTTON_NAMES)) - 1

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


# ----------------------------------------------------------------- helpers
def squash(text):
    """Lowercase letters and digits only, so "s l o w  r o a d s" (odd spacing) matches "slowroads"."""
    return "".join(c for c in text.lower() if c.isalnum())


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def local_ip():
    """Best guess at this PC's Wi-Fi/LAN address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # no packets are actually sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    """Phones only give tilt sensor data to https pages, so we make a
    self-signed certificate for this PC's IP (regenerated if the IP changes)."""
    cert_p, key_p, tag_p = DATA / "cert.pem", DATA / "key.pem", DATA / ".cert_ip"
    if cert_p.exists() and key_p.exists() and tag_p.exists() and tag_p.read_text().strip() == ip:
        return cert_p, key_p

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "phone-wheel")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.IPAddress(ipaddress.ip_address(ip)), x509.DNSName("localhost")]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    key_p.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    cert_p.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    tag_p.write_text(ip)
    return cert_p, key_p


def pairing_token(renew=False):
    """Secret that goes into the QR link. Phones without it can't drive this PC, so other
    people on the same Wi-Fi can't take over. Kept between runs so a paired phone stays paired."""
    p = DATA / "pairing_token"
    if not renew and p.exists():
        tok = p.read_text().strip()
        if len(tok) >= 16:
            return tok
    tok = secrets.token_urlsafe(16)
    p.write_text(tok)
    try:
        p.chmod(0o600)
    except OSError:
        pass
    return tok


def keep_adb_reverse(port):
    """USB mode: map the phone's localhost:port to ours through adb. Re-applied
    every few seconds so unplugging and replugging the cable just works."""
    linked = None
    while True:
        try:
            r = subprocess.run(
                ["adb", "reverse", f"tcp:{port}", f"tcp:{port}"],
                capture_output=True, text=True, timeout=5,
            )
            ok = r.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            ok = False
        if ok != linked:
            linked = ok
            if ok:
                print(f"\n  USB link up - open http://localhost:{port} in Chrome on the phone")
            else:
                print("\n  Waiting for phone over USB (plug in, enable USB debugging, accept the prompt)...")
        time.sleep(3)


# ----------------------------------------------------------------- outputs
class GamepadOut:
    """Virtual Xbox 360 pad: left stick X = steering, RT = gas, LT = brake,
    phone buttons = whatever controller button they're bound to on the phone."""

    name = "virtual Xbox controller (analog steering)"

    def __init__(self):
        import vgamepad as vg

        self.pad = vg.VX360Gamepad()
        B = vg.XUSB_BUTTON
        self.buttons = [getattr(B, "XUSB_GAMEPAD_" + n) for n in (
            "A", "B", "X", "Y", "LEFT_SHOULDER", "RIGHT_SHOULDER", "BACK", "START", "GUIDE",
            "LEFT_THUMB", "RIGHT_THUMB", "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT")]
        self.apply(0, 0, 0)

    def apply(self, s, g, b, k=0):
        self.pad.left_joystick_float(x_value_float=s, y_value_float=0.0)
        self.pad.right_trigger_float(value_float=g)
        self.pad.left_trigger_float(value_float=b)
        for i, btn in enumerate(self.buttons):
            if k >> i & 1:
                self.pad.press_button(button=btn)
            else:
                self.pad.release_button(button=btn)
        self.pad.update()

    def close(self):
        self.pad.reset()
        self.pad.update()


class LinuxGamepadOut:
    """Linux: virtual Xbox 360 pad through uinput, laid out like the real xpad driver
    so Chrome maps it as a standard gamepad. Left stick X = steering, RT = gas,
    LT = brake, phone buttons = whatever controller button they're bound to on the phone.
    Needs write access to /dev/uinput (see README)."""

    name = "virtual Xbox controller via uinput (analog steering)"

    def __init__(self):
        from evdev import AbsInfo, UInput, ecodes as e

        self.e = e
        stick = AbsInfo(0, -32768, 32767, 0, 0, 0)  # no fuzz/flat: keep tiny wheel movements
        trig = AbsInfo(0, 0, 255, 0, 0, 0)
        hat = AbsInfo(0, -1, 1, 0, 0, 0)
        cap = {
            e.EV_KEY: [e.BTN_A, e.BTN_B, e.BTN_X, e.BTN_Y, e.BTN_TL, e.BTN_TR, e.BTN_SELECT,
                       e.BTN_START, e.BTN_MODE, e.BTN_THUMBL, e.BTN_THUMBR],
            e.EV_ABS: [(e.ABS_X, stick), (e.ABS_Y, stick), (e.ABS_Z, trig), (e.ABS_RX, stick),
                       (e.ABS_RY, stick), (e.ABS_RZ, trig), (e.ABS_HAT0X, hat), (e.ABS_HAT0Y, hat)],
        }
        self.ui = UInput(cap, name="Microsoft X-Box 360 pad", vendor=0x045E, product=0x028E,
                         version=0x110, bustype=e.BUS_USB)
        self.buttons = [e.BTN_A, e.BTN_B, e.BTN_X, e.BTN_Y, e.BTN_TL, e.BTN_TR, e.BTN_SELECT,
                        e.BTN_START, e.BTN_MODE, e.BTN_THUMBL, e.BTN_THUMBR]
        self.apply(0, 0, 0)

    def apply(self, s, g, b, k=0):
        e = self.e
        self.ui.write(e.EV_ABS, e.ABS_X, int(round(s * 32767)))
        self.ui.write(e.EV_ABS, e.ABS_RZ, int(round(g * 255)))
        self.ui.write(e.EV_ABS, e.ABS_Z, int(round(b * 255)))
        for i, btn in enumerate(self.buttons):
            self.ui.write(e.EV_KEY, btn, k >> i & 1)
        # D-pad is a hat on Xbox pads: bits 11-14 = up, down, left, right.
        self.ui.write(e.EV_ABS, e.ABS_HAT0Y, (k >> 12 & 1) - (k >> 11 & 1))
        self.ui.write(e.EV_ABS, e.ABS_HAT0X, (k >> 14 & 1) - (k >> 13 & 1))
        self.ui.syn()

    def close(self):
        self.apply(0, 0, 0)
        self.ui.close()


class KeyboardOut:
    """Arrow keys. A keyboard can only be on/off, so partial steering is done
    by pulsing the key: 30% tilt = key held 30% of the time.
    Phone buttons bound to A..RS press the keys 1 2 3 4 5 6 7 8 9 0 - (the D-pad isn't sent,
    the arrow keys are already used for driving)."""

    name = "keyboard (arrow keys)"
    PERIOD = 0.12  # seconds per pulse cycle
    STEER_DEADZONE = 0.12  # ignore hand jitter around straight ahead

    def __init__(self, window_match="slowroads"):
        from pynput.keyboard import Controller, Key

        self.kb = Controller()
        self.keys = {"left": Key.left, "right": Key.right, "up": Key.up, "down": Key.down}
        self.button_keys = list("1234567890-")
        self.keys.update({c: c for c in self.button_keys})
        self.held = set()
        self.s = self.g = self.b = 0.0
        self.k = 0
        self.running = True
        # Keys only go out while the game window is in front, so the rest of the PC stays usable.
        self.window_match = squash(window_match) if window_match else None
        self.focused = self.window_match is None
        if self.window_match:
            threading.Thread(target=self._watch_focus, daemon=True).start()
        threading.Thread(target=self._loop, daemon=True).start()

    def _active_title_fn(self):
        """Return a function that gives the active window's title."""
        if sys.platform == "win32":
            import ctypes

            u32 = ctypes.windll.user32

            def title():
                h = u32.GetForegroundWindow()
                buf = ctypes.create_unicode_buffer(512)
                u32.GetWindowTextW(h, buf, 512)
                return buf.value

            return title
        from Xlib import X, display

        d = display.Display()
        root = d.screen().root
        active, wm_name, utf8 = (d.intern_atom(a) for a in ("_NET_ACTIVE_WINDOW", "_NET_WM_NAME", "UTF8_STRING"))

        def title():
            wid = root.get_full_property(active, X.AnyPropertyType).value[0]
            prop = d.create_resource_object("window", wid).get_full_property(wm_name, utf8)
            v = prop.value if prop else b""
            return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)

        return title

    def _watch_focus(self):
        try:
            title = self._active_title_fn()
        except Exception as e:
            print(f"  (can't read the active window: {e}; sending keys everywhere)")
            self.focused = True
            return
        print(f"  Keys are only sent while a window titled '{self.window_match}' is in front")
        while self.running:
            try:
                now = self.window_match in squash(title())
            except Exception:
                now = False
            if now != self.focused:
                self.focused = now
                print("\n  Game window in front - wheel active" if now else "\n  Game window not in front - wheel paused")
            time.sleep(0.2)

    def apply(self, s, g, b, k=0):
        self.s, self.g, self.b, self.k = s, g, b, k

    def _set(self, k, on):
        if on and k not in self.held:
            self.kb.press(self.keys[k])
            self.held.add(k)
        elif not on and k in self.held:
            self.kb.release(self.keys[k])
            self.held.discard(k)

    def _loop(self):
        while self.running:
            phase = (time.monotonic() % self.PERIOD) / self.PERIOD
            s, g, b, k = self.s, self.g, self.b, self.k
            if not self.focused:
                s = g = b = 0.0
                k = 0
            # Rescale past the dead zone so steering still ramps smoothly from 0 to full.
            dz = self.STEER_DEADZONE
            mag = max(0.0, (abs(s) - dz) / (1 - dz))
            self._set("left", s < 0 and mag > 0 and phase < mag)
            self._set("right", s > 0 and mag > 0 and phase < mag)
            self._set("up", g > 0.05 and phase < g)
            self._set("down", b > 0.05)
            for i, key in enumerate(self.button_keys):
                self._set(key, bool(k >> i & 1))
            time.sleep(0.004)

    def close(self):
        self.running = False
        time.sleep(0.02)
        for k in list(self.held):
            self._set(k, False)


class DryRunOut:
    name = "dry run (prints values only)"

    def __init__(self):
        self.last = 0.0

    def apply(self, s, g, b, k=0):
        now = time.monotonic()
        if now - self.last > 0.1:
            self.last = now
            bar = "-" * 20
            pos = min(19, int((s + 1) * 10))
            bar = bar[:pos] + "|" + bar[pos + 1 :]
            btns = " ".join(n for i, n in enumerate(BUTTON_NAMES) if k >> i & 1) or "-"
            print(f"\r  steer [{bar}] {s:+.2f}   gas {g:.2f}   brake {b:.2f}   buttons {btns:<20}", end="", flush=True)

    def close(self):
        print()


def offer_vigem_install():
    """The virtual controller needs the ViGEmBus driver. vgamepad ships its installer, so
    point at (and start) it instead of sending people hunting for a download."""
    try:
        import vgamepad

        found = sorted(Path(vgamepad.__file__).parent.rglob("ViGEmBus*"))
    except Exception:
        found = []
    found = [f for f in found if f.suffix.lower() in (".exe", ".msi")]
    if found:
        print(f"  The ViGEmBus driver seems to be missing. Starting its installer: {found[-1].name}")
        print("  Accept it, then start Phone Wheel again.")
        try:
            os.startfile(found[-1])  # noqa - Windows only
        except OSError as err:
            print(f"  (couldn't start it: {err}; run it yourself from {found[-1]})")
    else:
        print("  Install the ViGEmBus driver from https://github.com/nefarius/ViGEmBus/releases, then start again.")


def pick_output(args):
    if args.dry_run:
        return DryRunOut()
    if sys.platform == "darwin" and not args.keyboard:
        print("  (macOS has no virtual controller driver, using keyboard mode)")
        print("  Allow Phone Wheel under System Settings -> Privacy & Security -> Accessibility.\n")
    elif not args.keyboard:
        try:
            return GamepadOut() if sys.platform == "win32" else LinuxGamepadOut()
        except Exception as e:
            print(f"  (virtual controller unavailable: {e.__class__.__name__}: {e})")
            if sys.platform == "win32":
                offer_vigem_install()
            if sys.platform != "win32" and "uinput" in str(e):
                print("  Allow it once with:")
                print('    echo \'KERNEL=="uinput", TAG+="uaccess", OPTIONS+="static_node=uinput"\' | sudo tee /etc/udev/rules.d/60-uinput.rules')
                print("    sudo udevadm control --reload && sudo udevadm trigger /dev/uinput")
            print("  -> falling back to keyboard mode\n")
    return KeyboardOut(None if args.any_window else args.window)


# ----------------------------------------------------------------- server
def build_app(out, token, status):
    state = {"s": 0.0, "g": 0.0, "b": 0.0, "k": 0, "t": 0.0}

    def paired(req):
        return hmac.compare_digest(req.query.get("t", ""), token)

    async def index(_req):
        return web.FileResponse(RES / "controller.html")

    async def classic(_req):
        return web.FileResponse(RES / "static" / "classic.html")

    async def check(req):
        # Lets the phone tell "wrong pairing code" apart from "PC not reachable".
        return web.json_response({"paired": paired(req)}, status=200 if paired(req) else 403)

    @web.middleware
    async def no_cache(req, handler):
        # Always revalidate, so editing a file and reloading the phone shows the change.
        resp = await handler(req)
        if not isinstance(resp, web.WebSocketResponse):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    async def ws_handler(req):
        if not paired(req):
            print(f"\n  Refused a phone without the pairing code ({req.remote}). Scan the QR code on this PC.")
            return web.Response(status=403, text="not paired")
        ws = web.WebSocketResponse(heartbeat=5)
        await ws.prepare(req)
        arrivals = collections.deque()  # receive times of the last 5 s, for rate and stall stats
        status["phones"] += 1
        print(f"\n  Phone connected ({req.remote})")
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                now = time.monotonic()
                arrivals.append(now)
                while now - arrivals[0] > 5:
                    arrivals.popleft()
                try:
                    d = json.loads(msg.data)
                    s = clamp(float(d.get("s", 0)), -1.0, 1.0)
                    g = clamp(float(d.get("g", 0)), 0.0, 1.0)
                    b = clamp(float(d.get("b", 0)), 0.0, 1.0)
                    k = int(d.get("k", 0)) & BUTTON_MASK
                except (ValueError, TypeError):
                    continue
                state.update(s=s, g=g, b=b, k=k, t=now)
                status["input"] = state
                out.apply(s, g, b, k)
                if "p" in d:
                    # link probe: answer at once so the phone can time the round trip; include what we see
                    hz = sum(1 for a in arrivals if now - a <= 1)
                    gap = max((b2 - a2 for a2, b2 in zip(arrivals, list(arrivals)[1:])), default=0)
                    rtt = d.get("r")
                    status["link"] = {"rtt": rtt if isinstance(rtt, (int, float)) else None,
                                      "hz": hz, "gap": round(gap * 1000), "t": now}
                    await ws.send_str(json.dumps({"pong": d["p"], "hz": hz, "gap": round(gap * 1000)}))
        finally:
            status["phones"] -= 1
            status["link"] = {}
            state.update(s=0.0, g=0.0, b=0.0, k=0)
            out.apply(0, 0, 0)
            print("\n  Phone disconnected - controls released")
        return ws

    async def watchdog(_app):
        # Safety: if the phone goes quiet (screen off, Wi-Fi drop), let go of everything.
        while True:
            await asyncio.sleep(0.1)
            if time.monotonic() - state["t"] > 0.4 and (state["s"] or state["g"] or state["b"] or state["k"]):
                state.update(s=0.0, g=0.0, b=0.0, k=0)
                out.apply(0, 0, 0)

    async def start_bg(app):
        app["wd"] = asyncio.create_task(watchdog(app))

    async def stop_bg(app):
        app["wd"].cancel()
        out.close()

    app = web.Application(middlewares=[no_cache])
    app.router.add_get("/", index)
    app.router.add_get("/classic", classic)
    app.router.add_get("/check", check)
    app.router.add_get("/ws", ws_handler)
    app.router.add_static("/static/", RES / "static")
    app.on_startup.append(start_bg)
    app.on_cleanup.append(stop_bg)
    return app


def qr_svg(text):
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathFillImage, border=2, box_size=10)
    return img.to_string(encoding="unicode")


def build_pair_app(info, status):
    """The PC-side page with the QR code and live status. Bound to 127.0.0.1 only, and it
    checks the Host header, so web pages and other devices can't read the pairing code."""

    @web.middleware
    async def local_only(req, handler):
        if req.host.split(":")[0] not in ("127.0.0.1", "localhost"):
            return web.Response(status=403, text="local only")
        return await handler(req)

    async def page(_req):
        return web.FileResponse(RES / "pc" / "pair.html", headers={"Cache-Control": "no-cache"})

    async def api_info(_req):
        return web.json_response(info)

    async def api_status(_req):
        fresh = time.monotonic() - status["input"].get("t", 0) < 0.5
        inp = {k: status["input"].get(k, 0) for k in ("s", "g", "b", "k")} if fresh else None
        lk = status.get("link") or {}
        link = {k: lk.get(k) for k in ("rtt", "hz", "gap")} if time.monotonic() - lk.get("t", 0) < 2 else None
        return web.json_response({"phones": status["phones"], "input": inp, "link": link},
                                 headers={"Cache-Control": "no-store"})

    app = web.Application(middlewares=[local_only])
    app.router.add_get("/", page)
    app.router.add_get("/api/info", api_info)
    app.router.add_get("/api/status", api_status)
    return app


async def serve_https(app, port, ctx):
    """Serve the app over https on `port`, but answer plain http:// requests on the
    same port with a redirect. Phones often open a typed address as http://, which
    would otherwise show "This page isn't working".

    The TLS server listens on a private localhost port; this front door peeks at
    the first bytes of each connection and either redirects or pipes it through."""
    inner = socket.socket()
    inner.bind(("127.0.0.1", 0))
    inner_port = inner.getsockname()[1]
    runner = web.AppRunner(app)
    await runner.setup()
    await web.SockSite(runner, inner, ssl_context=ctx).start()

    async def pipe(reader, writer):
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            writer.close()

    async def front(reader, writer):
        try:
            first = await asyncio.wait_for(reader.read(4096), 10)
        except (asyncio.TimeoutError, ConnectionError, OSError):
            first = b""
        if not first:
            writer.close()
            return
        if first[0] != 0x16:  # not a TLS handshake -> plain http, send it to https
            host = f"{local_ip()}:{port}"
            for line in first.split(b"\r\n")[1:]:
                if line.lower().startswith(b"host:"):
                    host = line[5:].strip().decode("latin-1")
                    break
            writer.write(
                f"HTTP/1.1 301 Moved Permanently\r\nLocation: https://{host}/\r\n"
                "Content-Length: 0\r\nConnection: close\r\n\r\n".encode()
            )
            await writer.drain()
            writer.close()
            return
        try:
            r2, w2 = await asyncio.open_connection("127.0.0.1", inner_port)
        except OSError:
            writer.close()
            return
        w2.write(first)
        await asyncio.gather(pipe(reader, w2), pipe(r2, writer))

    server = await asyncio.start_server(front, "0.0.0.0", port)
    try:
        async with server:
            await server.serve_forever()
    finally:
        await runner.cleanup()


def main():
    ap = argparse.ArgumentParser(description="Use your phone as a steering wheel")
    ap.add_argument("--keyboard", action="store_true", help="send arrow keys instead of a virtual controller")
    ap.add_argument("--dry-run", action="store_true", help="only print the values coming from the phone")
    ap.add_argument("--usb", action="store_true", help="connect over a USB cable with adb instead of Wi-Fi")
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--pair-port", type=int, default=0, help="port for the QR code page on this PC (default: port + 1)")
    ap.add_argument("--no-browser", action="store_true", help="don't open the QR code page on this PC")
    ap.add_argument("--browser", action="store_true", help="open the QR code page even when the terminal shows the QR code")
    ap.add_argument("--new-code", action="store_true", help="make a new pairing code (already paired phones must scan again)")
    ap.add_argument("--window", default="slowroads", help="keyboard mode: only send keys while the active window title contains this (spaces and punctuation ignored)")
    ap.add_argument("--any-window", action="store_true", help="keyboard mode: send keys no matter which window is in front")
    args = ap.parse_args()

    print("\n  PHONE WHEEL\n")
    if args.usb and not shutil.which("adb"):
        sys.exit("  --usb needs adb. Install it with: sudo apt install adb")
    out = pick_output(args)
    token = pairing_token(renew=args.new_code)
    status = {"phones": 0, "input": {}}
    pair_port = args.pair_port or args.port + 1

    if args.usb:
        # Chrome treats http://localhost as a secure page, so no certificate is needed.
        base, ctx = f"http://localhost:{args.port}", None
        threading.Thread(target=keep_adb_reverse, args=(args.port,), daemon=True).start()
    else:
        ip = local_ip()
        cert, key = ensure_cert(ip)
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(cert, key)
        base = f"https://{ip}:{args.port}"
    url = f"{base}/?t={token}"
    pair_url = f"http://127.0.0.1:{pair_port}/"
    info = {"url": url, "base": base, "qr": qr_svg(url), "mode": out.name, "usb": args.usb}

    print(f"  Output mode : {out.name}")
    print(f"  Phone link  : {url}")
    print(f"  QR code page: {pair_url}\n")
    qr_shown = False
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.print_ascii(invert=True)
        qr_shown = sys.stdout.isatty()
    except Exception:
        pass
    # The QR code page is only needed when the terminal couldn't show the code.
    open_page = args.browser or not (qr_shown or args.no_browser)
    print("  Scan the QR code with your phone camera (same Wi-Fi as this PC).")
    if not args.usb:
        print("  Your phone will warn about the certificate: tap Advanced -> Proceed.")
    print("  Press Ctrl+C to stop.\n")

    async def run():
        pair = web.AppRunner(build_pair_app(info, status), access_log=None)
        await pair.setup()
        try:
            await web.TCPSite(pair, "127.0.0.1", pair_port).start()
            if open_page:
                threading.Thread(target=webbrowser.open, args=(pair_url,), daemon=True).start()
        except OSError as err:
            print(f"  (QR code page unavailable on port {pair_port}: {err.strerror})")
        app = build_app(out, token, status)
        try:
            if args.usb:
                runner = web.AppRunner(app, access_log=None)
                await runner.setup()
                await web.TCPSite(runner, "127.0.0.1", args.port).start()
                await asyncio.Event().wait()
            else:
                await serve_https(app, args.port, ctx)
        finally:
            await pair.cleanup()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
