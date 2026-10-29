// The leaderboard website: a board per circuit and active-aero setting (GET /api/board), and a viewer that drives a
// lap's ghost round the circuit map (GET /api/ghost?plain=1: the pose 20 times a second, as the game records it).
const $ = id => document.getElementById(id);
const fmt = t => { if (!(t > 0)) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ASSISTS = { off: 'OFF', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', custom: 'CUSTOM' };

let tracks = null, circuit = null, aero = 'on', rows = [], view = null;

// ---- the board ----
function readHash() {
  const [c, a] = location.hash.slice(1).split('/');
  if (tracks.circuits[c]) circuit = c;
  if (a === 'on' || a === 'off') aero = a;
}
function drawTabs() {
  $('circuits').replaceChildren(...Object.entries(tracks.circuits).map(([id, t]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t.name; b.setAttribute('aria-pressed', String(id === circuit));
    b.onclick = () => { circuit = id; go(); }; return b;
  }));
  for (const b of document.querySelectorAll('[data-aero]')) b.setAttribute('aria-pressed', String(b.dataset.aero === aero));
}
async function go() {
  history.replaceState(null, '', `#${circuit}/${aero}`);
  drawTabs(); closeViewer();
  const t = tracks.circuits[circuit];
  $('meta').textContent = `${(t.length / 1000).toFixed(2)} km · physics ${tracks.physics}`;
  $('rows').innerHTML = '<tr><td colspan="12" class="empty">Loading…</td></tr>';
  try {
    const r = await fetch(`/api/board?circuit=${circuit}&aero=${aero}`), d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    rows = d.rows; drawRows();
  } catch (e) { $('rows').innerHTML = `<tr><td colspan="12" class="empty">Couldn't load the board (${esc(e.message)}).</td></tr>`; }
}
function drawRows() {
  if (!rows.length) { $('rows').innerHTML = '<tr><td colspan="12" class="empty">No laps yet. Drive a clean time trial in the game and submit it.</td></tr>'; return; }
  const bestSec = [0, 1, 2].map(k => Math.min(...rows.map(r => r.sectors?.[k] ?? Infinity)));
  $('rows').innerHTML = rows.map(r => {
    const s = r.settings || {}, sec = k => `<td class="r num${r.sectors?.[k] === bestSec[k] ? ' best' : ''}">${r.sectors?.[k]?.toFixed(3) ?? '–'}</td>`;
    return `<tr data-id="${esc(r.id)}" tabindex="0"><td class="r num">${r.rank}</td><td class="name">${esc(r.name || '?')}</td>
      <td class="r num${r.rank === 1 ? ' best' : ''}">${fmt(r.time)}</td><td class="r num">${r.rank === 1 ? '' : '+' + r.gap.toFixed(3)}</td>
      ${sec(0)}${sec(1)}${sec(2)}
      <td><span class="chip${s.assists === 'off' ? ' off' : ''}">${ASSISTS[s.assists] || '?'}</span></td><td>${esc(s.gearbox || '')}</td>
      <td><span class="cmp ${esc(s.tyres || '')}" title="${esc(s.tyres || '')}">${esc((s.tyres || '?')[0].toUpperCase())}</span>${s.tyreTemp ? '' : ' <span class="chip">no temps</span>'}</td>
      <td>${esc(s.controller || '')}</td><td>${r.date ? new Date(r.date).toLocaleDateString() : ''}</td></tr>`;
  }).join('');
  for (const tr of $('rows').querySelectorAll('tr[data-id]')) {
    const open = () => openViewer(rows.find(r => r.id === tr.dataset.id));
    tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  }
}

// ---- the viewer ----
function fit(t, W, H, pad = 24) {
  const P = t.points; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); z0 = Math.min(z0, P[i + 1]); z1 = Math.max(z1, P[i + 1]); }
  const s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0)), ox = (W - (x1 - x0) * s) / 2, oz = (H - (z1 - z0) * s) / 2;
  return (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
}
async function openViewer(row) {
  if (!row) return;
  for (const tr of $('rows').querySelectorAll('tr')) tr.classList.toggle('on', tr.dataset.id === row.id);
  $('viewer').hidden = false; $('vname').textContent = `${row.rank}. ${row.name} · ${fmt(row.time)}`;
  let g;
  try { const r = await fetch(`/api/ghost?circuit=${circuit}&aero=${aero}&id=${row.id}&plain=1`); g = await r.json(); if (!r.ok) throw new Error(g.error); }
  catch (e) { $('vname').textContent = `Couldn't load that lap (${e.message})`; return; }
  const t = tracks.circuits[circuit], n = g.frames.length / 3;
  // the sector ends in lap time (from the board's sector times)
  const ends = []; (row.sectors || []).reduce((a, s) => { ends.push(a + s); return a + s; }, 0);
  view = { row, g, t, n, ends, at: 0, rate: 1, playing: true, last: performance.now() };
  $('play').textContent = 'Pause'; $('rate').textContent = '1×';
  $('viewer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  requestAnimationFrame(tick);
}
function closeViewer() { view = null; $('viewer').hidden = true; for (const tr of $('rows').querySelectorAll('tr')) tr.classList.remove('on'); }
function poseAt(g, t) {
  const n = g.frames.length / 3, f = Math.min(n - 1.001, Math.max(0, t * g.hz)), i = Math.floor(f), u = f - i, F = g.frames;
  return [F[i * 3] + (F[i * 3 + 3] - F[i * 3]) * u, F[i * 3 + 1] + (F[i * 3 + 4] - F[i * 3 + 1]) * u, i];
}
function tick(now) {
  if (!view) return;
  const V = view, dt = Math.min(0.1, (now - V.last) / 1000); V.last = now;
  if (V.playing) { V.at += dt * V.rate; if (V.at > V.g.time) V.at = 0; }
  draw(V);
  requestAnimationFrame(tick);
}
function draw(V) {
  const c = $('map'), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = Math.round(W * 520 / 900);
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const at = fit(V.t, W, H), P = V.t.points;
  g.lineJoin = g.lineCap = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i < P.length; i += 2) { const [x, y] = at(P[i], P[i + 1]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  path(); g.strokeStyle = css('--track-glow'); g.lineWidth = 14; g.stroke();
  path(); g.strokeStyle = css('--track'); g.lineWidth = 2.5; g.stroke();
  // the line and the sector starts
  for (const k of V.t.sectors) { const [x, y] = at(P[k * 2], P[k * 2 + 1]); g.fillStyle = css('--mute'); g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
  const [sx, sy] = at(P[0], P[1]); g.fillStyle = css('--accent'); g.fillRect(sx - 3, sy - 9, 6, 18);
  // the car: its last 2 s as a fading trail, then the dot
  const [x, z, i] = poseAt(V.g, V.at), from = Math.max(0, i - 2 * V.g.hz);
  for (let k = from; k < i; k++) {
    const [a, b] = at(V.g.frames[k * 3], V.g.frames[k * 3 + 1]), [c2, d] = at(V.g.frames[k * 3 + 3], V.g.frames[k * 3 + 4]);
    g.strokeStyle = `rgba(255,194,26,${(k - from) / (i - from + 1)})`; g.lineWidth = 4; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke();
  }
  const [cx, cy] = at(x, z); g.fillStyle = css('--accent'); g.strokeStyle = css('--bg'); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill(); g.stroke();
  // speed from the pose: distance between frames × frames a second
  const F = V.g.frames, j = Math.min(V.n - 2, i), kmh = Math.hypot(F[j * 3 + 3] - F[j * 3], F[j * 3 + 4] - F[j * 3 + 1]) * V.g.hz * 3.6;
  $('vtime').textContent = fmt(V.at); $('vspeed').textContent = Math.round(kmh);
  $('scrub').value = String(Math.round(V.at / V.g.time * 1000));
  $('vsec').innerHTML = (V.row.sectors || []).map((s, k) => `<div class="${V.at >= V.ends[k] ? 'done' : ''}"><span class="lbl">S${k + 1}</span><br><b class="num">${V.at >= V.ends[k] ? s.toFixed(3) : '–'}</b></div>`).join('');
}
$('play').onclick = () => { if (!view) return; view.playing = !view.playing; $('play').textContent = view.playing ? 'Pause' : 'Play'; };
$('rate').onclick = () => { if (!view) return; view.rate = view.rate >= 4 ? 1 : view.rate * 2; $('rate').textContent = view.rate + '×'; };
$('vclose').onclick = closeViewer;
$('scrub').oninput = e => { if (view) view.at = +e.target.value / 1000 * view.g.time; };
for (const b of document.querySelectorAll('[data-aero]')) b.onclick = () => { aero = b.dataset.aero; go(); };
window.addEventListener('hashchange', () => { readHash(); go(); });

tracks = await (await fetch('/tracks.json')).json();
circuit = Object.keys(tracks.circuits)[0];
readHash(); go();
