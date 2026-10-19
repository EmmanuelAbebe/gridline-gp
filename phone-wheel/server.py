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
  Wi-Fi     (default)     - https on the LAN with a self-signed certificate
  Bluetooth (--bluetooth) - https over the phone's Bluetooth tethering link (no router in between)
  USB       (--usb)       - plain http on localhost, tunnelled to the phone with `adb reverse`
"""
# The code is in the phonewheel/ package (see phonewheel/__init__.py); this file is the entry point, so
# `python server.py ...` and the PyInstaller build (phone-wheel.spec) work as before.
from phonewheel.main import main

if __name__ == "__main__":
    main()
