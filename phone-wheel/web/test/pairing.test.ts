// The phone-wheel app's link to the PC (src/engine/pairing.ts): ws:// in the app vs wss:// in a browser, the beacon, the
// game's QR link, typed addresses and codes, the paired PCs following a PC to a new address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteUsb, readProbe, usbPc, choosePc, currentPc, decodeBeacon, forgetPc, normalizeCode, codeLooksRight, notePc, pairedPcs, parseAddress, parseQr,
  resetPcs, seenPcs, transport, type Pc } from '../src/engine/pairing.ts';

const PC: Pc = { id: 'abcdEFGH12', name: 'desk', host: '192.168.1.20', wsPort: 8444, code: 'ABCD-EFGH' };

test('a browser tab keeps its own server (wss on https); the app opens ws:// to the PC it picked and sends the code first', () => {
  assert.deepEqual(transport({ app: false, protocol: 'https:', host: '192.168.1.20:8443', token: 'a b', pc: null }),
    { url: 'wss://192.168.1.20:8443/ws?t=a%20b', hello: null, via: 'page' });
  assert.equal(transport({ app: false, protocol: 'http:', host: 'localhost:8443', token: 't', pc: PC })!.url, 'ws://localhost:8443/ws?t=t', 'USB: http://localhost');
  assert.deepEqual(transport({ app: true, protocol: 'http:', host: 'localhost', token: '', pc: PC }),
    { url: 'ws://192.168.1.20:8444/app', hello: '{"t":"ABCD-EFGH"}', via: 'net' });
  assert.equal(transport({ app: true, protocol: 'http:', host: 'localhost', token: '', pc: { ...PC, host: 'fe80::1' } })!.url, 'ws://[fe80::1]:8444/app');
  assert.equal(transport({ app: true, protocol: 'http:', host: 'localhost', token: 'x', pc: null }), null, 'no PC picked: nothing to open');
});

test('the beacon: ours taken with the sender\'s address, anything else ignored', () => {
  const b = decodeBeacon(JSON.stringify({ pw: 1, name: 'desk', wsPort: 8444, id: 'abcdEFGH12' }), '::ffff:192.168.1.20', 5);
  assert.deepEqual(b, { id: 'abcdEFGH12', name: 'desk', host: '192.168.1.20', wsPort: 8444, at: 5 });
  for (const [text, ip] of [['nope', '1.2.3.4'], ['{"pw":2,"wsPort":1,"id":"abcd"}', '1.2.3.4'], ['{"pw":1,"wsPort":0,"id":"abcd"}', '1.2.3.4'],
    ['{"pw":1,"wsPort":8444,"id":"a b"}', '1.2.3.4'], ['{"pw":1,"wsPort":8444,"id":"abcd"}', 'not an ip!']])
    assert.equal(decodeBeacon(text, ip), null, text);
});

test('the game\'s QR link, typed addresses and codes', () => {
  assert.deepEqual(parseQr('https://192.168.1.20:8443/?t=Zx_9-abcdefghijklmnop&w=8444&i=abcdEFGH12'),
    { id: 'abcdEFGH12', name: '192.168.1.20', host: '192.168.1.20', wsPort: 8444, code: 'Zx_9-abcdefghijklmnop' });
  const old = parseQr('https://10.0.0.5:8450/?t=abcdefghijklmnop');      // an older game: no w / i
  assert.equal(old!.wsPort, 8451); assert.equal(old!.id, 'addr-10-0-0-5');
  for (const bad of ['hello', 'https://192.168.1.20:8443/', 'ftp://1.2.3.4/?t=abcdefghijkl', 'https://1.2.3.4:8443/?t=abcdefghijkl&w=99999']) assert.equal(parseQr(bad), null, bad);
  assert.deepEqual(parseAddress(' 192.168.1.20 '), { host: '192.168.1.20', wsPort: 8444 });
  assert.deepEqual(parseAddress('http://192.168.1.20:8450/'), { host: '192.168.1.20', wsPort: 8450 });
  assert.deepEqual(parseAddress('My-PC.local'), { host: 'my-pc.local', wsPort: 8444 });
  assert.deepEqual(parseAddress('[fe80::1]:9000'), { host: 'fe80::1', wsPort: 9000 });
  for (const bad of ['', '300.1.1.1', 'a b', '1.2.3.4:0', 'x:y']) assert.equal(parseAddress(bad), null, bad);
  assert.equal(normalizeCode(' abcd efgh '), 'ABCD-EFGH'); assert.equal(normalizeCode('abcd-efgh'), 'ABCD-EFGH');
  assert.ok(codeLooksRight('ABCD-EFGH')); assert.ok(codeLooksRight('Zx_9-abcdefghijklmnop')); assert.ok(!codeLooksRight('ABC'));
});

test('paired PCs: picked, listed, followed to a new address by their beacon, forgotten', () => {
  resetPcs();
  assert.equal(currentPc(), null);
  choosePc(PC); choosePc({ ...PC, id: 'otherPC123', name: 'laptop' }); choosePc(PC);
  assert.deepEqual(pairedPcs().map((p) => p.id), ['abcdEFGH12', 'otherPC123'], 'the newest first, no twins');
  assert.equal(currentPc()!.id, PC.id);
  const now = Date.now();
  assert.equal(notePc({ id: PC.id, name: 'desk', host: '192.168.1.20', wsPort: 8444, at: now }), false, 'same place: nothing to do');
  assert.equal(notePc({ id: PC.id, name: 'desk', host: '192.168.1.33', wsPort: 8444, at: now }), true, 'the PC in use moved: reconnect');
  assert.equal(currentPc()!.host, '192.168.1.33'); assert.equal(currentPc()!.code, 'ABCD-EFGH', 'the code stays');
  assert.equal(notePc({ id: 'otherPC123', name: 'laptop', host: '10.0.0.9', wsPort: 8444, at: now }), false, 'another paired PC moved: no reconnect');
  assert.deepEqual(seenPcs(now).map((p) => p.name), ['desk', 'laptop']);
  assert.deepEqual(seenPcs(now + 10000), [], 'not heard for a while: off the list');
  forgetPc(PC.id);
  assert.equal(currentPc(), null);
  resetPcs();
});

test('USB: the game on the cable comes first, no code; a probe\'s answer read; appearing reported once', () => {
  assert.deepEqual(transport({ app: true, protocol: 'http:', host: 'localhost', token: '', pc: PC, usb: true }),
    { url: 'ws://localhost:8444/app', hello: '{"usb":1}', via: 'usb' });
  assert.deepEqual(transport({ app: true, protocol: 'http:', host: 'localhost', token: '', pc: null, usb: true })!.via, 'usb', 'no PC picked: the cable is enough');
  assert.equal(transport({ app: true, protocol: 'http:', host: 'localhost', token: '', pc: PC, usb: false })!.via, 'net');
  assert.deepEqual(readProbe('{"usb":1,"name":"desk","id":"abcdEFGH12"}'), { name: 'desk', id: 'abcdEFGH12' });
  for (const bad of ['{"paired":1}', '{"usb":1,"id":"x"}', 'nope']) assert.equal(readProbe(bad), null, bad);
  resetPcs();
  assert.equal(noteUsb({ name: 'desk', id: 'abcdEFGH12' }), true, 'appeared');
  assert.equal(noteUsb({ name: 'desk', id: 'abcdEFGH12' }), false, 'still there');
  assert.equal(usbPc()!.name, 'desk');
  assert.equal(noteUsb(null), false); assert.equal(usbPc(), null, 'unplugged');
  resetPcs();
});
