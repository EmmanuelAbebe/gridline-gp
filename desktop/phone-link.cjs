// The phone wheel inside the desktop app (roadmap step 3; replaces running phone-wheel/server.py next to the game).
// Serves the phone page (phone-wheel/web/dist, the React build) and takes its input over a WebSocket: JSON
// { s, g, b, k } at ~60 Hz (steer -1..1, gas 0..1, brake 0..1, button bits in BUTTONS order) plus link probes { p, r }
// answered at once with { pong, hz, gap }; feedback(fx) sends the game's force feedback { fx } to the phones. The input goes straight to the game (onInput); there is no virtual
// controller. Phones only give tilt data to https pages, so it makes a self-signed certificate for this PC's address
// (kept, and covering every address it was needed for), and a pairing code (`t` in the QR link) keeps other phones
// on the network out. Plain http on the port is redirected to https (phones often open a typed address as http).
// Links (phone-net.cjs): wifi, bluetooth (tethering; the address is watched and the certificate follows it), usb.
//
// The game's phone designer (2026-10-31, src/game/phone-designer.js): askLayout() → each phone answers { cfg, scr } (its
// active profile, its screen in landscape) → onConfig; setLayout(l) sends { setLayout: { free, groups, labels } } and
// the phone puts it on its active profile.
//
// The phone-wheel app (2026-11-17, phone-wheel/app: the same page in an Android app): plain ws:// on its own port beside
// the https one (wsPort, normally 8444; the app's WebView sees motion sensors without https), path /app. Its first
// message must be { t: the pairing code } (the full token from the QR link, or the short code `code` shown in Settings →
// Controller, appCode()); answered { paired: 1, name, id } and from then on the same messages as /ws; a wrong code closes it
// with 4003 (and 5 wrong codes a minute from one address shut that address out for the minute). phone-beacon.cjs
// broadcasts { name, wsPort, id } every second (not over USB) so the app can list the PCs on the network. Over USB the
// app port is adb-reversed too.
//
//   const link = createPhoneLink({ dataDir, pagesDir, onInput, onStatus, onConfig });
//   await link.start({ link: 'wifi' | 'bluetooth' | 'usb', port }); link.status(); link.feedback(fx); link.dash(d); await link.stop();
//   (+ beacon: { port, targets } to send the beacon elsewhere: the tests)
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const os = require('node:os');
const pn = require('./phone-net.cjs');
const { createBeacon, BEACON_PORT } = require('./phone-beacon.cjs');

