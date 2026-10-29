// GET /api/ghost?circuit=<id>&aero=on|off&id=<player> → that lap's ghost (compact, as ghost.js keeps them;
// &plain=1: expanded, the pose frames and splits as they are: the website's viewer)
import { begin, send } from '../lib/http.js';
import { getStore } from '../lib/store.js';
import { ghost } from '../lib/boards.js';
import { boardKey } from '../lib/verify.js';
import { expandGhost } from '../../src/game/ghost.js';
import { SIM } from '../../src/sim/index.js';

export default async function handler(req, res) {
  if (!begin(req, res, 'GET')) return;
  const { circuit, aero = 'on', id, plain } = req.query;
  if (!Object.hasOwn(SIM.CIRCUITS, circuit || '')) return send(res, { status: 400, body: { error: 'unknown circuit' } });
  const r = await ghost(await getStore(), boardKey(circuit, aero !== 'off'), id);
  if (r.status === 200 && plain) r.body = expandGhost(r.body);
  send(res, r, 60);
}
