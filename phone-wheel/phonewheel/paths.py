"""Where things are: read-only pages (next to the project, or inside the PyInstaller bundle) and the per-machine
files (certificate, pairing code)."""
import mimetypes
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent   # the project folder (server.py, web/dist, pc/)
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
