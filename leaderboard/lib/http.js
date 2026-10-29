// Small helpers for the Vercel functions (api/*.js): CORS (the game runs from file:// and inside Electron, the website
// from this domain), JSON replies, the caller's IP (rate limits), a body size cap.
export const MAX_BODY = 1024 * 1024;           // a 30-minute run is ~0.5 MB as base64
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
// handles OPTIONS (CORS preflight) and the wrong method; true = carry on
export function begin(req, res, method) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (req.method !== method) { res.status(405).json({ error: `${method} only` }); return false; }
  return true;
}
export const send = (res, { status, body }, cache = 0) => {
  if (cache && status === 200) res.setHeader('Cache-Control', `public, s-maxage=${cache}, stale-while-revalidate=${cache * 4}`);
  res.status(status).json(body);
};
export const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
export async function jsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const parts = []; let n = 0;
  for await (const p of req) { n += p.length; if (n > MAX_BODY) throw new Error('too big'); parts.push(p); }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}
