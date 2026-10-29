// GET /api/board?circuit=<id>&aero=on|off → { board, rows } (the top 100 with their sectors and settings)
import { begin, send } from '../lib/http.js';
import { getStore } from '../lib/store.js';
import { board } from '../lib/boards.js';
import { boardKey } from '../lib/verify.js';
import { SIM } from '../../src/sim/index.js';

export default async function handler(req, res) {
  if (!begin(req, res, 'GET')) return;
  const { circuit, aero = 'on' } = req.query;
  if (!Object.hasOwn(SIM.CIRCUITS, circuit || '')) return send(res, { status: 400, body: { error: 'unknown circuit' } });
  send(res, await board(await getStore(), boardKey(circuit, aero !== 'off')), 15);
}
