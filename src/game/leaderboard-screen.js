// The start menu's Leaderboard screen (#lbOv): your account (the online panel: join / leave), and your best leaderboard
// lap on each board kept on this computer (lap-runs.js) with how it went: not sent, on the board at P12, your faster
// lap stands, outside the top 100, or why it wasn't ranked. SUBMIT sends one, SUBMIT ALL every one not sent yet.
// ctx: { online, runs() (game.runs), send(run) → promise (main.js sendRun), onClose }
import { SIM } from '../sim/index.js';
import { $, fmtTime } from './util.js';
import { ONLINE } from './online.js';
import { sendable, statusText } from './lap-runs.js';
import { createOnlinePanel } from './online-panel.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function button(label, onclick, cls = 'btn ghost small') { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; }

export function createLeaderboardScreen({ online, runs, send }) {
  const root = $('lbOv'), list = $('lbList'), account = createOnlinePanel({ get: () => online });
  $('lbAccount').append(account.el);
  let open = false, onClose = null, busy = new Set(), wasIn = online.signedIn, poll = 0;
  const order = Object.keys(SIM.CIRCUITS);

  async function sendOne(run) { busy.add(run.board); redraw(); await send(run); busy.delete(run.board); redraw(); }
  function redraw() {
    if (!open) return;
    const all = Object.values(runs()).sort((a, b) => order.indexOf(a.circuit) - order.indexOf(b.circuit) || (a.aero === b.aero ? 0 : a.aero ? -1 : 1));
    list.replaceChildren();
    if (!all.length) list.append(el('p', 'note', 'No laps kept yet. Drive a clean time trial (a flying lap: lap 2 on) with the stock car on the automatic straight-mode zones: your best lap on each circuit is kept here to send.'));
    for (const run of all) {
      const row = el('div', 'dev-row lb-row'), info = el('div');
      info.append(el('b', '', `${SIM.CIRCUITS[run.circuit].name}`), el('span', 'note', `  active aero ${run.aero ? 'ON' : 'OFF'} · ${fmtTime(run.time)} · lap ${run.lap} · ${new Date(run.date).toLocaleDateString()}`));
      info.append(el('p', 'note' + (run.status === 'rejected' ? ' warn' : ''), statusText(run)));
      row.append(info);
      if (busy.has(run.board)) row.append(el('span', 'dev-state on', 'SENDING…'));
      else if (sendable(run) && online.signedIn) row.append(button('Submit', () => sendOne(run), 'btn small'));
      list.append(row);
    }
    const waiting = all.filter(r => sendable(r) && !busy.has(r.board));
    $('lbAll').hidden = !online.signedIn || waiting.length < 2;
    $('lbAll').onclick = async () => { for (const r of waiting) await sendOne(r); };
    $('lbHint').textContent = online.signedIn ? '' : 'Join above to send your laps.';
  }
  function close() { if (!open) return; open = false; clearInterval(poll); root.hidden = true; onClose?.(); }
  $('lbClose').onclick = close;
  $('lbSite').onclick = () => window.open(ONLINE.site, '_blank');
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  return {
    get open() { return open; },
    show(after) {
      onClose = after; open = true; root.hidden = false; redraw(); account.refresh(); $('lbClose').focus();
      // (joining or leaving in the panel above changes what can be sent)
      poll = setInterval(() => { account.tick(); if (online.signedIn !== wasIn) { wasIn = online.signedIn; redraw(); } }, 400);
    },
    close, redraw,
  };
}
