// POST /api/register { name } → { id, token, name }: a new player (the game keeps the token; no email, no password)
import { begin, send, ipOf, jsonBody } from '../lib/http.js';
import { getStore } from '../lib/store.js';
import { register } from '../lib/boards.js';

export default async function handler(req, res) {
  if (!begin(req, res, 'POST')) return;
  let body; try { body = await jsonBody(req); } catch (e) { return send(res, { status: 400, body: { error: 'bad request' } }); }
  send(res, await register(await getStore(), body, ipOf(req)));
}
