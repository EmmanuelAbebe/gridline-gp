// Where the boards live: Upstash Redis (Vercel Marketplace: its env vars come with the integration), or memory (tests,
// local runs without Redis). The few operations the boards need, the same for both.
//  zget(key, member) → score | null        zadd(key, score, member)        zrem(key, member)        zrank(key, member) → 0-based | null
//  ztop(key, n) → [{ member, score }] fastest first        ztrimTo(key, n) → the members removed (slowest)
//  get(key) / set(key, value) / del(...keys) (JSON values)  hit(key, seconds) → count in that window (rate limits)
export function memoryStore() {
  const z = new Map(), kv = new Map(), sorted = key => [...(z.get(key) || new Map())].map(([member, score]) => ({ member, score }))
    .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
  return {
    async zget(key, m) { return z.get(key)?.get(m) ?? null; },
    async zadd(key, score, m) { if (!z.has(key)) z.set(key, new Map()); z.get(key).set(m, score); },
    async zrem(key, m) { z.get(key)?.delete(m); },
    async zrank(key, m) { const i = sorted(key).findIndex(e => e.member === m); return i < 0 ? null : i; },
    async ztop(key, n) { return sorted(key).slice(0, n); },
    async ztrimTo(key, n) { const out = sorted(key).slice(n).map(e => e.member); for (const m of out) z.get(key).delete(m); return out; },
    async get(key) { return kv.has(key) ? structuredClone(kv.get(key)) : null; },
    async mget(keys) { return keys.map(k => kv.has(k) ? structuredClone(kv.get(k)) : null); },
    async set(key, v) { kv.set(key, structuredClone(v)); },
    async setnx(key, v) { if (kv.has(key)) return false; kv.set(key, structuredClone(v)); return true; },
    async del(...keys) { for (const k of keys) kv.delete(k); },
    async hit(key) { const n = (kv.get(key) || 0) + 1; kv.set(key, n); return n; },
  };
}

// Upstash's REST client (@upstash/redis): URL and token from the integration's env vars (either naming)
export async function redisStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const { Redis } = await import('@upstash/redis');
  const r = new Redis({ url, token });
  return {
    async zget(key, m) { const s = await r.zscore(key, m); return s === null || s === undefined ? null : +s; },
    async zadd(key, score, m) { await r.zadd(key, { score, member: m }); },
    async zrem(key, m) { await r.zrem(key, m); },
    async zrank(key, m) { const i = await r.zrank(key, m); return i === null || i === undefined ? null : i; },
    async ztop(key, n) {
      const flat = await r.zrange(key, 0, n - 1, { withScores: true }), out = [];
      for (let i = 0; i + 1 < flat.length; i += 2) out.push({ member: String(flat[i]), score: +flat[i + 1] });
      return out;
    },
    async ztrimTo(key, n) {
      const out = (await r.zrange(key, n, -1)).map(String);
      if (out.length) await r.zremrangebyrank(key, n, -1);
      return out;
    },
    async get(key) { return (await r.get(key)) ?? null; },
    async mget(keys) { return keys.length ? r.mget(...keys) : []; },
    async set(key, v) { await r.set(key, v); },
    async setnx(key, v) { return (await r.set(key, v, { nx: true })) === 'OK'; },
    async del(...keys) { if (keys.length) await r.del(...keys); },
    async hit(key, seconds) { const n = await r.incr(key); if (n === 1) await r.expire(key, seconds); return n; },
  };
}

let shared = null;
// the store for this function instance: Redis when configured, else memory (with a warning: nothing is kept)
export async function getStore() {
  if (!shared) {
    shared = await redisStore();
    if (!shared) { console.warn('leaderboard: no Upstash Redis env vars, using memory (nothing is kept)'); shared = memoryStore(); }
  }
  return shared;
}
