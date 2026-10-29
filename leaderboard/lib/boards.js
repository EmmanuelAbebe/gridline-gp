// The leaderboard itself (pure apart from the store passed in; tests/leaderboard.test.js). Players: a display name and
// a secret token kept by the game (anonymous: no email, no password). Boards: the top `size` laps per board (circuit ×
// active aero × physics version), one per player (their best), each with its sectors, settings and the server-made
// ghost; the submitted replay is kept with it (to check laps again later). A lap outside the top 100 is not kept.
// Keys: p:<id> player, pn:<name> → id, b:<board> sorted set (score = lap time), e:<board>:<id> entry,
// g:<board>:<id> ghost, r:<board>:<id> replay, rl:<what>:<ip> rate limits.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { verifyRun } from './verify.js';

export const BOARDS = Object.freeze({
  size: 100,
  name: /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,14}[\p{L}\p{N}]$/u,   // 3–16 letters / digits, spaces . _ - inside
  limits: { register: [5, 3600], submit: [60, 3600] },            // per IP: [count, seconds]
});
// a short list of words no display name may contain (lower case, letters only); extend as needed
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'whore', 'slut', 'bitch', 'admin', 'moderator', 'gridline'];
export const nameOk = n => typeof n === 'string' && BOARDS.name.test(n) && !BLOCKED.some(w => n.toLowerCase().replace(/[^a-z]/g, '').includes(w));
const sha = s => createHash('sha256').update(s).digest('hex');
const err = (status, reason) => ({ status, body: { error: reason } });

async function limited(store, what, ip) {
  const [n, s] = BOARDS.limits[what];
  return (await store.hit(`rl:${what}:${ip || '?'}`, s)) > n;
}

// POST register { name } → { id, token, name }
export async function register(store, { name } = {}, ip = '') {
  if (await limited(store, 'register', ip)) return err(429, 'too many new players from here: try later');
  name = String(name || '').trim();
  if (!nameOk(name)) return err(400, 'a name of 3–16 letters or digits (spaces . _ - inside), nothing rude');
  const id = randomBytes(6).toString('hex'), token = randomBytes(24).toString('hex');
  if (!(await store.setnx(`pn:${name.toLowerCase()}`, id))) return err(409, 'that name is taken');
  await store.set(`p:${id}`, { name, token: sha(token), created: Date.now() });
  return { status: 200, body: { id, token, name } };
}
// "Bearer <id>.<token>" → the player, or null
export async function playerOf(store, auth) {
  const m = /^Bearer ([0-9a-f]{12})\.([0-9a-f]{48})$/.exec(auth || '');
  if (!m) return null;
  const p = await store.get(`p:${m[1]}`);
  if (!p) return null;
  const a = Buffer.from(sha(m[2])), b = Buffer.from(p.token);
  return a.length === b.length && timingSafeEqual(a, b) ? { id: m[1], name: p.name } : null;
}

// POST submit { replay, claim: { time, lap, controller } } (authorised) → { status: 'new' | 'kept' | 'outside', rank, time, best }
export async function submit(store, player, { replay, claim = {} } = {}, { replayBlob = null, ip = '', now = Date.now() } = {}) {
  if (!player) return err(401, 'sign in first');
  if (await limited(store, 'submit', ip)) return err(429, 'too many laps from here: try later');
  const v = verifyRun(replay, claim);
  if (!v.ok) return err(422, v.reason);
  const key = `b:${v.board}`, old = await store.zget(key, player.id);
  if (old !== null && old <= v.time) return { status: 200, body: { status: 'kept', time: v.time, best: old, rank: (await store.zrank(key, player.id)) + 1 } };
  await store.zadd(key, v.time, player.id);
  const removed = await store.ztrimTo(key, BOARDS.size);
  for (const m of removed) await store.del(`e:${v.board}:${m}`, `g:${v.board}:${m}`, `r:${v.board}:${m}`);
  if (removed.includes(player.id)) {
    const last = (await store.ztop(key, BOARDS.size)).at(-1);
    return { status: 200, body: { status: 'outside', time: v.time, hundredth: last?.score ?? null } };
  }
  const controller = ['phone', 'wheel', 'pad', 'keyboard'].includes(claim.controller) ? claim.controller : 'other';
  await store.set(`e:${v.board}:${player.id}`, { name: player.name, time: v.time, sectors: v.sectors, settings: { ...v.settings, controller }, date: now, lap: v.lap });
  await store.set(`g:${v.board}:${player.id}`, v.ghost);
  if (replayBlob) await store.set(`r:${v.board}:${player.id}`, replayBlob);
  return { status: 200, body: { status: 'new', time: v.time, best: old, rank: (await store.zrank(key, player.id)) + 1 } };
}

// GET board → { board, rows: [{ rank, id, name, time, gap, sectors, settings, date }] }
export async function board(store, boardId) {
  const top = await store.ztop(`b:${boardId}`, BOARDS.size), entries = await store.mget(top.map(t => `e:${boardId}:${t.member}`));
  const pole = top[0]?.score;
  return { status: 200, body: { board: boardId, rows: top.map((t, i) => ({ rank: i + 1, id: t.member, time: t.score, gap: t.score - pole, ...(entries[i] || {}) })) } };
}
// GET ghost → the compact ghost (ghost.js compactGhost) of a lap on the board
export async function ghost(store, boardId, id) {
  if (!/^[0-9a-f]{12}$/.test(id || '')) return err(400, 'bad id');
  const g = await store.get(`g:${boardId}:${id}`);
  return g ? { status: 200, body: g } : err(404, 'no such lap');
}
