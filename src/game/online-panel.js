// Settings → Tools: the online leaderboard (online.js). Join with a display name (the game keeps a secret key: no
// email, no password), send your laps by themselves or not, open the website, leave. Built by the settings screen
// through its `panel` item; bind.get('online') = the client.
import { ONLINE } from './online.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function button(label, onclick, cls = 'btn ghost small') { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; }

export function createOnlinePanel(bind) {
  const online = bind.get('online'), root = el('div', 'dev-panel'), card = el('div', 'dev-card');
  root.append(card);
  let note = '', status = null, asked = false, shownIn = online.signedIn;
  async function ask() { asked = true; status = await online.status(); draw(); }

  function draw() {
    const A = online.account;
    shownIn = online.signedIn;
    card.replaceChildren();
    const head = el('div', 'row');
    head.append(el('span', 'lbl', 'Online leaderboard'),
      el('span', 'dev-state' + (online.signedIn && status?.same ? ' on' : ''), !status ? (asked ? 'OFFLINE' : '…') : !status.same ? 'OTHER VERSION' : online.signedIn ? A.name.toUpperCase() : 'NOT JOINED'));
    card.append(head);
    card.append(el('p', 'note', 'Your best time-trial laps on the stock car (your race setup is fine) and the automatic straight-mode zones go on a board per circuit, top 100. The server drives each lap again from your inputs to check it. Race the fastest lap on any board with the ONLINE ghost in a time trial.'));
    if (status && !status.same) card.append(el('p', 'note warn', 'The leaderboard runs another version of the physics than this game: update the game to send laps.'));
    if (!online.signedIn) {
      const row = el('div', 'btns'), input = el('input', 'ol-name');
      input.type = 'text'; input.maxLength = 16; input.placeholder = 'Your name on the board'; input.setAttribute('aria-label', 'Your name on the leaderboard');
      const join = button('Join', async () => {
        join.disabled = true; note = '';
        try { await online.register(input.value.trim()); note = 'Joined. Your laps will go to the leaderboard.'; }
        catch (e) { note = e.message; }
        draw();
      }, 'btn small');
      input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') join.click(); });
      row.append(input, join);
      card.append(row, el('p', 'note', 'Names are public: 3–16 letters or digits. Only the name, your laps and their settings are kept; leaving deletes the key on this computer (ask to have your laps removed).'));
    } else {
      const row = el('div', 'row');
      row.append(el('span', '', 'Send my laps by themselves'));
      const seg = el('div', 'seg');
      for (const [v, label] of [[true, 'ON'], [false, 'OFF']]) {
        const b = button(label, () => { online.setAuto(v); draw(); }, '');
        b.setAttribute('aria-pressed', String(A.auto === v)); seg.append(b);
      }
      row.append(seg); card.append(row);
    }
    if (note) card.append(el('p', 'note', note));
    const btns = el('div', 'btns');
    btns.append(button('Open the leaderboard', () => window.open(ONLINE.site, '_blank')));
    if (online.signedIn) btns.append(button('Leave (forget my key)', () => { online.signOut(); note = 'Left. Your laps stay on the boards until they are pushed out.'; draw(); }));
    card.append(btns);
  }
  draw(); ask();
  // tick: redrawn when you joined or left somewhere else; refresh: ask the server again (a screen opened)
  return { el: root, tick() { if (online.signedIn !== shownIn) draw(); }, refresh: ask };
}
