// The phone wheel inside the desktop app (roadmap step 3; replaces running phone-wheel/server.py next to the game).
// Serves the phone page (phone-wheel/controller.html + static/) and takes its input over a WebSocket: JSON
// { s, g, b, k } at ~60 Hz (steer -1..1, gas 0..1, brake 0..1, button bits in BUTTONS order) plus link probes { p, r }
// answered at once with { pong, hz, gap }; feedback(fx) sends the game's force feedback { fx } to the phones. The input goes straight to the game (onInput); there is no virtual
// controller. Phones only give tilt data to https pages, so it makes a self-signed certificate for this PC's address
// (kept, and covering every address it was needed for), and a pairing code (`t` in the QR link) keeps other phones
// on the network out. Plain http on the port is redirected to https (phones often open a typed address as http).
// Links (phone-net.cjs): wifi, bluetooth (tethering; the address is watched and the certificate follows it), usb.
//
//   const link = createPhoneLink({ dataDir, pagesDir, onInput, onStatus });
//   await link.start({ link: 'wifi' | 'bluetooth' | 'usb', port }); link.status(); link.feedback(fx); await link.stop();
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const pn = require('./phone-net.cjs');

// Bit i of the phone's `k` = BUTTONS[i] (phone-wheel/static/settings.js, phonewheel/protocol.py)
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
  // a = the phone's "away" reason (0 there, 1 put down, 2 dropped / thrown: web/src/engine/presence.ts)
  const a = Number.isFinite(num(d.a)) ? clamp(Math.trunc(num(d.a)), 0, 2) : 0;
  return { msg: d, input: { s: clamp(s, -1, 1), g: clamp(g, 0, 1), b: clamp(b, 0, 1), k: Math.trunc(k) & MASK, a } };
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

function createPhoneLink({ dataDir, pagesDir, onInput = () => {}, onStatus = () => {} }) {
  let st = idle(), servers = null, token = null, btWatch = null, adb = null;
  const input = { s: 0, g: 0, b: 0, k: 0, t: 0 };
  function idle() { return { running: false, link: null, url: '', qr: '', port: 0, ip: '', phones: 0, rtt: null, hz: 0, gap: 0, note: '', error: '' }; }
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
  // the page: the React build (phone-wheel/web/dist, npm run phone:build) at /, else the previous page; that one stays
  // at /v1 (and the single-file one at /classic)
  const webDist = path.join(pagesDir, 'web', 'dist');
  function serveUnder(res, root, rel) {
    const file = path.normalize(path.join(root, decodeURIComponent(rel)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    serveFile(res, file);
  }
  function onRequest(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') return serveFile(res, fs.existsSync(path.join(webDist, 'index.html')) ? path.join(webDist, 'index.html') : path.join(pagesDir, 'controller.html'));
    if (url.pathname === '/v1') return serveFile(res, path.join(pagesDir, 'controller.html'));
    if (url.pathname.startsWith('/assets/')) return serveUnder(res, path.join(webDist, 'assets'), url.pathname.slice(8));
    if (url.pathname === '/classic') return serveFile(res, path.join(pagesDir, 'static', 'classic.html'));
    if (url.pathname === '/check') {   // lets the phone tell "wrong pairing code" apart from "PC not reachable"
      const ok = paired(url);
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ paired: ok }));
      return;
    }
    if (url.pathname.startsWith('/static/')) return serveUnder(res, path.join(pagesDir, 'static'), url.pathname.slice(8));
    res.writeHead(404).end('not found');
  }

  // ---- the WebSocket ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
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
      const p = parseMessage(data.toString());
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
    st.url = `${base}/?t=${token}`;
    st.qr = await QRCode.toString(st.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }

  async function start({ link = 'wifi', port = 8443, renewCode = false } = {}) {
    await stop();
    token = pairingToken(dataDir, renewCode);
    st = { ...idle(), running: true, link };
    try {
      if (link === 'usb') {
        // Chrome treats http://localhost as a secure page: no certificate, and only the phone (through adb) can reach it
        const srv = http.createServer(onRequest); srv.on('upgrade', onUpgrade);
        st.port = await listenFrom(srv, port, '127.0.0.1', 10); st.ip = 'localhost';
        servers = [srv];
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
    for (const ws of wss.clients) ws.terminate();
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
    for (const ws of wss.clients) if (ws.readyState === 1 && ws.bufferedAmount < 4096) ws.send(text);
  }

  return { start, stop, status, feedback, close: async () => { clearInterval(watchdog); await stop(); } };
}

module.exports = { createPhoneLink, parseMessage, pairingToken, ensureCert, BUTTONS };
