// Which PC the phone-wheel app talks to, and how (2026-11-17). A browser tab is served by the PC itself, so it connects
// back to where it came from (wss://<page's host>/ws?t=<token from the QR link>). The app has no page host: it keeps the
// PCs it paired with (localStorage `pw-pcs`), finds them on the network by their beacon (desktop/phone-beacon.cjs: every
// second { pw: 1, name, wsPort, id }) and connects with plain ws://<address>:<wsPort>/app, its first message
// { t: pairing code } (the QR link's token, or the short code Settings → Controller shows). Pure apart from the store, so
// Node tests it (web/test/pairing.test.ts).
export const BEACON_PORT = 8445;        // desktop/phone-beacon.cjs BEACON_PORT
export const APP_PORT = 8444;           // the game's app port when nothing else had it (https port + 1)
export const SEEN_FOR = 4000;           // ms a PC stays in the list after its last beacon

export interface Pc { id: string; name: string; host: string; wsPort: number; code: string }
export interface Seen { id: string; name: string; host: string; wsPort: number; at: number }

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const okPort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;
const okId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{4,64}$/.test(id);
// an IPv4 / IPv6 address or a host name (no scheme, no port), else null
export function cleanHost(h: string): string | null {
  const s = h.trim().replace(/^\[|\]$/g, '');
  if (/^[0-9a-f:]+$/i.test(s) && s.includes(':')) return s.toLowerCase();       // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').every((n) => +n <= 255) ? s : null;
  return s.length <= 253 && HOST.test(s) ? s.toLowerCase() : null;
}
const hostPort = (host: string, port: number) => `${host.includes(':') ? `[${host}]` : host}:${port}`;

// a beacon packet (its text and the address it came from) → the PC, or null when it isn't one
export function decodeBeacon(text: string, ip: string, now = Date.now()): Seen | null {
  if (text.length > 512) return null;
  let d: { pw?: unknown; name?: unknown; wsPort?: unknown; id?: unknown };
  try { d = JSON.parse(text); } catch { return null; }
  const host = cleanHost(ip.replace(/^::ffff:/, ''));
  if (!d || d.pw !== 1 || !okId(d.id) || typeof d.wsPort !== 'number' || !okPort(d.wsPort) || !host) return null;
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 40) : 'PC';
  return { id: d.id, name, host, wsPort: d.wsPort, at: now };
}

// The game's QR code: https://<address>:<port>/?t=<token>&w=<app port>&i=<PC id> (desktop/phone-link.cjs publish).
// Older games have no w / i: the app port is the page's + 1, the id made from the address.
export function parseQr(text: string): Pc | null {
  let u: URL; try { u = new URL(text.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = cleanHost(u.hostname), t = u.searchParams.get('t') || '';
  const page = +(u.port || (u.protocol === 'https:' ? 443 : 80)), w = +(u.searchParams.get('w') || page + 1);
  if (!host || !okPort(w) || t.length < 8 || t.length > 64) return null;
  const i = u.searchParams.get('i');
  return { id: okId(i) ? i : `addr-${host.replace(/[^\w-]/g, '-')}`, name: host, host, wsPort: w, code: t };
}

// a typed address: "192.168.1.20", "192.168.1.20:8444", "my-pc.local", "http://…" → { host, wsPort } or null
export function parseAddress(text: string): { host: string; wsPort: number } | null {
  let s = text.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  let port = APP_PORT;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(s), v4 = /^([^:]+):(\d+)$/.exec(s);
  if (v6) { s = v6[1]; if (v6[2]) port = +v6[2]; } else if (v4) { s = v4[1]; port = +v4[2]; }
  const host = cleanHost(s);
  return host && okPort(port) ? { host, wsPort: port } : null;
}

// a typed pairing code → as the game shows it (ABCD-EFGH); a full token (from a QR link) is kept as it is
export function normalizeCode(text: string): string {
  const t = text.trim();
  const plain = t.toUpperCase().replace(/[\s-]/g, '');
  return /^[0-9A-Z]{8}$/.test(plain) ? `${plain.slice(0, 4)}-${plain.slice(4)}` : t;
}
export const codeLooksRight = (c: string) => /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c) || /^[\w-]{16,64}$/.test(c);

// The socket to open: in the app the PC picked (null = none yet), in a browser the page's own server.
export function transport(o: { app: boolean; protocol: string; host: string; token: string; pc: Pc | null }): { url: string; hello: string | null } | null {
  if (!o.app) return { url: `${o.protocol === 'https:' ? 'wss' : 'ws'}://${o.host}/ws?t=${encodeURIComponent(o.token)}`, hello: null };
  if (!o.pc) return null;
  return { url: `ws://${hostPort(o.pc.host, o.pc.wsPort)}/app`, hello: JSON.stringify({ t: o.pc.code }) };
}

// ---------- the PCs this phone paired with (localStorage pw-pcs: { current, pcs }), and those heard on the network
interface PcStore { current: string | null; pcs: Pc[] }
const KEY = 'pw-pcs';
let mem: PcStore | null = null;
function load(): PcStore {
  if (mem) return mem;
  mem = { current: null, pcs: [] };
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.pcs)) {
      mem.pcs = d.pcs.filter((p: Pc) => p && okId(p.id) && cleanHost(String(p.host)) && okPort(p.wsPort) && typeof p.code === 'string')
        .map((p: Pc) => ({ id: p.id, name: String(p.name || p.host).slice(0, 40), host: cleanHost(p.host)!, wsPort: p.wsPort, code: p.code })).slice(0, 10);
      mem.current = mem.pcs.some((p) => p.id === d.current) ? d.current : null;
    }
  } catch { /* storage blocked or broken: start empty */ }
  return mem;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage blocked */ } changed(); }
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
export function onPcs(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export const pairedPcs = () => load().pcs;
export const currentPc = () => { const s = load(); return s.pcs.find((p) => p.id === s.current) ?? null; };
// pair with / switch to a PC (the newest first; up to 10 kept)
export function choosePc(pc: Pc) {
  const s = load();
  s.pcs = [pc, ...s.pcs.filter((p) => p.id !== pc.id)].slice(0, 10);
  s.current = pc.id;
  save();
}
export function forgetPc(id: string) {
  const s = load();
  s.pcs = s.pcs.filter((p) => p.id !== id);
  if (s.current === id) s.current = null;
  save();
}

const seen = new Map<string, Seen>();
export const seenPcs = (now = Date.now()) => [...seen.values()].filter((p) => now - p.at < SEEN_FOR).sort((a, b) => a.name.localeCompare(b.name));
// A beacon heard: listed, and a paired PC's address kept up to date (its address changed: a new DHCP lease, Wi-Fi ↔
// Bluetooth). True when that was the PC in use: the engine reconnects to it.
export function notePc(p: Seen): boolean {
  const before = seen.get(p.id);
  seen.set(p.id, p);
  const s = load(), known = s.pcs.find((x) => x.id === p.id);
  let moved = false;
  if (known && (known.host !== p.host || known.wsPort !== p.wsPort || known.name !== p.name)) {
    moved = s.current === p.id && (known.host !== p.host || known.wsPort !== p.wsPort);
    Object.assign(known, { host: p.host, wsPort: p.wsPort, name: p.name });
    save();
  } else if (!before) changed();
  return moved;
}
// (the tests)
export function resetPcs() { mem = { current: null, pcs: [] }; seen.clear(); }
