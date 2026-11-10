// Lap analysis (2026-10-26; reworked 2026-11-10 into a panel the paddock's size, the user's: "ghost car comparison or
// virtual lap comparison similar to how they show it in broadcasts (a 3D and a 2D view)"): one of your laps against a
// reference lap (the fastest of yours, the AI's and a loaded one by default; any AI level or your best can be picked).
// OVERVIEW: a map coloured by where the time went, the sector times with your bests and the best anyone has, the
// session's pace (average, spread, laps near your best, theoretical best, the gap to every AI level) and how each corner
// was driven (braking point, entry / slowest / exit speed, back on full throttle). COMPARE: both laps replayed
// (lap-replay.js), by time (a ghost race) or by distance (the same spot): 2D = the map filling in mini-sector by
// mini-sector, the live delta, both cars' speed / gear / pedals, the next corner, the delta and speed traces; 3D = the
// two cars in the circuit (analysis-3d.js) with broadcast cameras. Opened from the pause menu, the results and the start
// menu (your best there). ctx: { game, sectors (sector-timing.js), aiLapOf(id, aero), track(), models() (every other
// car model: hidden in 3D) }
import { SIM } from '../sim/index.js';
import { RACE_SETUP } from './config.js';
import { $, fmtTime } from './util.js';
import { Screens } from './screens.js';
import { Design } from './design.js';
import { raceAero } from './setup-store.js';
import { ghostDriver } from './ai-ghosts.js';
import { zoneTag } from './aero-zones.js';
import { ANALYSIS, traceFromAi, miniTimes, sectorTimes, cornerMetrics, sessionPace, theoretical } from './lap-analysis.js';
import { REPLAY, replayOf, compareAt, deltaSeries } from './lap-replay.js';
import { createReplay3d } from './analysis-3d.js';
import { playerClass } from './car-class.js';

const gapText = d => !Number.isFinite(d) ? '–' : (d > ANALYSIS.tie ? '+' : d < -ANALYSIS.tie ? '−' : '±') + Math.abs(d).toFixed(3);
const gapCls = d => !Number.isFinite(d) ? '' : d < -ANALYSIS.tie ? 'faster' : d > ANALYSIS.tie ? 'slower' : '';
const secs = t => Number.isFinite(t) ? t.toFixed(3) : '–';
const both = (a, b, f = v => Math.round(v)) => `${a === null || !Number.isFinite(a) ? '–' : f(a)} <small>/ ${b === null || !Number.isFinite(b) ? '–' : f(b)}</small>`;
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));
const clock = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(3).padStart(6, '0'); };
const num = v => v === null || !Number.isFinite(v) ? '–' : Math.round(v);

const COL = { me: '#ffc21a', ref: '#4fd1ff', gain: [54, 210, 127], lost: [255, 70, 60], now: '#e9ebe6', ahead: '#2a313b', base: 'rgba(255,255,255,.12)', sector: '#ffc21a' };
const CAMS = { chase: ['CHASE', 'Behind your car'], tv: ['TV', 'Trackside cameras, cutting corner to corner'], heli: ['HELI', 'From above, both cars in view'], onboard: ['ONBOARD', 'Your cockpit'] };
const U = 2;                     // canvas pixels per CSS pixel (every canvas here is drawn at twice its size)
// the 2D map zoomed in (2026-11-10, the canvas mock-up "COMPARE · 2D zoomed"): × the whole circuit's scale
export const MAP_ZOOM = Object.freeze({ start: 5, max: 12, wheel: 1.25, scales: [10, 25, 50, 100, 200, 500] });

