// Practice analysis (2026-11-12; user: "include analysis for the practice section similar to the lap analysis", then of
// the canvas mock-ups E, F, G: "implement all of them having 3 different views"). The practice summary's tabs:
// COMPARE (E) = one drive against another over the section, replayed: the map with both lines (gained / lost, a speed
// trace that colours each car's path as it goes, or the whole drive by speed), the delta, the parts, the car's state now,
// speed / pedals / steering under it; TELEMETRY (F) = tick drives to overlay, pick channels (telemetry.js); CORNER (G) = one
// corner, every run: the lines, where each braked, the traces, run by run. A drive = a run this session, your best saved
// before, the ALIEN's or LEGEND's lap over the run's window (practice-core.js series).
import { SIM } from '../sim/index.js';
import { $ } from './util.js';
import { cornerMetrics } from './lap-analysis.js';
import { strokeBySpeed } from './speed-colour.js';
import * as P from './practice-core.js';

const U = 2;                                     // canvas pixels per CSS pixel
const ME = '#ffc21a', REF = '#4fd1ff', LEGEND = '#c9a0ff', BEFORE = '#ff9f43', FIRST = '#e9ebe6', GREYS = ['#9aa3ad', '#6f7883', '#b5bcc4', '#5b6573'];
const s3 = t => Number.isFinite(t) ? t.toFixed(3) : '–';
const gapText = d => !Number.isFinite(d) ? '–' : (d > 0.0005 ? '+' : d < -0.0005 ? '−' : '±') + Math.abs(d).toFixed(3);
const gapCls = d => !Number.isFinite(d) ? '' : d < -0.0005 ? 'faster' : d > 0.0005 ? 'slower' : '';
const r0 = v => Number.isFinite(v) ? String(Math.round(v)) : '–';
const r1 = v => Number.isFinite(v) ? v.toFixed(1) : '–';
const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== '') e.textContent = text; return e; };
const mean = (...v) => { const f = v.filter(Number.isFinite); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN; };
// the telemetry view's channels: [id, chip, values of a drive at window sample w … (one or two lines), unit]
const tel = (S, id) => S.tel?.[id] ?? null;
const CHANS = [
  ['speed', 'SPEED', S => [S.kmh], 'km/h'],
  ['pedals', 'GAS / BRAKE', S => [S.thr, S.brk], ''],
  ['steer', 'STEERING', S => [tel(S, 'wheel')], '°'],
  ['rpm', 'GEAR · RPM', S => [tel(S, 'rpm')], 'rpm'],
  ['g', 'G-FORCE', S => [tel(S, 'glat'), tel(S, 'glong')], 'g'],
  ['df', 'DOWNFORCE', S => [tel(S, 'df')], 'kN'],
  ['tyres', 'TYRES °C', S => [avgOf(S, ['tFL', 'tFR']), avgOf(S, ['tRL', 'tRR'])], '°C'],
  ['soc', 'BATTERY', S => [tel(S, 'soc')], 'MJ'],
  ['slides', 'SLIDES', S => [tel(S, 'slideF'), tel(S, 'slideR')], '%'],
];
const avgCache = new WeakMap();
function avgOf(S, ids) {
  if (!S.tel) return null;
  const key = ids.join(), m = avgCache.get(S) ?? new Map(); avgCache.set(S, m);
  if (!m.has(key)) { const W = S.t.length, a = new Float32Array(W); for (let w = 0; w < W; w++) a[w] = mean(...ids.map(id => S.tel[id][w])); m.set(key, a); }
  return m.get(key);
}

