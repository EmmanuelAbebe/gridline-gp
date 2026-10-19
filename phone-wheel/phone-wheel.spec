# PyInstaller recipe for a single-file Phone Wheel executable.
# Build on each OS you want to ship for (PyInstaller can't cross-compile):
#   pip install pyinstaller aiohttp cryptography qrcode pynput   (+ vgamepad on Windows, evdev on Linux)
#   pyinstaller phone-wheel.spec
# Output: dist/PhoneWheel (dist/PhoneWheel.exe on Windows)
import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [("controller.html", "."), ("static", "static"), ("pc", "pc")]
binaries = []
# pynput picks its backend (xorg / win32 / darwin) at runtime, so PyInstaller can't see it.
hiddenimports = collect_submodules("pynput")

if sys.platform == "win32":
    # vgamepad ships the ViGEmClient DLL and the ViGEmBus driver installer as package data.
    d, b, h = collect_all("vgamepad")
    datas += d; binaries += b; hiddenimports += h
elif sys.platform.startswith("linux"):
    hiddenimports += collect_submodules("evdev") + collect_submodules("Xlib")

a = Analysis(
    ["server.py"],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["tkinter"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="PhoneWheel",
    console=True,  # the terminal shows the QR code and status, and Ctrl+C / closing it stops the wheel
    upx=False,
)
