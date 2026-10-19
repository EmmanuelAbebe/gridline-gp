"""The servers, through aiohttp's test client: pairing, the phone's WebSocket (values reach the output, link probes are
answered, controls are released on disconnect and by the watchdog), and the localhost-only QR page.
Run from phone-wheel/: python -m unittest"""
import asyncio
import json
import unittest

from aiohttp.test_utils import TestClient, TestServer

from phonewheel.webapp import build_app, build_pair_app, status_snapshot

TOKEN = "t" * 22


class FakeOut:
    name = "test"

    def __init__(self):
        self.calls, self.closed = [], False

    def apply(self, s, g, b, k=0):
        self.calls.append((s, g, b, k))

    def close(self):
        self.closed = True


class PhoneServer(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.out, self.status = FakeOut(), {"phones": 0, "input": {}}
        self.client = TestClient(TestServer(build_app(self.out, TOKEN, self.status)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_pages_and_pairing(self):
        r = await self.client.get("/")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers["Cache-Control"], "no-cache")
        self.assertEqual((await self.client.get("/check?t=" + TOKEN)).status, 200)
        r = await self.client.get("/check?t=wrong")
        self.assertEqual((r.status, await r.json()), (403, {"paired": False}))
        self.assertEqual((await self.client.get("/ws?t=wrong")).status, 403)
        r = await self.client.get("/static/engine.js")
        self.assertEqual(r.content_type, "text/javascript")

    async def test_websocket_drives_the_output(self):
        ws = await self.client.ws_connect("/ws?t=" + TOKEN)
        await ws.send_str(json.dumps({"s": 0.25, "g": 1, "b": 0, "k": 0b10000}))
        await ws.send_str("not json")                    # ignored, connection stays up
        await ws.send_str(json.dumps({"s": 2, "g": 0, "b": 0.5, "k": 0, "p": 3, "r": 21.5}))
        pong = json.loads((await ws.receive()).data)
        self.assertEqual(pong["pong"], 3)
        self.assertGreaterEqual(pong["hz"], 2)
        self.assertEqual(self.out.calls[-2:], [(0.25, 1.0, 0.0, 0b10000), (1.0, 0.0, 0.5, 0)])
        self.assertEqual(self.status["phones"], 1)
        self.assertEqual(self.status["link"]["rtt"], 21.5)
        snap = status_snapshot(self.status, self.status["input"]["t"])
        self.assertEqual(snap["input"], {"s": 1.0, "g": 0.0, "b": 0.5, "k": 0})
        await ws.close()
        for _ in range(50):
            if self.status["phones"] == 0:
                break
            await asyncio.sleep(0.01)
        self.assertEqual(self.status["phones"], 0)
        self.assertEqual(self.out.calls[-1], (0, 0, 0, 0), "disconnect releases everything")

    async def test_watchdog_releases_a_silent_phone(self):
        ws = await self.client.ws_connect("/ws?t=" + TOKEN)
        await ws.send_str(json.dumps({"s": 0.5, "g": 1, "b": 0, "k": 1}))
        await asyncio.sleep(0.7)                         # no message for > 0.4 s
        self.assertEqual(self.out.calls[-1], (0, 0, 0, 0))
        await ws.close()


class PairPage(unittest.IsolatedAsyncioTestCase):
    async def test_local_only_and_status(self):
        status = {"phones": 1, "input": {}, "link": {}}
        client = TestClient(TestServer(build_pair_app({"url": "https://x/?t=" + TOKEN}, status)))
        await client.start_server()
        try:
            r = await client.get("/api/info", headers={"Host": "127.0.0.1:8444"})
            self.assertEqual((await r.json())["url"], "https://x/?t=" + TOKEN)
            r = await client.get("/api/status", headers={"Host": "localhost"})
            self.assertEqual(await r.json(), {"phones": 1, "input": None, "link": None})
            self.assertEqual((await client.get("/api/info", headers={"Host": "192.168.1.20:8444"})).status, 403,
                             "another device or a web page can't read the pairing code")
        finally:
            await client.close()


if __name__ == "__main__":
    unittest.main()
