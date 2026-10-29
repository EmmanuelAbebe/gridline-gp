// GET /api/info → the server's physics: the game submits only when its SIM_VERSION is the same
import { begin, send } from '../lib/http.js';
import { SIM } from '../../src/sim/index.js';

export default function handler(req, res) {
  if (!begin(req, res, 'GET')) return;
  send(res, { status: 200, body: { sim: SIM.SIM_VERSION, physics: SIM.TUNING.PHYSICS, circuits: Object.values(SIM.CIRCUITS).map(c => ({ id: c.id, name: c.name })) } }, 60);
}
