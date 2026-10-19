"""How the phone reaches this PC: Wi-Fi (the LAN address), USB (adb reverse, plain http on localhost) or Bluetooth
tethering (the phone shares a small network over Bluetooth PAN and this PC joins it)."""
import json
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


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


# ----------------------------------------------------------------- bluetooth
# Bluetooth tethering: the phone shares a small network over Bluetooth (PAN) and this PC joins it, so the phone's
# messages come straight over the air without a router in between. The phone page is the same https page; only the
# address changes (the PC's address on that link).
BT_CON = "phone-wheel-bt"  # NetworkManager connection made by --bluetooth (Linux); never the PC's default route
NAP_UUID = "00001116"      # Bluetooth "network access point" = a phone that can tether


def run_cmd(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as err:
        return -1, "", str(err)


def is_bt_iface(name):
    """Linux: a Bluetooth network interface. Named bnep0 by the kernel, but udev often renames it after the
    adapter's MAC (enx...), so ask the kernel what kind of device it is."""
    if name.startswith(("bnep", "bt-pan")):
        return True
    try:
        return "DEVTYPE=bluetooth" in Path(f"/sys/class/net/{name}/uevent").read_text()
    except OSError:
        return False


def bt_addr_from_ip_json(out, is_bt=None):
    """`ip -j -4 addr show` output -> (interface, IPv4 address) of the first Bluetooth interface, or None."""
    is_bt = is_bt or is_bt_iface
    try:
        links = json.loads(out) if out else []
    except ValueError:
        links = []
    for link in links:
        if is_bt(link.get("ifname", "")):
            for a in link.get("addr_info", []):
                if a.get("family") == "inet":
                    return link["ifname"], a["local"]
    return None


def bt_link():
    """(interface, IPv4 address) of this PC on a Bluetooth tethering link, or None."""
    if sys.platform.startswith("linux"):
        code, out, _ = run_cmd(["ip", "-j", "-4", "addr", "show"])
        found = bt_addr_from_ip_json(out if code == 0 else "")
        if found:
            return found
    elif sys.platform == "win32":
        code, out, _ = run_cmd(["powershell", "-NoProfile", "-Command",
                                "Get-NetAdapter | Where-Object InterfaceDescription -match 'Bluetooth' | "
                                "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | "
                                "ForEach-Object { $_.InterfaceAlias + '|' + $_.IPAddress }"], timeout=15)
        for line in out.splitlines():
            name, _, ip = line.strip().rpartition("|")
            if ip and not ip.startswith("169.254."):  # 169.254 = Windows' "no network" address
                return name, ip
    elif sys.platform == "darwin":
        code, out, _ = run_cmd(["networksetup", "-getinfo", "Bluetooth PAN"])
        for line in out.splitlines():
            if line.startswith("IP address:") and line.split(":", 1)[1].strip() not in ("", "none"):
                return "Bluetooth PAN", line.split(":", 1)[1].strip()
    return None


def bt_phones():
    """Paired Bluetooth devices as [(mac, name, can_tether)] (Linux, BlueZ)."""
    code, out, _ = run_cmd(["bluetoothctl", "devices", "Paired"])
    if code != 0 or not out.strip():
        code, out, _ = run_cmd(["bluetoothctl", "paired-devices"])  # older BlueZ
    found = []
    for mac, name in parse_devices(out):
        _, info, _ = run_cmd(["bluetoothctl", "info", mac])
        found.append((mac, name, NAP_UUID in info))
    return found


def parse_devices(out):
    """`bluetoothctl devices` output ("Device <MAC> <name>" lines) -> [(mac, name)]; a device without a name is its MAC."""
    found = []
    for line in out.splitlines():
        parts = line.split(" ", 2)
        if len(parts) >= 2 and parts[0] == "Device":
            found.append((parts[1], parts[2] if len(parts) > 2 else parts[1]))
    return found


def match_phones(phones, want):
    """The paired devices [(mac, name, can_tether)] that `want` picks: a MAC address or part of the name (any case),
    or "auto" = every device that can tether."""
    if want != "auto":
        return [p for p in phones if p[0].lower() == want.lower() or want.lower() in p[1].lower()]
    return [p for p in phones if p[2]]


def pick_bt_phone(want, phones=None):
    """The phone to tether to: `want` is a MAC address or part of the name, or "auto" (the one paired device that
    can tether). Returns its MAC or None (and says why)."""
    phones = bt_phones() if phones is None else phones
    hits = match_phones(phones, want)
    if len(hits) == 1:
        return hits[0][0]
    if not phones:
        print("  No paired Bluetooth devices. Pair the phone with this PC first (Bluetooth settings on both).")
    elif hits:
        print("  Several phones match; pick one with --bluetooth \"<name or MAC>\":")
    else:
        print("  No paired phone matches. Paired devices:" if want != "auto" else
              "  None of the paired devices offers tethering. Paired devices:")
    for mac, name, nap in (hits or phones):
        print(f"    {mac}  {name}" + ("  (can tether)" if nap else ""))
    return None


def bt_connect(mac):
    """Linux: bring up the tethering link to the phone with NetworkManager, through our own connection profile,
    which never becomes the default route (so the PC's internet doesn't move to the phone's mobile data).
    Returns None when it worked, else the reason."""
    if not shutil.which("nmcli"):
        return "nmcli (NetworkManager) not found: connect to the phone's Bluetooth network from the system settings"
    code, out, _ = run_cmd(["nmcli", "-g", "bluetooth.bdaddr", "connection", "show", BT_CON])
    if code != 0:
        code, _, err = run_cmd(["nmcli", "connection", "add", "type", "bluetooth", "con-name", BT_CON,
                                "bluetooth.bdaddr", mac, "bluetooth.type", "panu",
                                "ipv4.never-default", "yes", "ipv6.method", "ignore",
                                "connection.autoconnect", "no"])
        if code != 0:
            return err or "nmcli couldn't create the connection"
    elif out.strip().replace("\\", "").lower() != mac.lower():
        run_cmd(["nmcli", "connection", "modify", BT_CON, "bluetooth.bdaddr", mac])
    code, _, err = run_cmd(["nmcli", "connection", "up", BT_CON], timeout=40)
    if code == 0:
        return None
    return nmcli_reason(err)


def nmcli_reason(err):
    """The line of an nmcli error worth showing: the last one, skipping its "Hint: ... journalctl" advice."""
    lines = [l for l in err.splitlines() if l.strip() and not l.startswith("Hint:")]
    return (lines or ["the phone didn't answer"])[-1]


def bt_default_route():
    """True when this PC's internet goes out through the Bluetooth link (Linux)."""
    code, out, _ = run_cmd(["ip", "-j", "route", "show", "default"])
    try:
        return any(is_bt_iface(r.get("dev", "")) for r in json.loads(out or "[]"))
    except ValueError:
        return False


BT_HELP = """  Bluetooth tethering:
    1. Pair the phone with this PC once (Bluetooth settings on both).
    2. On the phone turn on Bluetooth tethering: Settings -> Connections -> Mobile Hotspot and
       Tethering -> Bluetooth tethering (Samsung; on other Androids: Network -> Hotspot & tethering).
    3. This PC joins the phone's Bluetooth network by itself (Linux, NetworkManager). On Windows:
       Control Panel -> Devices and Printers -> right-click the phone -> Connect using -> Access point.
       On a Mac: System Settings -> Network -> Bluetooth PAN -> Connect.
"""


class BluetoothLink:
    """Finds the tethering link and keeps it up: reconnects after a drop (Linux), reports address changes."""

    RETRY = 10  # s between connection attempts

    def __init__(self, want):
        self.want, self.mac, self.last_try, self.last_err = want, None, 0.0, None
        self.warned_route = False

    def poll(self):
        """One check: the PC's address on the link, or None after (maybe) trying to bring it up."""
        link = bt_link()
        if link:
            if not self.warned_route and sys.platform.startswith("linux") and bt_default_route():
                self.warned_route = True
                print("\n  Note: this PC's internet now goes through the phone's mobile data (the Bluetooth link")
                print("  became the default route). Connect with --bluetooth and no other Bluetooth network to avoid it.")
            return link[1]
        if not sys.platform.startswith("linux") or time.monotonic() - self.last_try < self.RETRY:
            return None
        self.last_try = time.monotonic()
        if self.mac is None:
            self.mac = pick_bt_phone(self.want)
            if self.mac is None:
                self.last_try += 20  # nothing to connect to yet; look again a little later
                return None
        err = bt_connect(self.mac)
        if err and err != self.last_err:
            print(f"  Bluetooth: {err}")
            print("  -> is the phone near the PC with Bluetooth on, and Bluetooth tethering turned on?")
        self.last_err = err
        link = bt_link()
        return link[1] if link else None

    def wait(self):
        """Block until the link is up; returns the PC's address on it."""
        ip = self.poll()
        if ip:
            return ip
        print(BT_HELP)
        print("  Waiting for the Bluetooth link... (Ctrl+C to stop)")
        while not ip:
            time.sleep(2)
            ip = self.poll()
        print(f"  Bluetooth link up: this PC is {ip} on the phone's network\n")
        return ip
