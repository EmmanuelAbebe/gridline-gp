// The desktop app's phone wheel (desktop/phone-link.cjs, phone-net.cjs): message parsing, pairing code, certificate,
// the network-tool parsers, and a real server on a free port: pages, http → https redirect, pairing, WebSocket input,
// link probes, release on disconnect and by the watchdog. Runs in Node (no Electron needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createPhoneLink, parseMessage, pairingToken, ensureCert } = require('../desktop/phone-link.cjs');
const pn = require('../desktop/phone-net.cjs');
const WebSocket = require('ws');
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gridline-phone-'));

test('phone messages: clamped, masked, bad ones ignored', () => {
  assert.deepEqual(parseMessage(JSON.stringify({ s: -3, g: 0.5, b: 2, k: (1 << 20) | 5, p: 7 })).input, { s: -1, g: 0.5, b: 1, k: 5, a: 0 });
  assert.deepEqual(parseMessage('{}').input, { s: 0, g: 0, b: 0, k: 0, a: 0 });
  assert.equal(parseMessage('{"a": 1}').input.a, 1, 'the phone was put down');
  assert.equal(parseMessage('{"a": 9}').input.a, 2);
  assert.equal(parseMessage('{"p": 4}').msg.p, 4);
  for (const bad of ['not json', '{"s": "left"}', '{"k": null}', '[1, 2]', '42', 'null']) assert.equal(parseMessage(bad), null, bad);
});

test('pairing code is kept until renewed; certificate covers every address it was made for', () => {
  const d = tmp();
  const a = pairingToken(d);
  assert.ok(a.length >= 16);
  assert.equal(pairingToken(d), a);
  assert.notEqual(pairingToken(d, true), a);
  const first = ensureCert(d, '192.168.1.20').cert;
  assert.equal(ensureCert(d, '192.168.1.20').cert, first, 'same address: kept');
  const both = ensureCert(d, '10.59.230.82').cert;
  const san = new X509Certificate(both).subjectAltName;
  assert.match(san, /IP Address:10\.59\.230\.82/); assert.match(san, /IP Address:192\.168\.1\.20/); assert.match(san, /DNS:localhost/);
  assert.equal(ensureCert(d, '192.168.1.20').cert, both, 'switching back needs no new certificate');
});

test('network tools: Bluetooth address, paired devices, phone choice, nmcli errors', () => {
  const ifaces = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], wlp3s0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
    enx001a7dda7113: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '10.59.230.82', internal: false }] };
  assert.deepEqual(pn.btAddress(ifaces, n => n.startsWith('enx')), { iface: 'enx001a7dda7113', ip: '10.59.230.82' });
  assert.equal(pn.btAddress(ifaces, () => false), null);
  const devs = pn.parseDevices('Device F0:05:1B:90:6E:66 Galaxy S23 FE\nDevice AA:BB:CC:DD:EE:FF\nController 00:11 pc\n');
  assert.deepEqual(devs, [{ mac: 'F0:05:1B:90:6E:66', name: 'Galaxy S23 FE' }, { mac: 'AA:BB:CC:DD:EE:FF', name: 'AA:BB:CC:DD:EE:FF' }]);
  const phones = [{ ...devs[0], nap: true }, { ...devs[1], nap: false }];
  assert.deepEqual(pn.matchPhones(phones, 'auto'), phones.slice(0, 1));
  assert.deepEqual(pn.matchPhones(phones, 's23'), phones.slice(0, 1));
  assert.deepEqual(pn.matchPhones(phones, 'aa:bb:cc:dd:ee:ff'), phones.slice(1));
  assert.equal(pn.nmcliReason('Error: Connection activation failed.\nHint: use journalctl -xe'), 'Error: Connection activation failed.');
  assert.equal(pn.nmcliReason(''), "the phone didn't answer");
});

const get = (url, opts = {}) => new Promise((resolve, reject) => {
  (url.startsWith('https') ? https : http).get(url, { rejectUnauthorized: false, ...opts }, res => {
    let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});
const until = async (cond, ms = 2000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); } };

test('phone link server: pages, redirect, pairing, input, probes, release', async () => {
  const inputs = [], statuses = [];
  const link = createPhoneLink({ dataDir: tmp(), pagesDir: path.join(ROOT, 'phone-wheel'), onInput: i => inputs.push(i), onStatus: s => statuses.push(s) });
  try {
    const st = await link.start({ link: 'wifi', port: 0 });
    assert.ok(st.running && st.port > 0 && !st.error, JSON.stringify(st));
    const token = new URL(st.url).searchParams.get('t'), base = `https://127.0.0.1:${st.port}`;
    assert.match(st.qr, /^<svg/);
    const page = await get(base + '/');
    assert.equal(page.status, 200); assert.match(page.body, /<html/i); assert.equal(page.headers['cache-control'], 'no-cache');
    assert.equal((await get(base + '/static/engine.js')).headers['content-type'], 'text/javascript');
    assert.equal((await get(base + '/static/../../package.json')).status, 404, 'no way out of static/');
    const plain = await get(`http://127.0.0.1:${st.port}/`);
    assert.equal(plain.status, 301); assert.equal(plain.headers.location, `https://127.0.0.1:${st.port}/`);
    assert.equal((await get(`${base}/check?t=${token}`)).status, 200);
    assert.equal((await get(`${base}/check?t=nope`)).status, 403);

    const refused = new WebSocket(`wss://127.0.0.1:${st.port}/ws?t=nope`, { rejectUnauthorized: false });
    await new Promise(r => { refused.on('error', r); refused.on('unexpected-response', r); });

    const ws = new WebSocket(`wss://127.0.0.1:${st.port}/ws?t=${token}`, { rejectUnauthorized: false });
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    await until(() => link.status().phones === 1);
    ws.send(JSON.stringify({ s: 0.25, g: 1, b: 0, k: 16 }));
    ws.send('not json');
    const pong = new Promise(r => ws.once('message', m => r(JSON.parse(m))));
    ws.send(JSON.stringify({ s: 0.5, g: 0, b: 0.5, k: 0, p: 3, r: 21.5 }));
    const p = await pong;
    assert.equal(p.pong, 3); assert.ok(p.hz >= 2);
    assert.deepEqual(inputs.slice(-2), [{ s: 0.25, g: 1, b: 0, k: 16, a: 0 }, { s: 0.5, g: 0, b: 0.5, k: 0, a: 0 }]);
    assert.equal(link.status().rtt, 21.5);
    const fx = new Promise(r => ws.once('message', m => r(JSON.parse(m))));   // force feedback reaches the phone
    link.feedback({ k: 0.5, kh: 12, o: 0, s: 0, h: 1 });
    assert.deepEqual(await fx, { fx: { k: 0.5, kh: 12, o: 0, s: 0, h: 1 } });
    await until(() => inputs.at(-1).s === 0, 1500);           // silent for > 0.4 s: the watchdog lets go
    ws.send(JSON.stringify({ s: 1, g: 1, b: 0, k: 1 }));
    await until(() => inputs.at(-1).s === 1);
    ws.close();
    await until(() => link.status().phones === 0);
    assert.deepEqual(inputs.at(-1), { s: 0, g: 0, b: 0, k: 0, a: 0 }, 'disconnect releases everything');
    assert.ok(statuses.some(s => s.phones === 1));
  } finally {
    await link.close();
  }
  assert.equal(link.status().running, false);
});
