// How the phone reaches this PC (the desktop app's phone link, phone-link.cjs). Ported from phone-wheel/phonewheel/links.py:
//   wifi       this PC's LAN address (the phone must be on the same Wi-Fi)
//   bluetooth  the PC's address on the phone's Bluetooth tethering network (no router in between); on Linux the PC
//              joins it by itself through NetworkManager, with its own profile that never becomes the default route
//   usb        `adb reverse` maps the phone's localhost:port to ours (plain http: Chrome treats localhost as secure)
// The parsers are pure (tests/phone-link.test.js); everything that runs a tool goes through `run`.
const { execFile } = require('node:child_process');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');

const BT_CON = 'phone-wheel-bt';     // NetworkManager connection profile (same name as the Python server's)
const NAP_UUID = '00001116';         // Bluetooth "network access point": a phone that can tether

// a tool's result: { code, out, err } (code -1 when it couldn't run); never throws
const run = (cmd, args, timeout = 10000) => new Promise(resolve => {
  execFile(cmd, args, { timeout, encoding: 'utf8' }, (error, out, err) =>
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, out: out || '', err: (err || String(error?.message || '')).trim() }));
});

// This PC's Wi-Fi/LAN address: the one the system would use to reach the internet (no packet is sent).
function localIp() {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    s.on('error', () => { s.close(); resolve('127.0.0.1'); });
    s.connect(80, '8.8.8.8', () => { const { address } = s.address(); s.close(); resolve(address); });
  });
}

// Linux: a Bluetooth network interface. The kernel names it bnep0, but udev often renames it after the adapter's MAC
// (enx...), so ask the kernel what kind of device it is.
function isBtIface(name) {
  if (/^(bnep|bt-pan)/.test(name)) return true;
  if (process.platform !== 'linux') return /bluetooth/i.test(name);
  try { return fs.readFileSync(`/sys/class/net/${name}/uevent`, 'utf8').includes('DEVTYPE=bluetooth'); } catch { return false; }
}

// os.networkInterfaces() → { iface, ip } of the first Bluetooth interface with an IPv4 address, or null
function btAddress(ifaces = os.networkInterfaces(), isBt = isBtIface) {
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!isBt(name)) continue;
    const a = (addrs || []).find(x => (x.family === 'IPv4' || x.family === 4) && !x.internal && !x.address.startsWith('169.254.'));
    if (a) return { iface: name, ip: a.address };
  }
  return null;
}

// `bluetoothctl devices` output → [{ mac, name }] (a device without a name is its MAC)
function parseDevices(out) {
  const found = [];
  for (const line of out.split('\n')) {
    const parts = line.trim().split(' ');
    if (parts.length >= 2 && parts[0] === 'Device') found.push({ mac: parts[1], name: parts.slice(2).join(' ') || parts[1] });
  }
  return found;
}
// Paired devices that `want` picks: a MAC address or part of the name (any case), or 'auto' = those that can tether.
function matchPhones(phones, want) {
  if (want && want !== 'auto') { const w = want.toLowerCase(); return phones.filter(p => p.mac.toLowerCase() === w || p.name.toLowerCase().includes(w)); }
  return phones.filter(p => p.nap);
}
// The line of an nmcli error worth showing: the last one, skipping its "Hint: ... journalctl" advice.
function nmcliReason(err) {
  const lines = err.split('\n').filter(l => l.trim() && !l.startsWith('Hint:'));
  return lines.length ? lines[lines.length - 1] : "the phone didn't answer";
}

// Paired Bluetooth devices (Linux, BlueZ) as [{ mac, name, nap }] (nap = can tether)
async function btPhones() {
  let { code, out } = await run('bluetoothctl', ['devices', 'Paired']);
  if (code !== 0 || !out.trim()) ({ out } = await run('bluetoothctl', ['paired-devices']));   // older BlueZ
  const found = [];
  for (const d of parseDevices(out)) found.push({ ...d, nap: (await run('bluetoothctl', ['info', d.mac])).out.includes(NAP_UUID) });
  return found;
}

