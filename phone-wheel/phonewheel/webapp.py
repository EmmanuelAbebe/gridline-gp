"""The servers: the phone's page + WebSocket (build_app), the PC's QR code page on localhost (build_pair_app), and the
https front door that also redirects plain http (serve_https). `status` is shared: phones connected, last input,
link stats."""
import asyncio
import collections
import hmac
import json
import socket
import time

from aiohttp import WSMsgType, web

from .links import local_ip
from .paths import RES
from .protocol import parse_message


WATCHDOG = web.AppKey("watchdog", asyncio.Task)


def build_app(out, token, status):
    state = {"s": 0.0, "g": 0.0, "b": 0.0, "k": 0, "t": 0.0}

    def paired(req):
        return hmac.compare_digest(req.query.get("t", ""), token)

    # The page: the React build (web/dist, `npm run phone:build` in Gridline GP) at /, else the previous page, which
    # stays at /v1 (and the single-file one at /classic).
    web_dist = RES / "web" / "dist"

    async def index(_req):
        built = web_dist / "index.html"
        return web.FileResponse(built if built.exists() else RES / "controller.html")

    async def v1(_req):
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
                parsed = parse_message(msg.data)
                if parsed is None:
                    continue
                d, (s, g, b, k) = parsed
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
        app[WATCHDOG] = asyncio.create_task(watchdog(app))

    async def stop_bg(app):
        app[WATCHDOG].cancel()
        out.close()

    app = web.Application(middlewares=[no_cache])
    app.router.add_get("/", index)
    app.router.add_get("/v1", v1)
    app.router.add_get("/classic", classic)
    app.router.add_get("/check", check)
    app.router.add_get("/ws", ws_handler)
    app.router.add_static("/static/", RES / "static")
    if (web_dist / "assets").is_dir():
        app.router.add_static("/assets/", web_dist / "assets")
    app.on_startup.append(start_bg)
    app.on_cleanup.append(stop_bg)
    return app


def qr_svg(text):
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathFillImage, border=2, box_size=10)
    return img.to_string(encoding="unicode")


def status_snapshot(status, now):
    """What the QR page shows: phones connected, the last input if under 0.5 s old, the link stats if under 2 s old."""
    fresh = now - status["input"].get("t", 0) < 0.5
    inp = {k: status["input"].get(k, 0) for k in ("s", "g", "b", "k")} if fresh else None
    lk = status.get("link") or {}
    link = {k: lk.get(k) for k in ("rtt", "hz", "gap")} if now - lk.get("t", 0) < 2 else None
    return {"phones": status["phones"], "input": inp, "link": link}


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
        return web.json_response(status_snapshot(status, time.monotonic()), headers={"Cache-Control": "no-store"})

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
