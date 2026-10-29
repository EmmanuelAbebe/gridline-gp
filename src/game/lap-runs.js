// Your best leaderboard lap per board, kept on this computer with its run's replay (2026-10-29; user: a way to submit
// your laps, also later). A board = circuit × active aero (online.js boardOf); a run = the replay from lights out to the
// end of that lap (gzipped, base64: what the server takes), the lap's time and how it went when sent. Kept whether you
// have joined the leaderboard or not, so the start menu's Leaderboard screen can send it any time. Only runs on this
// physics code (SIM_VERSION) are kept: others can't be checked by the server. Pure: tests/online.test.js.
// localStorage `gridline.runs`: { sim, runs: { board: run } }
// run: { board, circuit, aero, time, lap, date, controller, steps, packed, status, rank?, reason?, best? }
// status: 'unsent' | 'new' (on the board at `rank`) | 'kept' (a faster lap of yours there stands: `best`) |
//         'outside' (slower than the 100th) | 'rejected' (the server said why: `reason`)
import { SIM } from '../sim/index.js';

export const RUNS = Object.freeze({ maxPacked: 1024 * 1024 });   // (the server's limit: leaderboard/lib/http.js MAX_BODY)
const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
const okRun = r => r && typeof r.board === 'string' && Number.isFinite(r.time) && r.time > 0 && typeof r.packed === 'string' && Object.hasOwn(SIM.CIRCUITS, r.circuit);

export function loadRuns(json) {
  const s = parse(json);
  if (s.sim !== SIM.SIM_VERSION) return {};                    // (another version of the physics: those can't be sent)
  return Object.fromEntries(Object.entries(s.runs || {}).filter(([k, r]) => okRun(r) && r.board === k));
}
export const runsJson = runs => JSON.stringify({ sim: SIM.SIM_VERSION, runs });
// keeps the run when it is the first or the fastest on its board; true when kept
export function keepRun(runs, run) {
  if (!okRun(run) || run.packed.length > RUNS.maxPacked) return false;
  const old = runs[run.board];
  if (old && old.time <= run.time) return false;
  runs[run.board] = { ...run, status: 'unsent' };
  return true;
}
// worth sending: not sent yet, or the server never took it (offline then: it stays 'unsent')
export const sendable = run => !!run && (run.status === 'unsent');
// the server's answer (online.js submit) or its refusal → the run's status
export function settle(run, answer, reason = '') {
  if (!answer) Object.assign(run, { status: 'rejected', reason });
  else Object.assign(run, { status: answer.status, rank: answer.rank ?? null, best: answer.best ?? null, hundredth: answer.hundredth ?? null, reason: '' });
  return run;
}
export function statusText(run) {
  switch (run.status) {
    case 'new': return `on the board, P${run.rank}`;
    case 'kept': return `your faster lap there stands (P${run.rank})`;
    case 'outside': return 'outside the top 100';
    case 'rejected': return `not ranked: ${run.reason}`;
    default: return 'not sent';
  }
}
