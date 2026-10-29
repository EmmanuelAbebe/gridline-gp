// The online leaderboard from the game's side (docs/leaderboard-plan.md; server: leaderboard/). An account = a display
// name + a secret token this game keeps (localStorage `gridline.online`; no email, no password). After a clean flying
// lap in a time trial that beats your best sent there, the game sends the run's replay (SIM replay.js: your inputs from
// lights out) and the server drives it again to rank it; the server's answer comes back as a toast. The ghost list's
// ONLINE row races the board's fastest lap (its ghost made by the server). Only while the server runs the same physics
// as this game (SIM_VERSION, GET /api/info); otherwise nothing is sent.
import { SIM } from '../sim/index.js';
import { expandGhost } from './ghost.js';

export const ONLINE = Object.freeze({
  api: 'https://gridline-leaderboard.vercel.app',
  site: 'https://gridline-leaderboard.vercel.app',
  boardCache: 60,            // s: the fastest lap per board is looked up again after this
  maxSteps: 120 * 60 * 30,   // the server's limit (leaderboard/lib/verify.js RULES): 30 minutes of driving in one run
});
const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
// the saved account (JSON or null) → { id, token, name, auto, sent: { board: best time sent } } or a blank one
export function loadAccount(json) {
  const a = parse(json), ok = /^[0-9a-f]{12}$/.test(a.id || '') && /^[0-9a-f]{48}$/.test(a.token || '') && typeof a.name === 'string';
  return { id: ok ? a.id : null, token: ok ? a.token : null, name: ok ? a.name : null, auto: a.auto !== false,
    sent: a.sent && typeof a.sent === 'object' ? Object.fromEntries(Object.entries(a.sent).filter(([, t]) => Number.isFinite(t))) : {} };
}
export const boardOf = (circuit, aero) => `${SIM.TUNING.PHYSICS}:${circuit}:${aero ? 'on' : 'off'}`;

// gzip (the browser's own CompressionStream) → base64
async function gzipBase64(text) {
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// save(account) stores the account; fetchImpl for tests
export function createOnline({ account, save, fetchImpl = (...a) => fetch(...a) }) {
  let info = null, infoAt = 0, api = ONLINE.api;       // (api: another server for tests, gridlineDebug.onlineApi)
  const tops = new Map();                // board → { at, row | null }
  const call = async (path, opts = {}) => {
    const r = await fetchImpl(api + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    let body = {}; try { body = await r.json(); } catch (e) { /* (not JSON: a proxy, an outage) */ }
    if (!r.ok) throw new Error(body.error || `server error ${r.status}`);
    return body;
  };
  const auth = () => ({ Authorization: `Bearer ${account.id}.${account.token}` });
  return {
    get account() { return account; },
    get signedIn() { return !!account.id; },
    useServer(url) { api = url; info = null; tops.clear(); },
    // the server's physics (asked at most once a minute): { sim, physics, same } or null (offline)
    async status() {
      if (!info || performance.now() - infoAt > 60e3) {
        try { info = await call('/api/info'); infoAt = performance.now(); } catch (e) { return null; }
      }
      return { ...info, same: info.sim === SIM.SIM_VERSION };
    },
    async register(name) {
      const r = await call('/api/register', { method: 'POST', body: JSON.stringify({ name }) });
      Object.assign(account, { id: r.id, token: r.token, name: r.name, sent: {} }); save(account);
      return r;
    },
    signOut() { Object.assign(account, { id: null, token: null, name: null, sent: {} }); save(account); },
    setAuto(on) { account.auto = !!on; save(account); },
    // a lap worth sending: signed in, sending on, faster than the best already sent to that board
    worthSending(board, time) { return this.signedIn && account.auto && !(account.sent[board] <= time); },
    // send the run: → the server's answer { status: 'new' | 'kept' | 'outside', rank, time } (throws with its reason)
    async submit(replay, claim, board) {
      if (replay.steps > ONLINE.maxSteps) throw new Error('this run is longer than 30 minutes: start a new time trial');
      const s = await this.status();
      if (!s) throw new Error('offline');
      if (!s.same) throw new Error('the leaderboard runs another version of the physics: update the game');
      const r = await call('/api/submit', { method: 'POST', headers: auth(), body: JSON.stringify({ replay: await gzipBase64(JSON.stringify(replay)), claim }) });
      if (r.status === 'new' || r.status === 'kept') { account.sent[board] = Math.min(account.sent[board] ?? Infinity, r.status === 'new' ? r.time : r.best); save(account); }
      tops.delete(board);
      return r;
    },
    // the board's fastest lap { name, time, id } or null (cached a minute); undefined while unknown (offline)
    async top(circuit, aero) {
      const b = boardOf(circuit, aero), c = tops.get(b);
      if (c && performance.now() - c.at < ONLINE.boardCache * 1000) return c.row;
      try {
        const r = await call(`/api/board?circuit=${circuit}&aero=${aero ? 'on' : 'off'}`), row = r.rows[0] || null;
        tops.set(b, { at: performance.now(), row }); return row;
      } catch (e) { return undefined; }
    },
    // a lap's ghost from the board, as a ghost.js ghost (a flying lap on the stock car, the automatic zones)
    async ghost(circuit, aero, row) {
      const g = expandGhost(await call(`/api/ghost?circuit=${circuit}&aero=${aero ? 'on' : 'off'}&id=${row.id}`));
      return g && { ...g, circuit, modified: false, start: false, driver: row.name, online: { board: boardOf(circuit, aero), id: row.id } };
    },
  };
}