// Linux: bring the tethering link up with NetworkManager through our own profile (never the default route, so the
// PC's internet doesn't move to the phone's mobile data). Resolves null when it worked, else the reason.
async function btConnect(mac) {
  if ((await run('nmcli', ['--version'])).code !== 0) return 'NetworkManager (nmcli) not found: join the phone\'s Bluetooth network from the system settings';
  const { code, out } = await run('nmcli', ['-g', 'bluetooth.bdaddr', 'connection', 'show', BT_CON]);
  if (code !== 0) {
    const r = await run('nmcli', ['connection', 'add', 'type', 'bluetooth', 'con-name', BT_CON, 'bluetooth.bdaddr', mac,
      'bluetooth.type', 'panu', 'ipv4.never-default', 'yes', 'ipv6.method', 'ignore', 'connection.autoconnect', 'no']);
    if (r.code !== 0) return r.err || "nmcli couldn't create the connection";
  } else if (out.trim().replace(/\\/g, '').toLowerCase() !== mac.toLowerCase()) {
    await run('nmcli', ['connection', 'modify', BT_CON, 'bluetooth.bdaddr', mac]);
  }
  const up = await run('nmcli', ['connection', 'up', BT_CON], 40000);
  return up.code === 0 ? null : nmcliReason(up.err);
}

// Finds the tethering link and keeps it up: poll() → the PC's address on it, or null after (maybe) trying to connect
// (Linux, at most every RETRY ms). `note` explains what it is waiting for.
function createBluetoothLink(want = 'auto') {
  const RETRY = 10000;
  let mac = null, lastTry = -Infinity;
  const link = { note: '', phone: '',
    async poll() {
      const found = btAddress();
      if (found) { link.note = ''; return found.ip; }
      if (process.platform !== 'linux') { link.note = 'Join the phone\'s Bluetooth network in the system settings (tethering on).'; return null; }
      if (Date.now() - lastTry < RETRY) return null;
      lastTry = Date.now();
      if (!mac) {
        const phones = await btPhones(), hits = matchPhones(phones, want);
        if (hits.length !== 1) {
          link.note = !phones.length ? 'No paired Bluetooth devices: pair the phone with this PC first (Bluetooth settings on both).'
            : hits.length ? 'Several paired phones can tether: unpair the ones you don\'t use.' : 'None of the paired devices offers tethering: turn on Bluetooth tethering on the phone.';
          lastTry += 20000;
          return null;
        }
        mac = hits[0].mac; link.phone = hits[0].name;
      }
      const err = await btConnect(mac);
      link.note = err ? `Bluetooth: ${err}. Is the phone near the PC with Bluetooth tethering on?` : '';
      return btAddress()?.ip ?? null;
    },
  };
  return link;
}

// USB: keep `adb reverse` in place (re-applied every 3 s, so unplugging and replugging just works). stop() ends it.
// (phonePort: the phone's side of the mapping, default the same port)
function keepAdbReverse(port, onChange, phonePort = port) {
  let linked = null, timer = null, stopped = false;
  const tick = async () => {
    const { code } = await run('adb', ['reverse', `tcp:${phonePort}`, `tcp:${port}`], 5000);
    if (stopped) return;
    if ((code === 0) !== linked) { linked = code === 0; onChange(linked); }
    timer = setTimeout(tick, 3000);
  };
  tick();
  return { stop() { stopped = true; clearTimeout(timer); } };
}

// `adb devices` → the serials of the phones ready (authorised: not 'unauthorized' / 'offline')
function parseAdbDevices(text) {
  return String(text).split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(p => p.length >= 2 && p[1] === 'device').map(p => p[0]);
}
// The phone-wheel app over USB (2026-11-17, whatever link the game uses): every phone plugged in with USB debugging gets
// its localhost:phonePort mapped to our pcPort (adb reverse), so the app finds the game at localhost:8444 by itself.
// Each new phone once, all of them again every `renew` ms (an adb server restart drops the mappings); onChange(n phones).
// No adb on this PC: it tries again now and then, nothing else happens.
function watchAdbPhones(phonePort, pcPort, onChange = () => {}, { every = 3000, renew = 30000, runner = run } = {}) {
  let done = new Set(), timer = null, stopped = false, last = -1, since = Date.now();
  const tick = async () => {
    const { code, out } = await runner('adb', ['devices'], 5000);
    if (stopped) return;
    if (code !== 0) { if (last !== 0) { last = 0; onChange(0); } timer = setTimeout(tick, every * 4); return; }
    if (Date.now() - since > renew) { done = new Set(); since = Date.now(); }
    const now = parseAdbDevices(out);
    done = new Set([...done].filter(s => now.includes(s)));
    for (const s of now) if (!done.has(s)) {
      const r = await runner('adb', ['-s', s, 'reverse', `tcp:${phonePort}`, `tcp:${pcPort}`], 5000);
      if (stopped) return;
      if (r.code === 0) done.add(s);
    }
    if (done.size !== last) { last = done.size; onChange(last); }
    timer = setTimeout(tick, every);
  };
  tick();
  return { stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { run, localIp, parseAdbDevices, watchAdbPhones, isBtIface, btAddress, parseDevices, matchPhones, nmcliReason, btPhones, btConnect, createBluetoothLink, keepAdbReverse, BT_CON };