// Bit i of the phone's `k` = BUTTONS[i] (phone-wheel/web/src/settings/settings.ts, phonewheel/protocol.py)
const BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'BACK', 'START', 'GUIDE', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
const MASK = (1 << BUTTONS.length) - 1;
const WATCHDOG = 400;            // ms without a message → everything released (screen off, link drop)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// one phone message → { msg, input: { s, g, b, k } } with every value clamped / masked, or null when it isn't one
function parseMessage(text) {
  let d; try { d = JSON.parse(text); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const num = (v, def = 0) => { if (v === undefined) return def; const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? +v : NaN; return n; };
  const s = num(d.s), g = num(d.g), b = num(d.b), k = num(d.k);
  if (![s, g, b, k].every(Number.isFinite)) return null;
  // a = the phone's "away" flag (0 there, 1 put down: web/src/engine/presence.ts; 2 was "dropped", kept for old pages)
  const a = Number.isFinite(num(d.a)) ? clamp(Math.trunc(num(d.a)), 0, 2) : 0;
  // e / eq = an ECU command from the screen (0..3 a map, 4 AUTO, 5 MANUAL) and its sequence number (repeated for a while)
  const e = num(d.e), eq = num(d.eq), ecu = Number.isInteger(e) && e >= 0 && e <= 5 && Number.isInteger(eq) && eq > 0 && eq < 1e9 ? { e, eq } : {};
  return { msg: d, input: { s: clamp(s, -1, 1), g: clamp(g, 0, 1), b: clamp(b, 0, 1), k: Math.trunc(k) & MASK, a, ...ecu } };
}

// ---- pairing code and certificate (kept in dataDir between runs) ----
function pairingToken(dataDir, renew = false) {
  const p = path.join(dataDir, 'phone-token');
  if (!renew) { try { const t = fs.readFileSync(p, 'utf8').trim(); if (t.length >= 16) return t; } catch {} }
  const t = crypto.randomBytes(16).toString('base64url');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, t, { mode: 0o600 });
  return t;
}
// The certificate for `ip` (+ up to 7 addresses it was made for before, so Wi-Fi ↔ Bluetooth needs no new one).
// Returns { cert, key } PEM strings.
function ensureCert(dataDir, ip) {
  const cp = path.join(dataDir, 'phone-cert.pem'), kp = path.join(dataDir, 'phone-key.pem'), ipp = path.join(dataDir, 'phone-cert-ips');
  let known = [];
  try { known = fs.readFileSync(ipp, 'utf8').split(/\s+/).filter(a => net.isIP(a)); } catch {}
  if (known.includes(ip) && fs.existsSync(cp) && fs.existsSync(kp)) return { cert: fs.readFileSync(cp, 'utf8'), key: fs.readFileSync(kp, 'utf8') };
  const ips = [ip, ...known.filter(a => a !== ip).slice(0, 7)];
  const forge = require('node-forge');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });   // native: fast; forge signs
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const fkey = forge.pki.privateKeyFromPem(keyPem), cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(fkey.n, fkey.e);
  cert.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 864e5);
  cert.validity.notAfter = new Date(Date.now() + 825 * 864e5);
  const name = [{ name: 'commonName', value: 'gridline-gp phone wheel' }];
  cert.setSubject(name); cert.setIssuer(name);
  cert.setExtensions([{ name: 'subjectAltName', altNames: [...ips.map(a => ({ type: 7, ip: a })), { type: 2, value: 'localhost' }] }]);
  cert.sign(fkey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(kp, keyPem, { mode: 0o600 }); fs.writeFileSync(cp, certPem); fs.writeFileSync(ipp, ips.join('\n'));
  return { cert: certPem, key: keyPem };
}

// The app's short pairing code: 8 letters / digits (Crockford base32: no I, L, O, U) from the token, so it changes with it.
// Typed on the phone as ABCD-EFGH; case, spaces and dashes don't matter. 40 bits + the lock-out below on a home network.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function appCode(token) {
  const h = crypto.createHash('sha256').update('phone-wheel-app:' + token).digest();
  let bits = 0, n = 0, out = '';
  for (const byte of h) { bits = (bits << 8) | byte; n += 8; while (n >= 5 && out.length < 8) { n -= 5; out += B32[(bits >> n) & 31]; } if (out.length >= 8) break; }
  return out.slice(0, 4) + '-' + out.slice(4);
}
const plainCode = c => String(c).toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
// the app's first message: the full token or the short code
function codeMatches(given, token) {
  if (typeof given !== 'string' || !given || given.length > 64 || !token) return false;
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return same(given, token) || same(plainCode(given), plainCode(appCode(token)));
}
// this PC's id in the beacon (kept: the app remembers which PC it paired with)
function pcId(dataDir) {
  const p = path.join(dataDir, 'phone-pc-id');
  try { const t = fs.readFileSync(p, 'utf8').trim(); if (/^[\w-]{8,64}$/.test(t)) return t; } catch {}
  const t = crypto.randomBytes(9).toString('base64url');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, t);
  return t;
}
const APP_AUTH_MS = 5000;           // the app's socket must give its code within this
const LOCKOUT = { tries: 5, ms: 60000 };   // wrong codes per address per minute before it is shut out for the minute

const CFG_MAX = 64 * 1024;          // bytes: a phone's profile is a few KB
// a phone's answer to askLayout: { cfg: its profile, scr: { w, h } } (kept as plain data; the game checks it again)
function parseConfig(text) {
  if (text.length > CFG_MAX || !text.includes('"cfg"')) return null;
  let d; try { d = JSON.parse(text); } catch { return null; }
  if (!d || typeof d.cfg !== 'object' || Array.isArray(d.cfg) || !d.cfg) return null;
  const w = +d.scr?.w, h = +d.scr?.h, ok = v => Number.isFinite(v) && v >= 200 && v <= 4000;
  return { cfg: d.cfg, scr: ok(w) && ok(h) ? { w: Math.round(w), h: Math.round(h) } : null };
}

