"""Where the phone's input goes: a virtual Xbox 360 controller (Windows: vgamepad/ViGEmBus; Linux: uinput), arrow
keys (keyboard mode), or the terminal (dry run). Every output has `name`, apply(s, g, b, k) and close()."""
import os
import sys
import threading
import time
from pathlib import Path

from .protocol import pressed, squash


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
            s, g, b, k = (self.s, self.g, self.b, self.k) if self.focused else (0.0, 0.0, 0.0, 0)
            for key, on in pulse_keys(s, g, b, k, phase, self.STEER_DEADZONE, self.button_keys).items():
                self._set(key, on)
            time.sleep(0.004)

    def close(self):
        self.running = False
        time.sleep(0.02)
        for k in list(self.held):
            self._set(k, False)


def pulse_keys(s, g, b, k, phase, deadzone, button_keys):
    """Keyboard mode at one moment of the pulse cycle (phase 0..1): which keys are down. Steering past the dead zone
    and the gas are held for that share of the cycle (rescaled, so steering ramps smoothly from 0 to full); brake is
    on/off; button i presses button_keys[i]."""
    mag = max(0.0, (abs(s) - deadzone) / (1 - deadzone))
    keys = {"left": s < 0 and mag > 0 and phase < mag, "right": s > 0 and mag > 0 and phase < mag,
            "up": g > 0.05 and phase < g, "down": b > 0.05}
    keys.update((key, bool(k >> i & 1)) for i, key in enumerate(button_keys))
    return keys


def dry_line(s, g, b, k):
    """Dry-run mode's status line: a steering bar, the pedals and the buttons held."""
    bar = "-" * 20
    pos = min(19, int((s + 1) * 10))
    bar = bar[:pos] + "|" + bar[pos + 1 :]
    btns = " ".join(pressed(k)) or "-"
    return f"  steer [{bar}] {s:+.2f}   gas {g:.2f}   brake {b:.2f}   buttons {btns:<20}"


class DryRunOut:
    name = "dry run (prints values only)"

    def __init__(self):
        self.last = 0.0

    def apply(self, s, g, b, k=0):
        now = time.monotonic()
        if now - self.last > 0.1:
            self.last = now
            print("\r" + dry_line(s, g, b, k), end="", flush=True)

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