export function createAnalysis({ game, sectors, aiLapOf, track, models }) {
  let open = false, from = null, D = null, laps = [], refs = [], tab = 'over', view = '2d';
  // the comparison: { me, ref (replays), name, short, d (delta per sample), mc / rc (corner metrics) }, the replay's time
  // T (s into your lap), playing, rate, sync, camera
  // the 2D map's zoom: k = × the whole circuit (1 = all of it), follow = centred on your car, else on x / z (m)
  const Z = { k: 1, follow: true, x: 0, z: 0 };
  let C = null, T = 0, playing = false, rate = 1, sync = 'time', camera = 'chase', jump = true, dirty = true, hudWas = false;
  const R3 = createReplay3d();

  // the laps you can look at: this session's (newest first, the fastest valid one picked) and your all-time best
  function lapChoices() {
    const out = D.laps.map((tr, k) => ({ tr, label: `Lap ${tr.lap ?? k + 1}  ${fmtTime(tr.time)}${tr.invalid ? '  (invalid)' : ''}${tr.pit ? '  (pit)' : ''}${tr.start ? '  (from the grid)' : ''}` })).reverse();
    const valid = D.laps.filter(l => !l.invalid), best = valid.length ? valid.reduce((a, l) => l.time < a.time ? l : a) : null;
    if (D.bests.best) out.push({ tr: D.bests.best, ghost: sectors.myGhost(D.bests.best, D.track.id, D.modified, zones(), carId()), label: `Your best ever  ${fmtTime(D.bests.best.time)}` });
    return { list: out, pick: best ? out.findIndex(o => o.tr === best) : out.length - 1 };
  }
  const aero = () => game.race?.activeAero ?? raceAero(game.setup).activeAero;
  const zones = () => zoneTag(D.track, aero());
  const carId = () => game.race?.carClass?.id ?? playerClass().id;
  // the laps to compare with: the fastest (sector-timing's reference) first, then every AI level
  function refChoices() {
    const list = [];
    if (D.ref.ref) list.push({ ...D.ref.ref, label: `Fastest: ${D.ref.ref.name}  ${fmtTime(D.ref.ref.trace.time)}` });
    for (const c of D.candidates) if (c !== D.ref.ref) list.push({ ...c, label: `${c.name}  ${fmtTime(c.trace.time)}` });
    for (const [id, label] of RACE_SETUP.choices.ai) {
      if (id === 'alien') continue;                                    // (a candidate already)
      const lap = aiLapOf(id, aero()); if (lap) list.push({ id, name: `${label} · ${ghostDriver().code}`, driver: ghostDriver(), trace: traceFromAi(lap), label: `${label} · ${ghostDriver().code}  ${fmtTime(lap.time)}` });
    }
    return list;
  }
  const picked = () => ({ me: laps[+$('anaLap').value], ref: refs[+$('anaRef').value] });

  function render() {
    const { me: lm, ref } = picked(), me = lm?.tr, L = D.L, T0 = D.track;
    $('anaNote').textContent = !me ? 'Drive a lap first: every lap you complete is timed by sector and corner, and can be replayed against another.' : !ref ? 'No lap to compare with yet.' : '';
    drawOverviewMap(me, ref);
    // sectors
    const ms = me ? sectorTimes(me, L) : [], rs = ref ? sectorTimes(ref.trace, L) : [];
    const rows = L.sectors.map((_, s) => {
      const best = Math.min(D.bests.sec[s], D.ref.sec[s]), d = ms[s] - rs[s];
      return `<tr><td>S${s + 1}</td><td class="r num">${secs(ms[s])}</td><td class="r num">${secs(rs[s])}</td><td class="r num ${gapCls(d)}">${gapText(d)}</td><td class="r num">${secs(D.bests.sec[s])}</td><td class="r num best">${secs(best)}</td></tr>`;
    });
    const lapD = me && ref ? me.time - ref.trace.time : NaN, theo = theoretical(D.bests);
    rows.push(`<tr class="tot"><td>Lap</td><td class="r num">${me ? fmtTime(me.time) : '–'}</td><td class="r num">${ref ? fmtTime(ref.trace.time) : '–'}</td><td class="r num ${gapCls(lapD)}">${gapText(lapD)}</td><td class="r num">${fmtTime(D.bests.best?.time)}</td><td class="r num best">${fmtTime(Math.min(D.bests.best?.time ?? Infinity, D.ref.ref?.trace.time ?? Infinity))}</td></tr>`);
    rows.push(`<tr class="theo"><td colspan="4">Your theoretical best (your best mini-sectors together)</td><td class="r num" colspan="2">${theo ? fmtTime(theo) : '–'}</td></tr>`);
    $('anaSec').innerHTML = rows.join('');
    // corners
    const mc = me ? cornerMetrics(me, L, T0.ds) : [], rc = ref ? cornerMetrics(ref.trace, L, T0.ds) : [];
    $('anaCorners').innerHTML = L.corners.map((c, k) => {
      const a = mc[k], b = rc[k], d = a && b ? a.time - b.time : NaN;
      return `<tr><td>${c.name}</td><td class="r num">${a ? secs(a.time) : '–'}</td><td class="r num ${gapCls(d)}">${gapText(d)}</td>`
        + `<td class="r num">${both(a?.brakeAt, b?.brakeAt)}</td><td class="r num">${both(a?.entry, b?.entry)}</td><td class="r num">${both(a?.min, b?.min)}</td>`
        + `<td class="r num">${both(a?.exit, b?.exit)}</td><td class="r num">${both(a?.fullAt, b?.fullAt, signed)}</td></tr>`;
    }).join('');
    $('anaCap').textContent = ref ? `you / ${ref.name}: brakes = metres before the apex, speeds in km/h, full gas = metres after the apex (− = before)` : '';
    renderPace();
    // the comparison of these two laps
    C = me && ref ? {
      me: replayOf(me, T0, lm.ghost ?? null), ref: replayOf(ref.trace, T0, ref.ghost ?? null), name: ref.name,
      short: ref.driver?.code ?? (ref.id === 'mine' ? 'BEST' : ref.name.split(' ')[0].slice(0, 10).toUpperCase()), mc, rc,
    } : null;
    if (C) { C.d = deltaSeries(C.me, C.ref); $('cmpRefKey').textContent = ref.name; buildTele(); }
    // a lap saved before positions were kept (2026-11-10) and with no ghost of it: drawn on the racing line, not where you drove
    const old = C && [C.me, C.ref].some(R => R.source === 'centre');
    if (old && !$('anaNote').textContent) $('anaNote').textContent = 'Your best ever was saved before laps kept where the car went: it replays on the racing line. Your next best keeps your own line.';
    T = Math.min(T, C ? C.me.time : 0); jump = true; dirty = true;
    R3.setLiveries({ ...game.garage.livery }, liveryOf(ref));
    showTab();
  }
  const liveryOf = ref => !ref ? game.garage.livery : ref.ghost?.livery ? { ...game.garage.livery, ...ref.ghost.livery }
    : ref.driver ? { ...game.garage.livery, color: ref.driver.color, accent: ref.driver.accent } : { ...game.garage.livery };

  function renderPace() {
    if (!D.laps.length) { $('anaPace').innerHTML = '<p class="gpu">Session pace appears here once you have driven laps in a race or time trial.</p>'; return; }
    const ai = {};
    for (const [id] of RACE_SETUP.choices.ai) { const lap = aiLapOf(id, aero()); if (lap) ai[id] = lap.time; }
    const P = sessionPace(D.laps, D.L, ai), label = Object.fromEntries(RACE_SETUP.choices.ai);
    const stat = (k, v, title = '') => `<div title="${title}"><span class="lbl">${k}</span><b class="num">${v}</b></div>`;
    $('anaPace').innerHTML = `<div class="ana-stats">${[
      stat('Laps', `${P.valid} / ${P.laps}`, 'valid laps / all laps'),
      stat('Best', fmtTime(P.best)),
      stat('Average', P.avg ? fmtTime(P.avg) : '–', `your valid flying laps within ${Math.round((ANALYSIS.outlier - 1) * 100)} % of your best (no pit laps)`),
      stat('Spread', P.sd !== null ? '±' + P.sd.toFixed(3) : '–', 'standard deviation of those laps: lower = more consistent'),
      stat('Near best', `${P.within}`, `laps within ${ANALYSIS.within} s of your best`),
      stat('Theoretical', P.theo ? fmtTime(P.theo) : '–', 'this session: your best mini-sectors together'),
    ].join('')}</div><div class="ana-ai"><span class="lbl">Gap to the AI</span>${
      Object.entries(P.gaps).map(([id, g]) => { const d = P.best - g.time;
        return `<span title="${fmtTime(g.time)}${g.pct === null ? '' : ` · ${(g.pct > 0 ? '+' : '−') + Math.abs(g.pct).toFixed(2)} %`}">${label[id] || id}<b class="num ${gapCls(d)}">${gapText(d)}</b></span>`; }).join('')}</div>`;
  }

  // ---- the maps ----
  // a canvas's transform for the circuit (padding p in CSS px)
  function fit(cv, p = 22) {
    const { minX, maxX, minZ, maxZ } = D.track.bounds, W = cv.width, H = cv.height, P = p * U;
    const s = Math.min((W - 2 * P) / (maxX - minX), (H - 2 * P) / (maxZ - minZ));
    return { s, x: v => P + (v - minX) * s + (W - 2 * P - (maxX - minX) * s) / 2, z: v => P + (v - minZ) * s + (H - 2 * P - (maxZ - minZ) * s) / 2 };
  }
  const tone = (d, base = 0.35) => { const a = Math.min(1, Math.abs(d) / 0.3), c = d < 0 ? COL.gain : COL.lost; return `rgba(${c[0]},${c[1]},${c[2]},${base + (1 - base) * a})`; };
  // the circuit with each mini-sector coloured by colourOf(k) (null = not drawn over), corner badges, sector lines;
  // dots = [{ x, z, col }]
  function drawCircuit(cv, colourOf, { dots = [], badges = true, width = 7, sectorsToo = true, cornerColour = null } = {}) {
    const g = cv.getContext('2d'), T0 = D.track, L = D.L, { N, PX, PZ, NX, NZ } = T0, M = fit(cv, badges ? 22 : 12);
    g.clearRect(0, 0, cv.width, cv.height); g.lineJoin = g.lineCap = 'round';
    const path = (a, b) => { g.beginPath(); for (let i = a; i <= b; i++) { const k = Math.min(i, N - 1) % N; i === a ? g.moveTo(M.x(PX[k]), M.z(PZ[k])) : g.lineTo(M.x(PX[k]), M.z(PZ[k])); } };
    path(0, N); g.strokeStyle = COL.base; g.lineWidth = (width + 7) * U; g.stroke();
    L.minis.forEach((m, k) => { const c = colourOf(m, k); if (!c) return; g.strokeStyle = c; g.lineWidth = width * U; path(m.from, m.to); g.stroke(); });
    if (sectorsToo) {
      g.strokeStyle = COL.sector; g.lineWidth = 2 * U;
      for (const sc of L.sectors) { const i = sc.from, k = (i + 1) % N, nx = -(PZ[k] - PZ[i]), nz = PX[k] - PX[i], l = Math.hypot(nx, nz) || 1;
        g.beginPath(); g.moveTo(M.x(PX[i]) - nx / l * 10 * U, M.z(PZ[i]) - nz / l * 10 * U); g.lineTo(M.x(PX[i]) + nx / l * 10 * U, M.z(PZ[i]) + nz / l * 10 * U); g.stroke(); }
    }
    if (badges) {
      g.font = `600 ${13 * U}px "Saira Condensed", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (sectorsToo) L.sectors.forEach((sc, k) => { const i = (sc.from + Math.floor((sc.to - sc.from) / 2)) % N; g.fillStyle = COL.sector;
        g.fillText('S' + (k + 1), M.x(PX[i] + NX[i] * 22 * U / M.s), M.z(PZ[i] + NZ[i] * 22 * U / M.s)); });
      L.corners.forEach((c, k) => {
        g.fillStyle = 'rgba(10,13,17,.85)'; g.beginPath(); g.arc(M.x(PX[c.apex]), M.z(PZ[c.apex]), 11 * U, 0, Math.PI * 2); g.fill();
        g.fillStyle = cornerColour?.(k) ?? '#e9ebe6'; g.fillText(c.name, M.x(PX[c.apex]), M.z(PZ[c.apex]) + U);
      });
    }
    for (const d of dots) {
      g.beginPath(); g.arc(M.x(d.x), M.z(d.z), (d.r ?? 8) * U, 0, Math.PI * 2); g.fillStyle = d.col; g.fill();
      g.lineWidth = 3 * U; g.strokeStyle = '#0b0e12'; g.stroke();
    }
    return M;
  }
  const miniGaps = (me, ref) => { const mm = miniTimes(me, D.L), rm = miniTimes(ref, D.L); return mm.map((t, k) => t - rm[k]); };
  function drawOverviewMap(me, ref) {
    const gaps = me && ref ? miniGaps(me, ref.trace) : null, corner = k => D.L.minis.findIndex(m => m.corner === k);
    drawCircuit($('anaMap'), (m, k) => !gaps || !Number.isFinite(gaps[k]) ? '#e9ebe6' : tone(gaps[k]),
      { cornerColour: k => !gaps || !Number.isFinite(gaps[corner(k)]) ? null : gaps[corner(k)] < 0 ? '#5ff0a0' : '#ff8a80' });
  }

  // ---- the comparison ----
  function buildTele() {
    const row = (k, a, b) => `<span class="lbl">${k}</span>${a}${b}`;
    $('cmpTele').innerHTML = `<span></span><span class="who"><i class="ana-dot me"></i>YOU</span><span class="who"><i class="ana-dot ref"></i>${C.name}</span>`
      + row('km/h', '<b class="v" data-k="kmhMe"></b>', '<b class="v" data-k="kmhRef"></b>')
      + row('Gear', '<b class="v" data-k="gearMe"></b>', '<b class="v" data-k="gearRef"></b>')
      + row('Throttle', bar(C.me, 't', 'thrMe'), bar(C.ref, 't', 'thrRef'))
      + row('Brake', bar(C.me, 'b', 'brkMe'), bar(C.ref, 'b', 'brkRef'));
  }
  // a pedal's bar, or for a lap recorded without pedals (a ghost from before 2026-11-10: positions only) a word saying so
  const bar = (R, cls, k) => R.pedals ? `<span class="bar ${cls}"><i data-k="${k}"></i></span>` : '<span class="na">not recorded</span>';
  const tele = k => $('cmpTele').querySelector(`[data-k="${k}"]`) ?? { style: {}, textContent: '' };
  const pct = v => v === null ? '0%' : Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';
  function nextCorner(s) {
    const L = D.L; let k = L.corners.findIndex(c => c.apex >= s); if (k < 0) k = 0;
    return k;
  }
  // the 2D view's map, readouts and traces at the replay's time
  function draw2d(cmp) {
    const { me, ref } = C, ds = D.track.ds, sMe = cmp.sMe;
    const pm = me.poseAt(T), pr = ref.poseAt(cmp.tRef), corner = k => D.L.minis.findIndex(m => m.corner === k);
    const gaps = miniGaps(picked().me.tr, picked().ref.trace);
    if (Z.k > 1) drawZoom($('cmpMap'), cmp, pm, pr, gaps);
    else drawCircuit($('cmpMap'), (m, k) => m.to <= sMe ? tone(gaps[k]) : m.from <= sMe ? COL.now : COL.ahead,
      { dots: [{ x: pr.x, z: pr.z, col: COL.ref }, { x: pm.x, z: pm.z, col: COL.me }],
        cornerColour: k => { const m = D.L.minis[corner(k)]; return !m || m.to > sMe ? null : gaps[corner(k)] < 0 ? '#5ff0a0' : '#ff8a80'; } });
    readouts(cmp);
    tele('kmhMe').textContent = num(me.kmh(sMe)); tele('kmhRef').textContent = num(ref.kmh(cmp.sRef));
    tele('gearMe').textContent = me.gear(sMe) ?? '–'; tele('gearRef').textContent = ref.gear(cmp.sRef) ?? '–';
    tele('thrMe').style.width = pct(me.thr(sMe)); tele('thrRef').style.width = pct(ref.thr(cmp.sRef));
    tele('brkMe').style.width = pct(me.brk(sMe)); tele('brkRef').style.width = pct(ref.brk(cmp.sRef));
    // the next corner, as both laps took it
    const k = nextCorner(sMe), c = D.L.corners[k], a = C.mc[k], b = C.rc[k], d = a && b ? a.time - b.time : NaN;
    const away = c.apex >= sMe ? `${Math.round((c.apex - sMe) * ds)} m to the apex` : 'next lap';
    const r = (name, x, y) => `<span class="k">${name}</span><span class="r">${x}</span><span class="r">${y}</span><span></span>`;
    const html = `<div class="head"><b>NEXT · ${c.name}</b><span>${away}</span></div><span></span><span class="r me">YOU</span><span class="r ref">${C.short}</span><span class="r k">gap</span>`
      + r('Brakes, m before apex', num(a?.brakeAt), num(b?.brakeAt)) + r('Slowest, km/h', num(a?.min), num(b?.min))
      + r('Exit, km/h', num(a?.exit), num(b?.exit))
      + `<span class="k">Time in the corner</span><span class="r">${a ? secs(a.time) : '–'}</span><span class="r">${b ? secs(b.time) : '–'}</span><span class="r ${gapCls(d)}">${gapText(d)}</span>`;
    if ($('cmpCorner').dataset.html !== html) { $('cmpCorner').innerHTML = html; $('cmpCorner').dataset.html = html; }
    drawGraph(sMe);
  }
  // where a replayed lap went, at every track sample (its own positions, its ghost's or the racing line), once per lap
  function lineOf(R) {
    if (R.line) return R.line;
    const n = D.track.N, x = new Float32Array(n), z = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = R.poseAt(R.ti[i]); x[i] = p.x; z[i] = p.z; }
    return (R.line = { x, z });
  }
  // the zoomed map's view: canvas px per metre, the middle (m), metres ↔ canvas px
  function zoomView(cv, pm) {
    const k = fit(cv).s * Z.k;
    if (Z.follow && pm) { Z.x = pm.x; Z.z = pm.z; }
    return { k, X: x => (x - Z.x) * k + cv.width / 2, Y: z => (z - Z.z) * k + cv.height / 2 };
  }
  // the 2D map zoomed in: the road and its edges, each lap's own line across it (yours up to your car, the other's
  // dashed), both cars, the gap between them, where each lap braked and went full gas for the next corner, a scale bar;
  // the mini-sectors done as a tint on the road; the inset shows where on the circuit this is
  function drawZoom(cv, cmp, pm, pr, gaps) {
    const g = cv.getContext('2d'), T0 = D.track, { N, PX, PZ, NX, NZ, K, HW, ds } = T0, W = cv.width, H = cv.height, sMe = cmp.sMe;
    const { k, X, Y } = zoomView(cv, pm);
    g.clearRect(0, 0, W, H); g.lineJoin = g.lineCap = 'round';
    const road = (a, b, off = 0) => { g.beginPath(); for (let i = a; i <= b; i++) { const j = i % N, x = X(PX[j] + NX[j] * off), y = Y(PZ[j] + NZ[j] * off); i === a ? g.moveTo(x, y) : g.lineTo(x, y); } };
    const line = (L, a, b) => { g.beginPath(); for (let i = a; i <= b; i++) { const x = X(L.x[i]), y = Y(L.z[i]); i === a ? g.moveTo(x, y) : g.lineTo(x, y); } };
    road(0, N); g.strokeStyle = '#262d36'; g.lineWidth = 2 * HW * k; g.stroke();
    D.L.minis.forEach((m, i) => { if (m.to > sMe || !Number.isFinite(gaps[i])) return;
      road(m.from, m.to); g.strokeStyle = gaps[i] < 0 ? 'rgba(54,210,127,.16)' : 'rgba(255,70,60,.16)'; g.stroke(); });
    g.lineWidth = U; g.strokeStyle = '#5b6573'; road(0, N, HW); g.stroke(); road(0, N, -HW); g.stroke();
    g.strokeStyle = COL.sector; g.lineWidth = 3 * U; g.beginPath(); g.moveTo(X(PX[0] + NX[0] * HW), Y(PZ[0] + NZ[0] * HW)); g.lineTo(X(PX[0] - NX[0] * HW), Y(PZ[0] - NZ[0] * HW)); g.stroke();
    const lm = lineOf(C.me), lr = lineOf(C.ref), upTo = Math.min(N - 1, Math.floor(sMe));
    g.lineWidth = 2 * U; g.setLineDash([6 * U, 4 * U]); g.strokeStyle = COL.ref; line(lr, 0, N - 1); g.stroke(); g.setLineDash([]);
    g.strokeStyle = COL.me; line(lm, 0, upTo); g.lineTo(X(pm.x), Y(pm.z)); g.stroke();
    // the corners in view
    g.font = `600 ${13 * U}px "Saira Condensed", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const c of D.L.corners) {
      const out = K[c.apex] > 0 ? -1 : 1, d = HW + 26 * U / k, x = X(PX[c.apex] + NX[c.apex] * d * out), y = Y(PZ[c.apex] + NZ[c.apex] * d * out);
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      g.fillStyle = 'rgba(10,13,17,.85)'; g.beginPath(); g.arc(x, y, 12 * U, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e9ebe6'; g.fillText(c.name, x, y + U);
    }
    // the next corner: where each lap braked (red) and went full gas (green)
    const label = (x, y, text, col) => {
      g.font = `800 ${12 * U}px "DM Sans", Arial, sans-serif`; g.textAlign = 'left';
      const w = g.measureText(text).width + 12 * U, lx = Math.min(W - w - 4 * U, Math.max(4 * U, x)), ly = Math.min(H - 14 * U, Math.max(14 * U, y));
      g.fillStyle = 'rgba(10,13,17,.92)'; g.fillRect(lx, ly - 10 * U, w, 20 * U); g.fillStyle = col; g.fillText(text, lx + 6 * U, ly + U);
    };
    const kc = nextCorner(sMe), apex = D.L.corners[kc].apex;
    [[C.mc[kc], lm, 'YOU', COL.me, -1], [C.rc[kc], lr, C.short, COL.ref, 1]].forEach(([mt, L, who, col, side]) => {
      if (!mt) return;
      const mark = (m, fill, text) => {
        if (m === null || m === undefined) return;
        const i = SIM.wrapIdx(Math.round(apex + m / ds), N), x = X(L.x[i]), y = Y(L.z[i]);
        g.fillStyle = fill; g.strokeStyle = '#0f1318'; g.lineWidth = 2 * U; g.beginPath(); g.rect(x - 5 * U, y - 5 * U, 10 * U, 10 * U); g.fill(); g.stroke();
        if (x > 0 && x < W && y > 0 && y < H) label(x + 10 * U, y + side * 16 * U, text, col);
      };
      mark(mt.brakeAt === null ? null : -mt.brakeAt, '#ff5a4e', `${who} brakes · ${Math.round(mt.brakeAt)} m`);
      mark(mt.fullAt, '#36d27f', `${who} full gas`);
    });
    // the cars, and the gap between them (by time)
    const gapM = Math.round(cmp.ahead * ds);
    if (sync === 'time' && Math.abs(gapM) >= 2) { g.setLineDash([3 * U, 3 * U]); g.strokeStyle = '#f2f3f0'; g.lineWidth = 1.5 * U;
      g.beginPath(); g.moveTo(X(pm.x), Y(pm.z)); g.lineTo(X(pr.x), Y(pr.z)); g.stroke(); g.setLineDash([]); }
    for (const [p, col] of [[pr, COL.ref], [pm, COL.me]]) {
      g.beginPath(); g.arc(X(p.x), Y(p.z), 8 * U, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 3 * U; g.strokeStyle = '#0b0e12'; g.stroke();
    }
    // the scale
    const sm = MAP_ZOOM.scales.find(m => m * k >= 50 * U) ?? MAP_ZOOM.scales.at(-1), bx = 14 * U, by = H - 14 * U;
    g.strokeStyle = '#c4c9cf'; g.lineWidth = 1.5 * U; g.beginPath(); g.moveTo(bx, by - 6 * U); g.lineTo(bx, by); g.lineTo(bx + sm * k, by); g.lineTo(bx + sm * k, by - 6 * U); g.stroke();
    g.font = `600 ${12 * U}px "DM Sans", Arial, sans-serif`; g.fillStyle = '#c4c9cf'; g.textAlign = 'left'; g.fillText(`${sm} m`, bx + sm * k + 8 * U, by - 3 * U);
    // the inset: the whole circuit, this view's window on it, your car
    const mini = $('cmpZoomMini'), M = drawCircuit(mini, () => null, { badges: false, width: 3, sectorsToo: false, dots: [{ x: pm.x, z: pm.z, col: COL.me, r: 4 }] });
    const mg = mini.getContext('2d'), hw = W / 2 / k, hh = H / 2 / k;
    mg.strokeStyle = COL.me; mg.lineWidth = 2 * U; mg.fillStyle = 'rgba(255,194,26,.12)';
    mg.fillRect(M.x(Z.x - hw), M.z(Z.z - hh), 2 * hw * M.s, 2 * hh * M.s); mg.strokeRect(M.x(Z.x - hw), M.z(Z.z - hh), 2 * hw * M.s, 2 * hh * M.s);
  }
  // the zoom's buttons and inset follow the zoom
  function zoomUi() {
    const on = Z.k > 1;
    $('cmpMap').parentElement.classList.toggle('zoomed', on);
    $('cmpZoomMini').hidden = !on;
    $('cmpZoomX').textContent = on ? `×${Math.round(Z.k * 10) / 10}` : '';
    $('cmpFollow').setAttribute('aria-pressed', String(Z.follow));
    $('cmpZoomIn').disabled = Z.k >= MAP_ZOOM.max;
    $('cmpMapHint').textContent = on ? 'Double-click: the whole circuit · drag to look around' : 'Double-click to zoom in there';
    dirty = true;
  }
  // zoom to k, keeping the spot under canvas point (px, py) where it is (no point: the middle)
  function zoomTo(k, px, py) {
    const cv = $('cmpMap'), was = Z.k;
    k = Math.min(MAP_ZOOM.max, k);
    if (k < 1.5) { Z.k = 1; zoomUi(); return; }
    if (was <= 1) {                                   // (from the whole circuit: the spot clicked, else your car)
      const M = fit(cv);
      if (px === undefined) Z.follow = true;
      else { Z.follow = false; Z.x = (px - M.x(0)) / M.s; Z.z = (py - M.z(0)) / M.s; }
    } else if (px !== undefined && !Z.follow) {
      const k0 = fit(cv).s * was, k1 = fit(cv).s * k, wx = Z.x + (px - cv.width / 2) / k0, wz = Z.z + (py - cv.height / 2) / k0;
      Z.x = wx - (px - cv.width / 2) / k1; Z.z = wz - (py - cv.height / 2) / k1;
    }
    Z.k = k; zoomUi();
  }
  { const cv = $('cmpMap'), at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; };
    let drag = null;
    cv.ondblclick = e => { if (!C) return; if (Z.k > 1) zoomTo(1); else zoomTo(MAP_ZOOM.start, ...at(e)); };
    cv.onwheel = e => { if (!C || (Z.k <= 1 && e.deltaY > 0)) return; e.preventDefault(); zoomTo(Math.max(1, Z.k) * (e.deltaY < 0 ? MAP_ZOOM.wheel : 1 / MAP_ZOOM.wheel), ...at(e)); };
    cv.onpointerdown = e => { if (Z.k <= 1) return; drag = at(e); cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = e => { if (!drag) return; const p = at(e), k = fit(cv).s * Z.k;
      if (Z.follow && Math.hypot(p[0] - drag[0], p[1] - drag[1]) < 6 * U) return;
      Z.follow = false; Z.x -= (p[0] - drag[0]) / k; Z.z -= (p[1] - drag[1]) / k; drag = p; zoomUi(); };
    cv.onpointerup = () => { drag = null; };
    $('cmpZoomIn').onclick = () => C && zoomTo(Math.max(1, Z.k) < 1.5 ? MAP_ZOOM.start : Z.k + 1);
    $('cmpZoomOut').onclick = () => zoomTo(Z.k - 1);
    $('cmpFollow').onclick = () => { Z.follow = !Z.follow; zoomUi(); };
    zoomUi(); }

  // the delta and both speeds over the lap, where the replay is
  function drawGraph(sMe) {
    const cv = $('cmpGraph'), g = cv.getContext('2d'), W = cv.width, H = cv.height, N = D.track.N, d = C.d, dh = H * 0.4, top = 14 * U;
    g.clearRect(0, 0, W, H);
    let dmax = 0.2; for (const v of d) if (Number.isFinite(v)) dmax = Math.max(dmax, Math.abs(v));
    const X = i => i / N * W, Yd = v => top + (dh - top) / 2 - v / dmax * (dh - top) / 2 * 0.9;
    const s0 = dh + 16 * U, Ys = v => H - 6 * U - (v - 50) / 300 * (H - 6 * U - s0);
    g.strokeStyle = '#2a313b'; g.lineWidth = U;
    g.beginPath(); g.moveTo(0, Yd(0)); g.lineTo(W, Yd(0)); g.stroke();
    g.setLineDash([4 * U, 4 * U]);
    for (const sc of D.L.sectors.slice(1)) { g.beginPath(); g.moveTo(X(sc.from), 0); g.lineTo(X(sc.from), H); g.stroke(); }
    g.setLineDash([]);
    const line = (f, col) => { g.beginPath(); let on = false; for (let i = 0; i <= N; i++) { const v = f(i); if (!Number.isFinite(v)) { on = false; continue; } on ? g.lineTo(X(i), v) : g.moveTo(X(i), v); on = true; } g.strokeStyle = col; g.lineWidth = 2 * U; g.stroke(); };
    line(i => Yd(d[i]), '#f2f3f0');
    line(i => { const v = C.ref.kmh(Math.min(i, N - 1)); return v === null ? NaN : Ys(v); }, COL.ref);
    line(i => { const v = C.me.kmh(Math.min(i, N - 1)); return v === null ? NaN : Ys(v); }, COL.me);
    g.font = `800 ${11 * U}px "Saira Condensed", Arial, sans-serif`; g.fillStyle = '#959ca5'; g.textBaseline = 'top';
    g.fillText(`DELTA · ▲ LOST  ▼ GAINED  (±${dmax.toFixed(2)} s)`, 8 * U, 3 * U); g.fillText('SPEED · 50–350 KM/H', 8 * U, dh + 3 * U);
    D.L.sectors.forEach((sc, k) => { if (k) g.fillText('S' + (k + 1), X(sc.from) + 6 * U, 3 * U); });
    g.strokeStyle = COL.sector; g.lineWidth = 2 * U; g.beginPath(); g.moveTo(X(sMe), 0); g.lineTo(X(sMe), H); g.stroke();
  }
  // the delta and the gap (both views)
  function readouts(cmp) {
    const dEl = $('cmpDelta'); dEl.textContent = gapText(cmp.delta); dEl.className = 'num ' + gapCls(cmp.delta);
    const m = Math.round(cmp.ahead * D.track.ds);
    $('cmpGap').textContent = sync === 'distance' ? 'Same spot' : Math.abs(m) < 2 ? 'Side by side' : `${C.short} ${Math.abs(m)} m ${m > 0 ? 'ahead' : 'behind'}`;
    $('cmpGapNote').textContent = sync === 'distance' ? 'the gap is in time only' : 'at the same time into the lap';
    $('cmpClock').textContent = `${clock(T)} / ${clock(C.me.time)}`;
    const p = Math.round(T / C.me.time * 1000); if (+$('cmpPos').value !== p && document.activeElement !== $('cmpPos')) $('cmpPos').value = p;
  }
  // the 3D view's boxes: the virtual lap, the mini map, the speeds, the other car's tag
  function draw3dBoxes(cmp, out) {
    const { me, ref } = C, sMe = cmp.sMe, k = nextCorner(sMe), gaps = miniGaps(picked().me.tr, picked().ref.trace);
    $('cmpVl').innerHTML = `<div class="vl-head"><span>VIRTUAL LAP</span><span>${D.L.corners[k].name}</span></div>`
      + `<div class="vl-rows"><i class="ana-dot me"></i><span>YOU</span><span class="num">${clock(T)}</span><i class="ana-dot ref"></i><span>${C.name}</span><b class="num ${gapCls(cmp.delta)}">${gapText(cmp.delta)}</b></div>`
      + `<div class="vl-minis">${D.L.minis.map((m, i) => `<i style="background:${m.to <= sMe ? tone(gaps[i], 1) : m.from <= sMe ? COL.now : ''}"></i>`).join('')}</div>`;
    const pm = me.poseAt(T), pr = ref.poseAt(cmp.tRef);
    drawCircuit($('cmpMini'), () => null, { badges: false, width: 3, sectorsToo: false, dots: [{ x: pr.x, z: pr.z, col: COL.ref, r: 5 }, { x: pm.x, z: pm.z, col: COL.me, r: 5 }] });
    const sp = (who, cls, kmh, gear) => `<div><span class="who" style="color:${cls}">${who}</span><br><b class="num">${num(kmh)}</b> <small>km/h${gear ? ' · G' + gear : ''}</small></div>`;
    $('cmpSpeeds').innerHTML = sp('YOU', COL.me, me.kmh(sMe), me.gear(sMe)) + sp(C.short, COL.ref, ref.kmh(cmp.sRef), ref.gear(cmp.sRef));
    readouts(cmp);
    // the tag over the other car (or, out of view, a chip at the bottom saying where it is)
    const tag = $('cmpTag3d'), m = Math.round(cmp.ahead * D.track.ds), text = `<div class="t"><span>${C.short}</span><span class="${gapCls(cmp.delta)}">${gapText(cmp.delta)}</span><span>${sync === 'distance' ? 'same spot' : Math.abs(m) + ' m'}</span></div><i></i>`;
    if (tag.dataset.html !== text) { tag.innerHTML = text; tag.dataset.html = text; }
    tag.hidden = false; tag.classList.toggle('far', !out.tag);
    const at = out.tag ?? { x: innerWidth / 2, y: innerHeight * 0.74 };
    tag.style.left = at.x + 'px'; tag.style.top = at.y + 'px';
    if (!out.tag) tag.querySelector('.t span:last-child').textContent = `${Math.abs(m)} m ${m > 0 ? 'ahead' : 'behind'}`;
  }

  // ---- tabs, views and the replay controls ----
  const in3d = () => open && tab === 'cmp' && view === '3d' && !!C;
  function showTab() {
    $('anaTabOver').setAttribute('aria-selected', String(tab === 'over')); $('anaTabCmp').setAttribute('aria-selected', String(tab === 'cmp'));
    $('anaOver').hidden = tab !== 'over'; $('anaCmp').hidden = tab !== 'cmp' || !C; $('anaView').hidden = tab !== 'cmp';
    for (const b of $('anaView').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === view));
    $('cmp2d').hidden = view !== '2d'; $('cmp3d').hidden = view !== '3d';
    if (tab === 'cmp' && !C && !$('anaNote').textContent) $('anaNote').textContent = 'Pick two laps to compare.';
    const on3d = in3d();
    $('anaOv').classList.toggle('ana-3d', on3d);
    if (on3d && !R3.on) { R3.enter(models(), Design.data.car); hudWas = !$('hud').hidden; Screens.hud(false); }
    if (!on3d && R3.on) { R3.leave(); if (hudWas) Screens.hud(true); }
    if (!on3d) $('cmpTag3d').hidden = true;
    jump = dirty = true;
  }
  function setPlaying(on) {
    playing = on && !!C;
    if (playing && T >= C.me.time - 0.01) T = 0;
    $('cmpPlayIcon').setAttribute('d', playing ? 'M7 4h4v16H7zM13 4h4v16h-4z' : 'M7 4l13 8-13 8z');
    $('cmpPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  const chips = (el, items, on, pick) => {
    el.replaceChildren(...items.map(([id, label]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.id = id;
      b.onclick = () => { pick(id); for (const x of el.children) x.setAttribute('aria-pressed', String(x.dataset.id === id)); }; b.setAttribute('aria-pressed', String(id === on)); return b; }));
  };
  chips($('cmpRate'), REPLAY.rates.map(r => [String(r), r + '×']), '1', id => { rate = +id; });
  chips($('cmpCams'), Object.entries(CAMS).map(([id, [l]]) => [id, l]), camera, id => { camera = id; $('cmpCamNote').textContent = CAMS[id][1]; jump = true; });
  $('cmpCamNote').textContent = CAMS[camera][1];
  for (const b of $('cmpSync').querySelectorAll('button')) b.onclick = () => {
    sync = b.dataset.s; for (const x of $('cmpSync').children) x.setAttribute('aria-pressed', String(x === b)); jump = dirty = true; };
  $('cmpPlay').onclick = () => setPlaying(!playing);
  $('cmpPos').oninput = e => { if (!C) return; T = +e.target.value / 1000 * C.me.time; jump = dirty = true; };
  // click / drag on the traces = go there
  { const cv = $('cmpGraph'); let down = false;
    const go = e => { if (!C) return; const r = cv.getBoundingClientRect(), s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D.track.N; T = C.me.timeAt(s); jump = dirty = true; };
    cv.onpointerdown = e => { down = true; cv.setPointerCapture(e.pointerId); go(e); }; cv.onpointermove = e => { if (down) go(e); }; cv.onpointerup = () => { down = false; }; }
  $('anaTabOver').onclick = () => { tab = 'over'; setPlaying(false); showTab(); };
  $('anaTabCmp').onclick = () => { tab = 'cmp'; showTab(); };
  for (const b of $('anaView').querySelectorAll('button')) b.onclick = () => { view = b.dataset.v; showTab(); };

  function show(where) {
    const modified = SIM.isModified(game.garage.mods, playerClass());
    if (where === 'start') D = sectors.menuData(track(), modified, raceAero(game.setup).activeAero);
    else D = sectors.data || sectors.menuData(track(), modified, raceAero(game.setup).activeAero);
    if (!D) return;
    from = Screens.current(); Screens.show(null);
    const lc = lapChoices(); laps = lc.list; refs = refChoices();
    $('anaLap').replaceChildren(...laps.map((o, k) => new Option(o.label, String(k))));
    $('anaRef').replaceChildren(...refs.map((o, k) => new Option(o.label, String(k))));
    $('anaLap').value = String(Math.max(0, lc.pick)); $('anaRef').value = '0';
    $('anaCtx').textContent = D.track.name;
    $('anaOv').hidden = false; open = true; T = 0; setPlaying(false); $('anaClose').focus();
    render();
  }
  function close() {
    if (!open) return;
    open = false; setPlaying(false); showTab();
    $('anaOv').hidden = true; if (from) Screens.show(from);
  }
  $('anaLap').onchange = $('anaRef').onchange = () => render();
  $('anaClose').onclick = close;
  return {
    show, close, get open() { return open; }, get view3d() { return in3d(); },
    rebuild: design => R3.rebuild(design),
    // every frame while open: the replay moves on; true = the 3D view drew the scene (main.js draws nothing else)
    frame(dt) {
      if (!open || tab !== 'cmp' || !C) return false;
      if (playing) { T += dt * rate; if (T >= C.me.time) { T = C.me.time; setPlaying(false); } dirty = true; }
      const cmp = compareAt(C.me, C.ref, T, sync);
      if (view === '3d') {
        const out = R3.frame(dt, { track: D.track, me: C.me, ref: C.ref, T, cmp, camera, jump });
        draw3dBoxes(cmp, out); jump = false; return true;
      }
      if (dirty) { draw2d(cmp); dirty = false; }
      jump = false;
      return false;
    },
  };
}
