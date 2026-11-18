// The phone-wheel app finds this PC on the local network (2026-11-17): while the phone link runs (Wi-Fi / Bluetooth),
// a UDP broadcast every second on BEACON_PORT carries { pw: 1, name, wsPort, id } (JSON): the PC's name, the plain ws://
// port the app connects to (phone-link.cjs) and a stable id per PC (kept in the data folder) so the app can tell which
// PC it paired with. The phone takes the address from the packet itself. No pairing code in it: the app asks for that
// (or reads it from the QR code). Node's dgram only, no dependency. The app's side: phone-wheel/web/src/engine/pairing.ts.
const dgram = require('node:dgram');
const os = require('node:os');

const BEACON_PORT = 8445;
const BEACON_EVERY = 1000;      // ms
const MAX_NAME = 40;

// one beacon → its bytes
function encodeBeacon({ name, wsPort, id }) {
  return Buffer.from(JSON.stringify({ pw: 1, name: String(name || 'PC').slice(0, MAX_NAME), wsPort, id: String(id) }));
}
// bytes → { name, wsPort, id } or null when it isn't one of ours (anything else on the port is ignored)
function decodeBeacon(buf) {
  if (!buf || buf.length > 512) return null;
  let d; try { d = JSON.parse(buf.toString()); } catch { return null; }
  if (!d || d.pw !== 1 || typeof d.id !== 'string' || !/^[\w-]{4,64}$/.test(d.id)) return null;
  if (!Number.isInteger(d.wsPort) || d.wsPort < 1 || d.wsPort > 65535) return null;
  return { name: typeof d.name === 'string' && d.name.trim() ? d.name.slice(0, MAX_NAME) : 'PC', wsPort: d.wsPort, id: d.id };
}

// the broadcast address of every IPv4 network this PC is on (address | ~netmask), + the limited broadcast
function broadcastAddresses(ifaces = os.networkInterfaces()) {
  const out = new Set();
  for (const list of Object.values(ifaces)) for (const a of list || []) {
    if (a.family !== 'IPv4' && a.family !== 4) continue;
    if (a.internal || !a.netmask) continue;
    const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
    if (ip.length !== 4 || mask.length !== 4 || ip.some(n => !(n >= 0 && n <= 255))) continue;
    out.add(ip.map((n, i) => (n | (~mask[i] & 255)) & 255).join('.'));
  }
  out.add('255.255.255.255');
  return [...out];
}

// Sends the beacon every `every` ms to `targets()` (default: every broadcast address, re-read each time: the Bluetooth
// link comes and goes) until stop(). Errors (no network, a refused address) are ignored: the next one tries again.
function createBeacon({ name = os.hostname(), id, wsPort, port = BEACON_PORT, every = BEACON_EVERY, targets = broadcastAddresses }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let timer = null, ready = false;
  sock.on('error', () => {});
  sock.bind(0, () => { try { sock.setBroadcast(true); } catch {} ready = true; send(); });
  const msg = encodeBeacon({ name, wsPort, id });
  function send() {
    if (!ready) return;
    for (const addr of targets()) sock.send(msg, port, addr, () => {});
  }
  timer = setInterval(send, every);
  timer.unref?.();
  return { stop() { clearInterval(timer); timer = null; try { sock.close(); } catch {} } };
}

module.exports = { BEACON_PORT, encodeBeacon, decodeBeacon, broadcastAddresses, createBeacon };