export function createPracticeAnalysis({ getR }) {
  let R = null, D = null, view = 'runs', lineMode = 'trace', me = null, ref = null, T = 0, playing = false, rate = 1, last = 0;
  let shown = new Set(), chans = ['speed', 'pedals', 'steer', 'g'], cursor = 0, corner = -1;

  // ---- the drives: built once per summary ----
  function build() {
    R = getR(); if (!R) return (D = null);
    const { T: track, sec, lead, len } = R, N = track.N, W = lead + len + 1, S = P.sessionStats(R.runs);
    const list = [];
    R.runs.forEach((r, k) => {
      if (!r.run) return;
      list.push({ id: 'run' + k, name: `Run ${k + 1}`, time: r.time, off: r.off, parts: r.parts, S: P.seriesOfRun(r.run), tr: () => P.runAsTrace(r.run, sec, N),
        col: k === S.bestIndex ? ME : k === 0 ? FIRST : GREYS[k % GREYS.length], best: k === S.bestIndex, first: k === 0, run: true });
    });
    const sv = R.saved?.run && !R.runs.some(r => Number.isFinite(r.time) && Math.abs(r.time - R.saved.time) < 1e-4) ? R.saved : null;
    if (sv) list.push({ id: 'saved', name: 'Best before', time: sv.time, parts: sv.parts, S: P.seriesOfRun(sv.run), tr: () => P.runAsTrace(sv.run, sec, N), col: BEFORE });
    for (const [id, name, trace, col] of [['alien', 'ALIEN', R.alien, REF], ['legend', 'LEGEND', R.legend, LEGEND]]) {
      if (!trace) continue;
      const lp = P.lapParts(trace, sec, R.parts, N);
      list.push({ id, name, time: lp.time, parts: lp.parts, S: P.traceWindow(trace, sec, lead, len, N), tr: () => trace, col, ai: true });
    }
    D = { list, N, W, lead, len, w0: Math.max(0, lead - 60), ds: track.ds, track, sec, L: R.L, parts: R.parts, metrics: new Map() };
    D.speed = (() => { let lo = Infinity, hi = -Infinity;
      for (const d of list) for (let w = D.w0; w < W; w++) { const v = d.S.kmh[w]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      return Number.isFinite(lo) ? { lo: Math.floor(lo / 10) * 10, hi: Math.ceil(hi / 10) * 10 } : { lo: 0, hi: 350 }; })();
    const best = list.find(d => d.best) ?? list.find(d => d.run && Number.isFinite(d.time)) ?? list.find(d => d.run) ?? list[0] ?? null;
    me = best; ref = list.find(d => d.id === 'alien') ?? list.find(d => d.ai) ?? list.find(d => d !== best) ?? best;
    shown = new Set([best?.id, list.find(d => d.first)?.id, ref?.id].filter(Boolean));
    T = me ? Math.max(startT(me), 0) : 0; cursor = lead + Math.round(len * 0.3);
    // the corner where your best run loses most to the AI, else the first in the section
    const cs = P.cornersIn(R.L, sec), ai = list.find(d => d.ai);
    corner = cs[0] ?? -1;
    if (best && ai) { let worst = -Infinity; R.parts.forEach((p, j) => { const g = best.parts[j] - ai.parts[j]; if (p.corner >= 0 && Number.isFinite(g) && g > worst) { worst = g; corner = p.corner; } }); }
    return D;
  }
  const metricsOf = d => { if (!D.metrics.has(d.id)) D.metrics.set(d.id, cornerMetrics(d.tr(), D.L, D.ds)); return D.metrics.get(d.id); };
  const startT = d => { const t = d.S.t; for (let w = D.w0; w < D.W; w++) if (Number.isFinite(t[w])) return t[w]; return 0; };
  const endT = d => { const t = d.S.t; for (let w = D.W - 1; w >= 0; w--) if (Number.isFinite(t[w])) return t[w]; return 0; };
  const label = d => `${d.name} · ${Number.isFinite(d.time) ? s3(d.time) : d.off ? 'off at ' + d.off : '—'}${d.best ? ' · best' : ''}`;

  // ---- canvases ----
  function sized(cv) {
    const w = Math.max(1, Math.round(cv.clientWidth * U)), h = Math.max(1, Math.round(cv.clientHeight * U));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h); g.lineJoin = g.lineCap = 'round';
    return g;
  }
  // a view fitting track samples i ∈ idx (and a margin) into the canvas: { k px per m, X, Y }
  function fitView(cv, idx, margin = 24) {
    const { PX, PZ, HW } = D.track; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of idx) { x0 = Math.min(x0, PX[i]); x1 = Math.max(x1, PX[i]); z0 = Math.min(z0, PZ[i]); z1 = Math.max(z1, PZ[i]); }
    const m = margin * U, k = Math.min((cv.width - 2 * m) / Math.max(1, x1 - x0 + 2 * HW), (cv.height - 2 * m) / Math.max(1, z1 - z0 + 2 * HW));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { k, X: x => (x - cx) * k + cv.width / 2, Y: z => (z - cz) * k + cv.height / 2 };
  }
  const trackIdx = (w0, w1) => { const out = []; for (let w = w0; w <= w1; w++) out.push(SIM.wrapIdx(D.sec.from - D.lead + w, D.N)); return out; };
  function drawRoad(g, V, idx) {
    const { PX, PZ, NX, NZ, HW } = D.track;
    const path = off => { g.beginPath(); idx.forEach((i, j) => { const x = V.X(PX[i] + NX[i] * off), y = V.Y(PZ[i] + NZ[i] * off); j ? g.lineTo(x, y) : g.moveTo(x, y); }); };
    path(0); g.strokeStyle = '#262d36'; g.lineWidth = 2 * HW * V.k; g.stroke();
    g.strokeStyle = '#5b6573'; g.lineWidth = U; path(HW); g.stroke(); path(-HW); g.stroke();
  }
  const ptOf = (S, V) => w => Number.isFinite(S.x[w]) && Number.isFinite(S.z[w]) ? [V.X(S.x[w]), V.Y(S.z[w])] : null;
  function plain(g, S, V, w0, w1, col, width, dash = false) {
    const pt = ptOf(S, V); g.strokeStyle = col; g.lineWidth = width; g.setLineDash(dash ? [6 * U, 4 * U] : []);
    g.beginPath(); let on = false;
    for (let w = w0; w <= w1; w++) { const p = pt(w); if (!p) { on = false; continue; } on ? g.lineTo(...p) : g.moveTo(...p); on = true; }
    g.stroke(); g.setLineDash([]);
  }
  function bySpeed(g, S, V, w0, w1, width, dash = false) {
    g.lineWidth = width; g.setLineDash(dash ? [6 * U, 4 * U] : []);
    strokeBySpeed(g, ptOf(S, V), w0, w1, w => S.kmh[w], D.speed.lo, D.speed.hi);
  }
  function dot(g, x, y, col, r = 8) { g.beginPath(); g.arc(x, y, r * U, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 3 * U; g.strokeStyle = '#0b0e12'; g.stroke(); }
  function badges(g, V, ks) {
    const { PX, PZ, NX, NZ } = D.track;
    g.font = `700 ${13 * U}px "Saira Condensed", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const k of ks) { const c = D.L.corners[k], i = c.apex, side = (D.track.K[i] > 0 ? -1 : 1) * 30 / V.k * U, x = V.X(PX[i] + NX[i] * side), y = V.Y(PZ[i] + NZ[i] * side);
      g.fillStyle = 'rgba(10,13,17,.9)'; g.beginPath(); g.arc(x, y, 12 * U, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e9ebe6'; g.fillText(c.name, x, y + U); }
  }
  function ringSquare(g, V) {
    const { PX, PZ } = D.track, a = D.sec.from, b = SIM.wrapIdx(D.sec.to, D.N);
    g.strokeStyle = '#f2f3f0'; g.lineWidth = 3 * U; g.beginPath(); g.arc(V.X(PX[a]), V.Y(PZ[a]), 9 * U, 0, Math.PI * 2); g.stroke();
    g.strokeRect(V.X(PX[b]) - 8 * U, V.Y(PZ[b]) - 8 * U, 16 * U, 16 * U);
  }
  // where a drive braked for corner k: the window sample brakeAt metres before the apex (null when it didn't)
  function brakeW(d, k) {
    const m = metricsOf(d)[k]; if (!m || m.brakeAt === null) return null;
    return P.windowOf(D.sec, D.lead, D.len, SIM.wrapIdx(D.L.corners[k].apex - Math.round(m.brakeAt / D.ds), D.N), D.N);
  }
  // Charts over the window (x = window sample w0..w1): rows [{ label, unit, lines: [{ vals, col, width, dash }], lo?, hi? }]
  function chart(cv, rows, w0, w1, cur, { parts = true } = {}) {
    const g = sized(cv), W = cv.width, H = cv.height, x0 = 96 * U, xw = W - x0 - 10 * U, gap = 6 * U, rh = (H - 18 * U - gap * (rows.length - 1)) / rows.length;
    const X = w => x0 + xw * (w - w0) / Math.max(1, w1 - w0);
    rows.forEach((row, j) => {
      const y = j * (rh + gap), vals = row.lines.flatMap(l => l.vals ? Array.from(l.vals.subarray(w0, w1 + 1)).filter(Number.isFinite) : []);
      let lo = row.lo ?? Math.min(...vals), hi = row.hi ?? Math.max(...vals);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
      if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
      g.fillStyle = '#12161c'; g.fillRect(x0, y, xw, rh);
      g.font = `600 ${12 * U}px "Saira Condensed", Arial, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#959ca5';
      g.fillText(row.label, 8 * U, y + 4 * U);
      g.font = `500 ${11 * U}px "Saira Condensed", Arial, sans-serif`; g.fillStyle = '#6f7883';
      if (!vals.length) g.fillText('not recorded', 8 * U, y + 20 * U);
      else if (rh > 52 * U) { g.fillText(`${fmt(hi)}${row.unit ? ' ' + row.unit : ''}`, 8 * U, y + 20 * U); g.textBaseline = 'bottom'; g.fillText(fmt(lo), 8 * U, y + rh - 2 * U); }   // (short rows: the name only)
      for (const l of row.lines) {
        if (!l.vals) continue;
        g.strokeStyle = l.col; g.lineWidth = (l.width ?? 1.5) * U; g.setLineDash(l.dash ? [5 * U, 4 * U] : []); g.beginPath(); let on = false;
        for (let w = w0; w <= w1; w++) { const v = l.vals[w]; if (!Number.isFinite(v)) { on = false; continue; } const p = [X(w), y + rh - 3 * U - (rh - 6 * U) * (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)]; on ? g.lineTo(...p) : g.moveTo(...p); on = true; }
        g.stroke(); g.setLineDash([]);
      }
    });
    const bottom = rows.length * (rh + gap) - gap;
    g.font = `500 ${11 * U}px "Saira Condensed", Arial, sans-serif`; g.textBaseline = 'top'; g.fillStyle = '#959ca5';
    if (parts) {
      const marks = [[D.lead, '']].concat(D.parts.map(p => [D.lead + p.a, p.name]));
      for (const [w, name] of marks) { if (w < w0 || w > w1) continue; g.strokeStyle = '#2a313b'; g.lineWidth = U; g.setLineDash([3 * U, 3 * U]);
        g.beginPath(); g.moveTo(X(w), 0); g.lineTo(X(w), bottom); g.stroke(); g.setLineDash([]); if (name) g.fillText(name, X(w) + 4 * U, bottom + 3 * U); }
      if (w0 < D.lead) g.fillText('LEAD-IN', x0 + 2 * U, bottom + 3 * U);
    }
    if (cur !== null && cur >= w0 && cur <= w1) { g.strokeStyle = ME; g.lineWidth = 2 * U; g.beginPath(); g.moveTo(X(cur), 0); g.lineTo(X(cur), bottom); g.stroke(); }
    return { wAt: px => w0 + (px * U - x0) / xw * (w1 - w0) };
  }
  const fmt = v => Math.abs(v) >= 100 ? String(Math.round(v)) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
  // a click on a chart → the window sample there
  function onChart(cv, layout, fn) { cv.onpointerdown = e => { const r = cv.getBoundingClientRect(), L = layout(); if (!L) return; fn(Math.round(L.wAt((e.clientX - r.left) * cv.clientWidth / r.width))); }; }

  // ---- COMPARE ----
  let cmpLayout = null;
  function fillPickers() {
    const opts = sel => { sel.replaceChildren(...D.list.map(d => { const o = el('option', '', label(d)); o.value = d.id; return o; })); };
    opts($('paMe')); opts($('paRef'));
    $('paMe').value = me?.id ?? ''; $('paRef').value = ref?.id ?? '';
  }
  $('paMe').onchange = () => { me = D.list.find(d => d.id === $('paMe').value) ?? me; T = Math.max(startT(me), Math.min(T, endT(me))); render(); };
  $('paRef').onchange = () => { ref = D.list.find(d => d.id === $('paRef').value) ?? ref; render(); };
  for (const b of $('paLine').children) b.onclick = () => { lineMode = b.dataset.l; render(); };
  for (const b of $('paRate').children) b.onclick = () => { rate = Number(b.dataset.r); for (const x of $('paRate').children) x.setAttribute('aria-pressed', String(x === b)); };
  $('paPlay').onclick = () => { if (!me) return; if (!playing && T >= endT(me) - 1e-3) T = startT(me); playing = !playing; last = performance.now(); if (playing) requestAnimationFrame(tick); render(); };
  $('paPos').oninput = () => { if (!me) return; const a = startT(me), b = endT(me); T = a + (b - a) * Number($('paPos').value) / 1000; render(); };
  onChart($('paCmpChart'), () => cmpLayout, w => { const t = me?.S.t[Math.max(D.w0, Math.min(D.W - 1, w))]; if (Number.isFinite(t)) { T = t; render(); } });
  function tick(now) {
    if (!playing || view !== 'compare' || !D) { playing = false; return; }
    T += Math.min(0.1, (now - last) / 1000) * rate; last = now;
    if (T >= endT(me)) { T = endT(me); playing = false; }
    render(); if (playing) requestAnimationFrame(tick);
  }
  function renderCompare() {
    for (const b of $('paLine').children) b.setAttribute('aria-pressed', String(b.dataset.l === lineMode));
    $('paPlayIcon').setAttribute('d', playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4l13 8-13 8z');
    const a = startT(me), b = endT(me); $('paPos').value = String(Math.round((T - a) / ((b - a) || 1) * 1000));
    $('paClock').textContent = `${T < 0 ? '−' : ''}${Math.abs(T).toFixed(3)} / ${s3(endT(me))}`;
    const pm = P.seriesAt(me.S, T), pr = P.seriesAt(ref.S, T);
    const s = pm ? pm.s : D.lead, delta = P.seriesValue(me.S.t, s) - P.seriesValue(ref.S.t, s);
    $('paDelta').textContent = gapText(delta); $('paDelta').className = gapCls(delta);
    const m = pm && pr ? Math.round((pr.s - pm.s) * D.ds) : NaN;
    $('paGap').textContent = !Number.isFinite(m) ? '' : Math.abs(m) < 2 ? 'Side by side' : `${shortOf(ref)} ${Math.abs(m)} m ${m > 0 ? 'ahead' : 'behind'}`;
    // the parts
    const ph = [el('span', 'h', 'PART'), el('span', 'h me', 'YOU'), el('span', 'h ref', shortOf(ref)), el('span', 'h', 'GAP')];
    $('paParts').replaceChildren(...ph, ...D.parts.flatMap((p, j) => { const x = me.parts?.[j], y = ref.parts?.[j], d = x - y;
      return [el('span', '', p.name), el('span', '', s3(x)), el('span', '', s3(y)), el('span', gapCls(d), gapText(d))]; }));
    // the car now (yours where it is; the other at the same spot)
    const at = s - D.lead, part = D.parts.find(p => at >= p.a && at < p.b), now = at < 0 ? 'LEAD-IN' : part ? part.name : 'AFTER';
    const v = (S, f) => f(S, s), tl = id => (S, w) => P.seriesValue(S.tel?.[id], w);
    const rows = [['km/h · gear', (S, w) => `${r0(P.seriesValue(S.kmh, w))} · ${r0(S.gear[Math.round(w)])}`],
      ['Steering (wheel °)', (S, w) => r1(tl('wheel')(S, w))], ['Lateral g', (S, w) => r1(tl('glat')(S, w))], ['Downforce kN', (S, w) => r1(tl('df')(S, w))],
      ['Tyres °C (front / rear)', (S, w) => `${r0(mean(tl('tFL')(S, w), tl('tFR')(S, w)))} / ${r0(mean(tl('tRL')(S, w), tl('tRR')(S, w)))}`]];
    $('paNow').replaceChildren(el('span', 't', `NOW · ${now}`), el('span', 'h me', 'YOU'), el('span', 'h ref', shortOf(ref)),
      ...rows.flatMap(([k, f]) => [el('span', 'k', k), el('span', '', v(me.S, f)), el('span', '', v(ref.S, f))]));
    // the map
    const cv = $('paMap'), g = sized(cv), idx = trackIdx(D.w0, D.W - 1), V = fitView(cv, idx);
    drawRoad(g, V, idx);
    const W1 = D.W - 1, upMe = Math.min(W1, Math.floor(s)), upRef = pr ? Math.min(W1, Math.floor(pr.s)) : W1;
    if (lineMode === 'gap') {                    // (your path so far amber, the parts tinted gained / lost behind you, the other dashed)
      D.parts.forEach((p, j) => { if (at < p.b) return; const d = me.parts?.[j] - ref.parts?.[j]; if (!Number.isFinite(d)) return;
        const { PX, PZ } = D.track, part = trackIdx(D.lead + p.a, D.lead + p.b); g.strokeStyle = d < 0 ? 'rgba(54,210,127,.22)' : 'rgba(255,70,60,.22)'; g.lineWidth = 2 * D.track.HW * V.k;
        g.beginPath(); part.forEach((i, n) => n ? g.lineTo(V.X(PX[i]), V.Y(PZ[i])) : g.moveTo(V.X(PX[i]), V.Y(PZ[i]))); g.stroke(); });
      plain(g, ref.S, V, D.w0, W1, REF, 2 * U, true); plain(g, me.S, V, D.w0, upMe, ME, 4 * U);
    } else if (lineMode === 'trace') {           // (each car's path so far changes colour with its speed as it goes)
      plain(g, ref.S, V, upRef, W1, 'rgba(79,209,255,.3)', 1.5 * U, true);
      bySpeed(g, ref.S, V, D.w0, upRef, 2.5 * U, true); if (pr) { g.lineTo(V.X(pr.x), V.Y(pr.z)); g.stroke(); } g.setLineDash([]);
      bySpeed(g, me.S, V, D.w0, upMe, 4 * U); if (pm) { g.lineTo(V.X(pm.x), V.Y(pm.z)); g.stroke(); }
    } else { bySpeed(g, ref.S, V, D.w0, W1, 2 * U, true); g.setLineDash([]); bySpeed(g, me.S, V, D.w0, W1, 4 * U); }
    ringSquare(g, V); badges(g, V, P.cornersIn(D.L, D.sec));
    for (const k of P.cornersIn(D.L, D.sec)) for (const [d, col] of [[me, ME], [ref, REF]]) {
      const w = brakeW(d, k); if (w === null || w < 0 || !Number.isFinite(d.S.x[w])) continue;
      g.fillStyle = col; g.strokeStyle = '#0b0e12'; g.lineWidth = 2 * U; g.fillRect(V.X(d.S.x[w]) - 5 * U, V.Y(d.S.z[w]) - 5 * U, 10 * U, 10 * U); g.strokeRect(V.X(d.S.x[w]) - 5 * U, V.Y(d.S.z[w]) - 5 * U, 10 * U, 10 * U);
    }
    if (pr) dot(g, V.X(pr.x), V.Y(pr.z), REF); if (pm) dot(g, V.X(pm.x), V.Y(pm.z), ME);
    $('paKey').innerHTML = lineMode === 'gap' ? `<span class="me"></span> you <span class="ref"></span> ${shortOf(ref)} · the parts behind you: green gained, red lost · squares: where each braked`
      : `<b>${D.speed.lo}</b><span class="spd"></span><b>${D.speed.hi}</b> km/h · you solid, ${shortOf(ref)} dashed${lineMode === 'trace' ? ' · each path so far' : ''}`;
    // speed, pedals, steering
    const wheel = d => tel(d.S, 'wheel');
    cmpLayout = chart($('paCmpChart'), [
      { label: 'SPEED', unit: 'km/h', lines: [{ vals: ref.S.kmh, col: REF, dash: true }, { vals: me.S.kmh, col: ME, width: 2 }] },
      { label: 'GAS / BRAKE', unit: '', lo: 0, hi: 1, lines: [{ vals: ref.S.thr, col: REF, dash: true, width: 1.2 }, { vals: ref.S.brk, col: REF, dash: true, width: 1.2 }, { vals: me.S.thr, col: '#36d27f', width: 1.8 }, { vals: me.S.brk, col: '#ff463c', width: 1.8 }] },
      { label: 'STEERING', unit: '°', lines: [{ vals: wheel(ref), col: REF, dash: true }, { vals: wheel(me), col: ME, width: 2 }] },
    ], D.w0, D.W - 1, pm ? s : null);
  }
  const shortOf = d => d.ai ? d.name : d.id === 'saved' ? 'BEFORE' : d.name.toUpperCase();

  // ---- TELEMETRY ----
  let telLayout = null;
  function renderTelemetry() {
    const runs = $('paRuns');
    if (runs.dataset.for !== D.list.map(d => d.id).join()) {
      runs.dataset.for = D.list.map(d => d.id).join();
      runs.replaceChildren(...D.list.map(d => {
        const lab = el('label', 'pa-run' + (d.best ? ' best' : '')), cb = el('input'); cb.type = 'checkbox'; cb.dataset.id = d.id;
        cb.onchange = () => { cb.checked ? shown.add(d.id) : shown.delete(d.id); render(); };
        const i = el('i'); i.style.background = d.col;
        lab.append(cb, i, el('span', 'n', d.name.toUpperCase()), el('span', 't' + (Number.isFinite(d.time) ? (d.best ? ' purple' : '') : ' off'), Number.isFinite(d.time) ? s3(d.time) : d.off ? 'off ' + d.off : '—'));
        return lab;
      }));
    }
    for (const cb of runs.querySelectorAll('input')) cb.checked = shown.has(cb.dataset.id);
    const chips = $('paChans');
    if (!chips.children.length) chips.replaceChildren(...CHANS.map(([id, name]) => { const b = el('button', 'pr-chip', name); b.type = 'button'; b.dataset.c = id;
      b.onclick = () => { chans = chans.includes(id) ? chans.filter(c => c !== id) : CHANS.map(c => c[0]).filter(c => c === id || chans.includes(c)); render(); }; return b; }));
    for (const b of chips.children) b.setAttribute('aria-pressed', String(chans.includes(b.dataset.c)));
    const on = D.list.filter(d => shown.has(d.id)), order = [...on.filter(d => !d.best && !d.ai), ...on.filter(d => d.ai), ...on.filter(d => d.best)];   // (the best on top)
    const rows = CHANS.filter(c => chans.includes(c[0])).map(([id, name, of, unit]) => ({ label: name, unit, ...(id === 'pedals' ? { lo: 0, hi: 1 } : {}),
      lines: order.flatMap(d => of(d.S).map((vals, k) => ({ vals, col: id === 'pedals' && d.best ? (k ? '#ff463c' : '#36d27f') : d.col, width: d.best ? 2 : 1.3, dash: d.ai || k === 1 }))) }));
    telLayout = rows.length ? chart($('paTelChart'), rows, D.w0, D.W - 1, cursor) : (sized($('paTelChart')), null);
    // the cursor's values
    const at = cursor - D.lead, part = D.parts.find(p => at >= p.a && at < p.b);
    const tiles = [el('div', 'pa-tile')]; tiles[0].append(el('span', 'lbl', 'AT THE CURSOR'), el('b', '', `${at < 0 ? 'lead-in' : part ? part.name : 'after'} · ${Math.round(at * D.ds)} m`));
    for (const [, name, of, unit] of CHANS.filter(c => chans.includes(c[0])).slice(0, 4)) {
      const t = el('div', 'pa-tile'), b = el('b');
      for (const d of order.slice().reverse().slice(0, 3)) { const v = of(d.S)[0]?.[cursor]; const sp = el('span', '', `${Number.isFinite(v) ? fmt(v) : '–'} `); sp.style.color = d.col; b.append(sp); }
      t.append(el('span', 'lbl', `${name}${unit ? ' ' + unit : ''}`), b); tiles.push(t);
    }
    $('paTelTiles').replaceChildren(...tiles);
    // the mini map: your best run by speed, the cursor's place
    const best = D.list.find(d => d.best) ?? me, cv = $('paTelMap'), g = sized(cv), idx = trackIdx(D.w0, D.W - 1), V = fitView(cv, idx, 10);
    drawRoad(g, V, idx); if (best) { bySpeed(g, best.S, V, D.w0, D.W - 1, 3 * U); const w = cursor; if (Number.isFinite(best.S.x[w])) dot(g, V.X(best.S.x[w]), V.Y(best.S.z[w]), '#f2f3f0', 6); }
  }
  onChart($('paTelChart'), () => telLayout, w => { cursor = Math.max(D.w0, Math.min(D.W - 1, w)); render(); });

  // ---- CORNER ----
  function renderCorner() {
    const cs = P.cornersIn(D.L, D.sec), box = $('paCorners');
    if (box.dataset.for !== cs.join()) {
      box.dataset.for = cs.join();
      box.replaceChildren(...cs.map(k => { const b = el('button', 'pr-chip', D.L.corners[k].name); b.type = 'button'; b.dataset.k = String(k); b.onclick = () => { corner = k; render(); }; return b; }));
    }
    for (const b of box.children) b.setAttribute('aria-pressed', String(Number(b.dataset.k) === corner));
    if (corner < 0) return;
    const c = D.L.corners[corner], apexW = P.windowOf(D.sec, D.lead, D.len, c.apex, D.N);
    const w0 = Math.max(0, apexW - Math.round(170 / D.ds)), w1 = Math.min(D.W - 1, apexW + Math.round(110 / D.ds));
    const runs = D.list.filter(d => d.run || d.id === 'saved'), best = D.list.find(d => d.best), ai = D.list.find(d => d.id === 'alien') ?? D.list.find(d => d.ai);
    const others = runs.filter(d => d !== best);
    $('paCorNote').textContent = `every run through ${c.name} · ${best ? 'your best by speed · ' : ''}run 1 light grey${ai ? ` · ${ai.name} dashed` : ''} · squares: where each braked`;
    // the map
    const cv = $('paCorMap'), g = sized(cv), idx = trackIdx(w0, w1), V = fitView(cv, idx, 16);
    drawRoad(g, V, idx);
    for (const d of others) plain(g, d.S, V, w0, w1, d.col, (d.first ? 2 : 1.5) * U);
    if (ai) plain(g, ai.S, V, w0, w1, REF, 2 * U, true);
    if (best) bySpeed(g, best.S, V, w0, w1, 4 * U);
    for (const d of [runs.find(x => x.first), best, ai].filter(Boolean)) {
      const w = brakeW(d, corner); if (w === null || w < w0 || !Number.isFinite(d.S.x[w])) continue;
      const col = d === ai ? REF : d === best ? ME : FIRST;
      g.fillStyle = col; g.strokeStyle = '#0b0e12'; g.lineWidth = 2 * U; g.fillRect(V.X(d.S.x[w]) - 6 * U, V.Y(d.S.z[w]) - 6 * U, 12 * U, 12 * U); g.strokeRect(V.X(d.S.x[w]) - 6 * U, V.Y(d.S.z[w]) - 6 * U, 12 * U, 12 * U);
    }
    badges(g, V, [corner]);
    // the traces through it
    const order = [...others, ...(ai ? [ai] : []), ...(best ? [best] : [])];
    chart($('paCorChart'), [
      { label: 'SPEED', unit: 'km/h', lines: order.map(d => ({ vals: d.S.kmh, col: d.col, width: d === best ? 2 : 1.2, dash: d.ai })) },
      { label: 'GAS / BRAKE', unit: '', lo: 0, hi: 1, lines: order.flatMap(d => [{ vals: d.S.thr, col: d === best ? '#36d27f' : d.col, width: d === best ? 1.8 : 1, dash: d.ai }, { vals: d.S.brk, col: d === best ? '#ff463c' : d.col, width: d === best ? 1.8 : 1, dash: true }]) },
      { label: 'WHEEL', unit: '°', lines: order.map(d => ({ vals: tel(d.S, 'wheel'), col: d.col, width: d === best ? 2 : 1.2, dash: d.ai })) },
    ], w0, w1, apexW, { parts: false });
    // run by run
    const p = D.parts.findIndex(q => q.corner === corner), rowsOf = [...runs, ...(ai ? [ai] : [])];
    const times = rowsOf.map(d => d.parts?.[p]).filter(Number.isFinite), fastest = times.length ? Math.min(...rowsOf.filter(d => !d.ai).map(d => d.parts?.[p]).filter(Number.isFinite)) : NaN;
    const cells = [el('span', 'h n', `${c.name} · RUN BY RUN`), el('span', 'h', 'BRAKE'), el('span', 'h', 'MIN'), el('span', 'h', 'GAS'), el('span', 'h', 'TIME')];
    for (const d of rowsOf) {
      const m = metricsOf(d)[corner], t = d.parts?.[p], name = el('span', 'n', d.best ? `${d.name} · best` : d.name); name.style.color = d.col;
      const tc = el('span', '', s3(t)); if (!d.ai && Number.isFinite(t) && Math.abs(t - fastest) < 1e-4) tc.style.color = 'var(--purple)';
      cells.push(name, el('span', '', m?.brakeAt !== null && m ? `${Math.round(m.brakeAt)} m` : '–'), el('span', '', m ? r0(m.min) : '–'),
        el('span', '', m?.fullAt !== null && m ? `${Math.round(m.fullAt)} m` : '–'), tc);
    }
    $('paCorTable').replaceChildren(...cells);
    // what moved
    const ms = runs.map(d => metricsOf(d)[corner]).filter(m => m && Number.isFinite(m.min));
    const spread = f => { const v = ms.map(f).filter(x => x !== null && Number.isFinite(x)); return v.length > 1 ? Math.max(...v) - Math.min(...v) : null; };
    const bp = spread(m => m.brakeAt), mn = spread(m => m.min);
    const first = runs.find(d => d.first), mf = first ? metricsOf(first)[corner] : null, mb = best ? metricsOf(best)[corner] : null, ma = ai ? metricsOf(ai)[corner] : null;
    const steady = ms.length > 1 ? `Over ${ms.length} runs your braking point moved ${bp === null ? '–' : Math.round(bp)} m and the slowest speed ${mn === null ? '–' : Math.round(mn)} km/h.` : '';
    const change = mf && mb && ma ? ' ' + P.changeSentence(c.name, mf, mb, ma, ai.name === 'ALIEN' ? 'The ALIEN' : ai.name) : '';
    $('paCorText').textContent = (steady + change).trim();
  }

  function render() {
    if (!D || view === 'runs') return;
    if (!me) { for (const id of ['paCmp', 'paTel', 'paCor']) $(id).hidden = true; return; }
    if (view === 'compare') renderCompare(); else if (view === 'telemetry') renderTelemetry(); else renderCorner();
  }
  return {
    // the summary opened: the drives afresh, back to RUNS
    // the drives afresh (the practice screen opened, another section picked)
    reset() { playing = false; build(); if (D) fillPickers(); $('paRuns').dataset.for = ''; $('paCorners').dataset.for = ''; },
    // the tab shown (practice.js shows the SECTION and RUNS views itself)
    show(v) {
      view = v; playing = false;
      $('paCmp').hidden = v !== 'compare'; $('paTel').hidden = v !== 'telemetry'; $('paCor').hidden = v !== 'corner';
      if (v === 'compare' || v === 'telemetry' || v === 'corner') requestAnimationFrame(render);          // (after layout: the canvases take their size)
    },
    get view() { return view; },
    has: () => !!(D && me),
  };
}
