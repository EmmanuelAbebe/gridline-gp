// POST /api/submit (Authorization: Bearer <id>.<token>) { replay: base64 of the gzipped replay JSON, claim: { time, lap,
// controller } } → { status: 'new' | 'kept' | 'outside', rank, time } or { error } (why it isn't ranked)
import { gunzipSync } from 'node:zlib';
import { begin, send, ipOf, jsonBody, MAX_BODY } from '../lib/http.js';
import { getStore } from '../lib/store.js';
import { playerOf, submit } from '../lib/boards.js';

export const config = { maxDuration: 30 };
export default async function handler(req, res) {
  if (!begin(req, res, 'POST')) return;
  let body, replay;
  try {
    body = await jsonBody(req);
    if (typeof body.replay !== 'string' || body.replay.length > MAX_BODY) throw new Error('size');
    replay = JSON.parse(gunzipSync(Buffer.from(body.replay, 'base64'), { maxOutputLength: 16 * MAX_BODY }).toString('utf8'));
  } catch (e) { return send(res, { status: 400, body: { error: 'not a gzipped replay' } }); }
  const store = await getStore(), player = await playerOf(store, req.headers.authorization);
  send(res, await submit(store, player, { replay, claim: body.claim || {} }, { replayBlob: body.replay, ip: ipOf(req) }));
}