function createPhoneLink({ dataDir, pagesDir, onInput = () => {}, onStatus = () => {}, onConfig = () => {}, beacon: beaconOpts = {} }) {
  let st = idle(), servers = null, token = null, btWatch = null, adb = null, adbApp = null, beacon = null, pc = null;
  const input = { s: 0, g: 0, b: 0, k: 0, t: 0 };
  function idle() { return { running: false, link: null, url: '', qr: '', port: 0, wsPort: 0, code: '', name: '', id: '', ip: '', phones: 0, rtt: null, hz: 0, gap: 0, note: '', error: '' }; }
  const status = () => ({ ...st });
  const changed = () => onStatus(status());
  const release = () => { if (input.s || input.g || input.b || input.k) { Object.assign(input, { s: 0, g: 0, b: 0, k: 0 }); onInput({ s: 0, g: 0, b: 0, k: 0, a: input.a || 0 }); } };

  // ---- the phone's pages ----
  function serveFile(res, file) {
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data);
    });
  }
  const paired = url => { const t = url.searchParams.get('t') || ''; return t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token)); };
  // the page: the React build (phone-wheel/web/dist, made by npm run build / phone:build)
  const webDist = path.join(pagesDir, 'web', 'dist');
  const NOT_BUILT = 'The phone page is not built yet: run npm run phone:build (or npm run build) in Gridline GP.';
  function serveUnder(res, root, rel) {
    const file = path.normalize(path.join(root, decodeURIComponent(rel)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    serveFile(res, file);
  }
  function onRequest(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') {
      if (fs.existsSync(path.join(webDist, 'index.html'))) return serveFile(res, path.join(webDist, 'index.html'));
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end(NOT_BUILT); return;
    }
    if (url.pathname.startsWith('/assets/')) return serveUnder(res, path.join(webDist, 'assets'), url.pathname.slice(8));
    if (url.pathname === '/check') {   // lets the phone tell "wrong pairing code" apart from "PC not reachable"
      const ok = paired(url);
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ paired: ok }));
      return;
    }
    res.writeHead(404).end('not found');
  }

  // ---- the WebSocket ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: CFG_MAX });   // (a profile for the designer; input is ~60 bytes)
  function onUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws' || !paired(url)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => onPhone(ws));
  }
  function onPhone(ws) {
    const arrivals = [];          // receive times of the last 5 s: rate and longest gap
    let alive = true;
    st.phones++; st.note = ''; changed();
    ws.on('pong', () => { alive = true; });
    const beat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 5000);
    ws.on('message', (data, binary) => {
      if (binary) return;
      const now = performance.now();
      arrivals.push(now); while (now - arrivals[0] > 5000) arrivals.shift();
      const text = data.toString(), c = parseConfig(text);
      if (c) { onConfig(c); return; }                // (not input: a { cfg } message must not let go of the pedals)
      const p = parseMessage(text);
      if (!p) return;
      Object.assign(input, p.input, { t: now });
      onInput(p.input);
      if ('p' in p.msg) {           // link probe: answer at once so the phone can time the round trip
        let hz = 0, gap = 0;
        for (let i = 0; i < arrivals.length; i++) { if (now - arrivals[i] <= 1000) hz++; if (i) gap = Math.max(gap, arrivals[i] - arrivals[i - 1]); }
        ws.send(JSON.stringify({ pong: p.msg.p, hz, gap: Math.round(gap) }));
        Object.assign(st, { rtt: typeof p.msg.r === 'number' ? p.msg.r : null, hz, gap: Math.round(gap) }); changed();
      }
    });
    ws.on('close', () => {
      clearInterval(beat);
      st.phones = Math.max(0, st.phones - 1);
      if (!st.phones) Object.assign(st, { rtt: null, hz: 0, gap: 0 });
      release(); changed();
    });
  }

  // ---- the phone-wheel app: plain ws:// on its own port, the code in the first message ----
  const appWss = new WebSocketServer({ noServer: true, maxPayload: CFG_MAX });
  const appPhones = new Set();      // app sockets past the code
  const wrong = new Map();          // address → times of its wrong codes in the last minute
  const lockedOut = ip => { const now = Date.now(), t = (wrong.get(ip) || []).filter(x => now - x < LOCKOUT.ms); wrong.set(ip, t); return t.length >= LOCKOUT.tries; };
  function onAppUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x'), ip = socket.remoteAddress || '';
    if (url.pathname !== '/app') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    if (lockedOut(ip)) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
    appWss.handleUpgrade(req, socket, head, ws => {
      const timer = setTimeout(() => ws.close(4001, 'no pairing code'), APP_AUTH_MS);
      ws.once('message', (data, binary) => {
        clearTimeout(timer);
        let t = null; if (!binary && data.length <= 256) { try { t = JSON.parse(data.toString()).t; } catch {} }
        if (!codeMatches(t, token)) { wrong.get(ip)?.push(Date.now()) ?? wrong.set(ip, [Date.now()]); ws.close(4003, 'wrong pairing code'); return; }
        ws.send(JSON.stringify({ paired: 1, name: st.name, id: st.id }));
        appPhones.add(ws); ws.on('close', () => appPhones.delete(ws));
        onPhone(ws);
      });
    });
  }
  const appDoor = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' }).end('This is Gridline GP\'s port for the phone-wheel app.');
  });
  appDoor.on('upgrade', onAppUpgrade);
  // every connected phone: the browser page's sockets and the app's (once past the code)
  const phonesNow = () => [...wss.clients, ...appPhones];

  const watchdog = setInterval(() => { if (performance.now() - input.t > WATCHDOG) release(); }, 100);
  watchdog.unref?.();

  // ---- servers: one public port; TLS handshakes go to https, anything else gets a redirect to https ----
  function listen(server, port, host) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); });
    });
  }
  async function listenFrom(server, port, host, tries) {
    for (let i = 0; ; i++) {
      try { return await listen(server, port ? port + i : 0, host); }
      catch (e) { if (e.code !== 'EADDRINUSE' || i >= tries || !port) throw e; }
    }
  }
  function frontDoor(tls, plain) {
    return net.createServer(socket => {
      socket.once('data', buf => {
        socket.pause(); socket.unshift(buf);
        (buf[0] === 0x16 ? tls : plain).emit('connection', socket);
        process.nextTick(() => socket.resume());
      });
      socket.on('error', () => {});
      socket.setTimeout(15000, () => socket.destroy());
    });
  }
  const redirect = http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host || `${st.ip}:${st.port}`}/`, 'Content-Length': 0, Connection: 'close' }).end();
  });

  async function publish(base) {
    st.url = `${base}/?t=${token}&w=${st.wsPort}&i=${st.id}`;      // (w, i: the app reads its port and the PC's id from the QR)
    st.qr = await QRCode.toString(st.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }

  async function start({ link = 'wifi', port = 8443, renewCode = false } = {}) {
    await stop();
    token = pairingToken(dataDir, renewCode);
    pc ??= pcId(dataDir);
    st = { ...idle(), running: true, link, code: appCode(token), name: os.hostname().slice(0, 40), id: pc };
    try {
      if (link === 'usb') {
        // Chrome treats http://localhost as a secure page: no certificate, and only the phone (through adb) can reach it
        const srv = http.createServer(onRequest); srv.on('upgrade', onUpgrade);
        st.port = await listenFrom(srv, port, '127.0.0.1', 10); st.ip = 'localhost';
        servers = [srv];
        st.wsPort = await listenFrom(appDoor, port ? st.port + 1 : 0, '127.0.0.1', 10); servers.push(appDoor);
        adbApp = pn.keepAdbReverse(st.wsPort, () => {});
        await publish(`http://localhost:${st.port}`);
        st.note = 'Plug the phone in with USB debugging on.';
        adb = pn.keepAdbReverse(st.port, up => { st.note = up ? '' : 'Waiting for the phone over USB: plug it in, turn on USB debugging and accept the prompt (needs adb).'; changed(); });
      } else {
        let ip;
        if (link === 'bluetooth') {
          const bt = pn.createBluetoothLink('auto');
          ip = await bt.poll();
          if (!ip) { st.note = bt.note || 'Waiting for the Bluetooth link: turn on Bluetooth tethering on the phone.'; }
          ip ||= await pn.localIp();     // serve meanwhile; the address (and link) follow once the link is up
          btWatch = setInterval(async () => {
            const now = await bt.poll();
            if (!st.running || btWatch === null) return;
            if (!now) { const note = bt.note || 'Bluetooth link lost: is tethering still on?'; if (note !== st.note) { st.note = note; changed(); } return; }
            if (st.note) { st.note = ''; changed(); }
            if (now !== st.ip) { st.ip = now; tls.setSecureContext(ensureCert(dataDir, now)); await publish(`https://${now}:${st.port}`); changed(); }
          }, 3000);
        } else ip = await pn.localIp();
        const tls = https.createServer(ensureCert(dataDir, ip), onRequest);
        tls.on('upgrade', onUpgrade);
        tls.on('tlsClientError', () => {});
        const door = frontDoor(tls, redirect);
        st.port = await listenFrom(door, port, '0.0.0.0', 10); st.ip = ip;
        servers = [door, tls];
        st.wsPort = await listenFrom(appDoor, port ? st.port + 1 : 0, '0.0.0.0', 10); servers.push(appDoor);
        beacon = createBeacon({ name: st.name, id: st.id, wsPort: st.wsPort, port: beaconOpts.port ?? BEACON_PORT, ...(beaconOpts.targets ? { targets: beaconOpts.targets } : {}) });
        await publish(`https://${ip}:${st.port}`);
      }
    } catch (e) {
      const why = e.code === 'EADDRINUSE' ? `ports ${port}–${port + 10} are all in use` : e.message;
      await stop(); st.error = `Couldn't start the phone link: ${why}`;
    }
    changed();
    return status();
  }

  async function stop() {
    if (btWatch) { clearInterval(btWatch); btWatch = null; }
    if (adb) { adb.stop(); adb = null; }
    if (adbApp) { adbApp.stop(); adbApp = null; }
    if (beacon) { beacon.stop(); beacon = null; }
    for (const ws of [...wss.clients, ...appWss.clients]) ws.terminate();
    for (const s of servers || []) await new Promise(r => { s.close(() => r()); s.closeAllConnections?.(); });
    servers = null;
    release();
    const wasRunning = st.running;
    st = idle();
    if (wasRunning) changed();
  }

  // force feedback from the game (src/game/haptics.js) → every connected phone; dropped when a socket is backed up
  function feedback(fx) {
    if (!fx || typeof fx !== 'object') return;
    const text = JSON.stringify({ fx });
    for (const ws of phonesNow()) if (ws.readyState === 1 && ws.bufferedAmount < 4096) ws.send(text);
  }
  // the dash (2026-10-26): { g gear, q queued downshift, r revs 0..1 (1 = shift now), v km/h, + the ECU (2026-10-31): n rpm,
  // e map index (−1 none), m 'A' / 'M', b battery %, k 1 deploying / −1 harvesting } or {} = not driving
  function dash(d) {
    if (!d || typeof d !== 'object') return;
    const text = JSON.stringify({ dash: d });
    for (const ws of phonesNow()) if (ws.readyState === 1 && ws.bufferedAmount < 4096) ws.send(text);
  }

  // the game's phone designer: ask the phones for their layout / send them a new one
  const toPhones = msg => { const text = JSON.stringify(msg); for (const ws of phonesNow()) if (ws.readyState === 1) ws.send(text); };
  const askLayout = () => toPhones({ getCfg: 1 });
  function setLayout(l) {
    if (!l || typeof l !== 'object') return;
    const text = JSON.stringify({ setLayout: l });
    if (text.length <= CFG_MAX) toPhones({ setLayout: l });
  }

  return { start, stop, status, feedback, dash, askLayout, setLayout, close: async () => { clearInterval(watchdog); await stop(); } };
}

module.exports = { createPhoneLink, parseMessage, parseConfig, pairingToken, ensureCert, appCode, codeMatches, BUTTONS };
