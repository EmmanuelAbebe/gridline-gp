"""The command line: pick the output and the link, show the phone link + QR code, run the servers."""
import argparse
import asyncio
import shutil
import ssl
import sys
import threading
import webbrowser

from aiohttp import web

from .certs import ensure_cert, pairing_token
from .links import BluetoothLink, keep_adb_reverse, local_ip
from .outputs import pick_output
from .webapp import build_app, build_pair_app, qr_svg, serve_https

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass



def print_qr(url):
    """The QR code in the terminal; True if it was shown there."""
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.print_ascii(invert=True)
        return sys.stdout.isatty()
    except Exception:
        return False


async def watch_bluetooth(bt, ip, ctx, info, token, port):
    """Bluetooth mode: keep the tethering link up, and if the phone hands this PC a new address, serve a certificate
    for it and show the new link (the phone page reconnects by itself after a short drop on the same address)."""
    down = False
    while True:
        await asyncio.sleep(3)
        now = await asyncio.to_thread(bt.poll)
        if now is None:
            if not down:
                down = True
                print("\n  Bluetooth link lost - reconnecting (check that tethering is still on)...")
            continue
        if down:
            down = False
            print(f"\n  Bluetooth link back ({now})")
        if now != ip:
            ip = now
            cert, key = ensure_cert(ip)
            ctx.load_cert_chain(cert, key)
            url = f"https://{ip}:{port}/?t={token}"
            info.update(url=url, base=f"https://{ip}:{port}", qr=qr_svg(url))
            print(f"\n  The phone gave this PC a new address. New phone link: {url}")
            print_qr(url)
            print("  Scan it again (the old link points at the old address).")


def main():
    ap = argparse.ArgumentParser(description="Use your phone as a steering wheel")
    ap.add_argument("--keyboard", action="store_true", help="send arrow keys instead of a virtual controller")
    ap.add_argument("--dry-run", action="store_true", help="only print the values coming from the phone")
    ap.add_argument("--usb", action="store_true", help="connect over a USB cable with adb instead of Wi-Fi")
    ap.add_argument("--bluetooth", nargs="?", const="auto", metavar="PHONE",
                    help="connect over the phone's Bluetooth tethering instead of Wi-Fi; PHONE = part of its name or its "
                         "MAC address (default: the paired phone that can tether)")
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
    if args.usb and args.bluetooth:
        sys.exit("  Pick one: --usb or --bluetooth")
    out = pick_output(args)
    token = pairing_token(renew=args.new_code)
    status = {"phones": 0, "input": {}}
    pair_port = args.pair_port or args.port + 1

    if args.usb:
        # Chrome treats http://localhost as a secure page, so no certificate is needed.
        base, ctx = f"http://localhost:{args.port}", None
        threading.Thread(target=keep_adb_reverse, args=(args.port,), daemon=True).start()
    else:
        bt = BluetoothLink(args.bluetooth) if args.bluetooth else None
        ip = bt.wait() if bt else local_ip()
        cert, key = ensure_cert(ip)
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(cert, key)
        base = f"https://{ip}:{args.port}"
    url = f"{base}/?t={token}"
    pair_url = f"http://127.0.0.1:{pair_port}/"
    info = {"url": url, "base": base, "qr": qr_svg(url), "mode": out.name, "usb": args.usb,
            "bluetooth": bool(args.bluetooth)}

    print(f"  Output mode : {out.name}")
    print(f"  Phone link  : {url}")
    print(f"  QR code page: {pair_url}\n")
    qr_shown = print_qr(url)
    # The QR code page is only needed when the terminal couldn't show the code.
    open_page = args.browser or not (qr_shown or args.no_browser)
    print("  Scan the QR code with your phone camera" + (" (keep Bluetooth tethering on)." if args.bluetooth else
          "" if args.usb else " (same Wi-Fi as this PC)."))
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
        if args.bluetooth:
            watch = asyncio.create_task(watch_bluetooth(bt, ip, ctx, info, token, args.port))  # held so the task lives
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
