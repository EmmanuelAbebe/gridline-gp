// Straight-mode zone editor (2026-10-28, user: "override and adjust the automatic DRS system on the map"): the circuit
// big, its zones in green; drag a zone's ends along the track, click the track to place a new one, nudge or delete the
// selected one in the list, or go back to the automatic zones. Amber = where opening the wings isn't safe by the
// automatic rule (SIM zoneRisk: a bend not flat out with open wings, or braking close ahead). The zones are every
// car's, the AI's too, from the next race. ctx: { track() (the circuit in the menu), zones() (the saved list or null),
// change(list | null) (save + SIM setAeroZones) }.
import { SIM } from '../sim/index.js';
import { $ } from './util.js';

const Z = { pad: 34, grab: 14, pick: 18, minLength: 30, newLength: 250, nudge: 10 };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function button(label, onclick, cls = 'btn ghost small') { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; }
const km = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';

export function createZoneEditor({ track, zones, change }) {
  const root = $('zoneOv'), canvas = $('zoneMap'), list = $('zoneList'), g = canvas.getContext('2d');
  let T = null, L = 0, sx = null, sy = null, edit = [], sel = -1, marker = -1, drag = null, open = false, onClose = null;
  const len = z => ((z.to - z.from) % L + L) % L || L;
  const at = m => SIM.wrapIdx(Math.round(m / T.ds), T.N);

  function layout() {
    const { minX, maxX, minZ, maxZ } = T.bounds, W = canvas.width, H = canvas.height, P = Z.pad;
    const s = Math.min((W - 2 * P) / (maxX - minX), (H - 2 * P) / (maxZ - minZ));
    const ox = P + (W - 2 * P - (maxX - minX) * s) / 2, oz = P + (H - 2 * P - (maxZ - minZ) * s) / 2;
    sx = new Float32Array(T.N); sy = new Float32Array(T.N);
    for (let i = 0; i < T.N; i++) { sx[i] = ox + (T.PX[i] - minX) * s; sy[i] = oz + (T.PZ[i] - minZ) * s; }
  }
  // a stretch of track (sample from, n samples) as one path
  function stroke(from, n, colour, width, dash) {
    g.beginPath();
    for (let o = 0; o <= n; o++) { const k = SIM.wrapIdx(from + o, T.N); o ? g.lineTo(sx[k], sy[k]) : g.moveTo(sx[k], sy[k]); }
    g.strokeStyle = colour; g.lineWidth = width; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
  }
  const span = z => [at(z.from), Math.max(1, Math.round(len(z) / T.ds))];

  function draw() {
    const W = canvas.width, H = canvas.height, safe = SIM.aeroSafeOf(T);
    g.clearRect(0, 0, W, H); g.lineJoin = g.lineCap = 'round';
    stroke(0, T.N, 'rgba(255,255,255,.10)', 16);
    stroke(0, T.N, '#bfc3bd', 2.5);
    // the automatic zones, faint underneath, for reference
    for (const z of SIM.aeroZonesInMetres(T, true)) stroke(...span(z), 'rgba(79,224,143,.22)', 16);
    edit.forEach((z, k) => {
      const [from, n] = span(z), on = k === sel;
      stroke(from, n, on ? '#7dffb6' : '#36d27f', on ? 8 : 6);
      // amber over the samples where opening isn't safe
      for (let o = 0; o < n; o++) {
        const i = SIM.wrapIdx(from + o, T.N);
        if (!safe[i]) { let r = 1; while (o + r < n && !safe[SIM.wrapIdx(from + o + r, T.N)]) r++; stroke(i, r, '#ffc21a', on ? 8 : 6); o += r; }
      }
    });
    // the line and the direction of travel
    const a = Math.atan2(sy[6] - sy[0], sx[6] - sx[0]);
    g.save(); g.translate(sx[0], sy[0]); g.rotate(a);
    g.fillStyle = '#ffc21a'; g.fillRect(-2.5, -11, 5, 22);
    g.beginPath(); g.moveTo(22, 0); g.lineTo(12, -6); g.lineTo(12, 6); g.closePath(); g.fill(); g.restore();
    // handles: a ring at a zone's start, a block at its end
    edit.forEach((z, k) => {
      const s = at(z.from), e = SIM.wrapIdx(at(z.from) + Math.max(1, Math.round(len(z) / T.ds)), T.N), on = k === sel;
      g.lineWidth = 3; g.strokeStyle = on ? '#fff' : '#0c0e10'; g.fillStyle = on ? '#7dffb6' : '#36d27f';
      g.beginPath(); g.arc(sx[s], sy[s], on ? 8 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
      const b = on ? 7 : 5; g.fillRect(sx[e] - b, sy[e] - b, 2 * b, 2 * b); g.strokeRect(sx[e] - b, sy[e] - b, 2 * b, 2 * b);
      g.fillStyle = '#0c0e10'; g.font = '700 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (on || edit.length < 8) { g.fillStyle = on ? '#fff' : '#d8dcd6'; g.fillText(String(k + 1), sx[s] + 14, sy[s] - 12); }
    });
    if (marker >= 0) {
      g.strokeStyle = '#ffc21a'; g.lineWidth = 3; g.beginPath();
      g.moveTo(sx[marker] - 9, sy[marker]); g.lineTo(sx[marker] + 9, sy[marker]); g.moveTo(sx[marker], sy[marker] - 9); g.lineTo(sx[marker], sy[marker] + 9); g.stroke();
    }
  }

  function drawList() {
    list.replaceChildren();
    $('zoneMode').textContent = zones() ? 'YOUR ZONES' : 'AUTOMATIC';
    $('zoneMode').classList.toggle('on', !!zones());
    if (!edit.length) list.append(el('p', 'note', 'No zones: nobody can open the wings on this circuit. Click the track to place one.'));
    edit.forEach((z, k) => {
      const row = el('div', 'dev-row zone-row' + (k === sel ? ' active' : '')), info = el('div'), risk = SIM.zoneRisk(T, z);
      info.append(el('b', '', `Zone ${k + 1}`), el('span', 'note', `  ${km(z.from)} → ${km(z.to % L)} · ${Math.round(len(z))} m`));
      if (risk > 0.02) info.append(el('p', 'note warn', `${Math.round(risk * 100)} % of it in a bend or before braking (amber)`));
      row.onclick = e => { if (!(e.target instanceof HTMLButtonElement)) { sel = k; marker = -1; refresh(); } };
      row.append(info);
      if (k === sel) {
        const tools = el('div', 'zone-tools');
        const nudge = (end, d) => button(`${end === 'from' ? 'Start' : 'End'} ${d < 0 ? '−' : '+'}${Z.nudge}`, () => move(k, end, z[end] + d));
        tools.append(nudge('from', -Z.nudge), nudge('from', Z.nudge), nudge('to', -Z.nudge), nudge('to', Z.nudge),
          button('Delete', () => { edit.splice(k, 1); sel = -1; commit(); }));
        row.append(tools);
      }
      list.append(row);
    });
    $('zoneAdd').disabled = marker < 0;
    $('zoneReset').disabled = !zones();
  }
  const refresh = () => { draw(); drawList(); };

  // a zone end moved to m metres (kept at least minLength long and short of a whole lap)
  function move(k, end, m) {
    const z = { ...edit[k], [end]: ((m % L) + L) % L };
    if (end === 'to' && Math.abs(z.to) < 1e-6) z.to = L;
    if (len(z) < Z.minLength || len(z) > L - Z.minLength) return false;
    edit[k] = z; return true;
  }
  // save: the sim merges overlaps; read back what it made
  function commit() {
    change(edit.map(z => ({ from: z.from, to: z.to })));
    edit = SIM.aeroZonesInMetres(T);
    if (sel >= edit.length) sel = edit.length - 1;
    refresh();
  }
  function load() { edit = SIM.aeroZonesInMetres(T); sel = -1; marker = -1; }

  const point = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  function nearest(x, y) {
    let best = -1, d = Infinity;
    for (let i = 0; i < T.N; i++) { const q = (sx[i] - x) ** 2 + (sy[i] - y) ** 2; if (q < d) { d = q; best = i; } }
    return [best, Math.sqrt(d)];
  }
  canvas.addEventListener('pointerdown', e => {
    if (!T) return;
    const [x, y] = point(e), handles = [];
    edit.forEach((z, k) => {
      const s = at(z.from), t = SIM.wrapIdx(s + Math.max(1, Math.round(len(z) / T.ds)), T.N);
      handles.push([k, 'from', Math.hypot(sx[s] - x, sy[s] - y)], [k, 'to', Math.hypot(sx[t] - x, sy[t] - y)]);
    });
    handles.sort((a, b) => (a[0] === sel ? -1 : 0) - (b[0] === sel ? -1 : 0) || a[2] - b[2]);
    const h = handles.find(q => q[2] <= Z.grab);
    if (h) { drag = { k: h[0], end: h[1] }; sel = h[0]; marker = -1; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* (a synthetic event: smoke test) */ } refresh(); return; }
    const [i, d] = nearest(x, y);
    if (d > Z.pick) { sel = -1; marker = -1; refresh(); return; }
    const k = edit.findIndex(z => { const [from, n] = span(z); return SIM.wrapIdx(i - from, T.N) < n; });
    sel = k; marker = k < 0 ? i : -1;
    refresh();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const [x, y] = point(e), [i] = nearest(x, y);
    if (move(drag.k, drag.end, i * T.ds)) draw();
  });
  const drop = () => { if (drag) { drag = null; commit(); } };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);

  $('zoneAdd').onclick = () => {
    if (marker < 0) return;
    const from = marker * T.ds;
    edit.push({ from, to: (from + Z.newLength) % L || L }); marker = -1;
    commit();
    sel = edit.findIndex(z => SIM.wrapIdx(Math.round((from - z.from) / T.ds), T.N) < Math.round(len(z) / T.ds)); refresh();   // (the zone it is in after merging)
  };
  $('zoneReset').onclick = () => { change(null); load(); refresh(); };
  $('zoneClose').onclick = () => close();
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  function close() { if (!open) return; open = false; drag = null; root.hidden = true; onClose?.(); }

  return {
    get open() { return open; },
    show(after) {
      T = track(); L = T.N * T.ds; onClose = after; open = true;
      $('zoneTitle').textContent = `Straight-mode zones · ${T.name}`;
      layout(); load(); root.hidden = false; refresh(); $('zoneClose').focus();
    },
    close,
    // where the track at m metres is on the screen (client px): for the smoke test's drag
    pointAt(m) { const i = at(m), r = canvas.getBoundingClientRect(); return [r.left + sx[i] * r.width / canvas.width, r.top + sy[i] * r.height / canvas.height]; },
    get zones() { return edit.map(z => ({ ...z })); },
  };
}
