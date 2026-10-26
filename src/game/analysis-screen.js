// Lap analysis (2026-10-26): one of your laps against a reference lap (the fastest of yours, the AI's and a loaded
// one by default; any AI level or your best can be picked), split into sectors and corners: a map coloured by where the
// time went, the sector times with your bests and the best anyone has, how each corner was driven (braking point,
// entry / slowest / exit speed, back on full throttle), and the session's pace (average, spread, laps near your best,
// theoretical best, the gap to every AI level). Opened from the pause menu, the results and the start menu (your best
// there). ctx: { game, sectors (sector-timing.js), aiLapOf(id, aero), track() }
import { SIM } from '../sim/index.js';
import { RACE_SETUP } from './config.js';
import { $, fmtTime } from './util.js';
import { Screens } from './screens.js';
import { raceAero } from './setup-store.js';
import { ghostDriver } from './ai-ghosts.js';
import { ANALYSIS, traceFromAi, miniTimes, sectorTimes, cornerMetrics, sessionPace, theoretical } from './lap-analysis.js';

const gapText = d => !Number.isFinite(d) ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(3);
const gapCls = d => !Number.isFinite(d) ? '' : d < -0.0005 ? 'faster' : d > 0.0005 ? 'slower' : '';
const secs = t => Number.isFinite(t) ? t.toFixed(3) : '–';
const both = (a, b, f = v => Math.round(v)) => `${a === null || !Number.isFinite(a) ? '–' : f(a)} <small>/ ${b === null || !Number.isFinite(b) ? '–' : f(b)}</small>`;
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));

export function createAnalysis({ game, sectors, aiLapOf, track }) {
  let open = false, from = null, D = null, laps = [], refs = [];

  // the laps you can look at: this session's (newest first, the fastest valid one picked) and your all-time best
  function lapChoices() {
    const out = D.laps.map((tr, k) => ({ tr, label: `Lap ${tr.lap ?? k + 1}  ${fmtTime(tr.time)}${tr.invalid ? '  (invalid)' : ''}${tr.pit ? '  (pit)' : ''}${tr.start ? '  (from the grid)' : ''}` })).reverse();
    const valid = D.laps.filter(l => !l.invalid), best = valid.length ? valid.reduce((a, l) => l.time < a.time ? l : a) : null;
    if (D.bests.best) out.push({ tr: D.bests.best, label: `Your best ever  ${fmtTime(D.bests.best.time)}` });
    return { list: out, pick: best ? out.findIndex(o => o.tr === best) : out.length - 1 };
  }
  // the laps to compare with: the fastest (sector-timing's reference) first, then every AI level
  function refChoices() {
    const aero = raceAero(game.setup).activeAero, list = [];
    if (D.ref.ref) list.push({ ...D.ref.ref, label: `Fastest: ${D.ref.ref.name}  ${fmtTime(D.ref.ref.trace.time)}` });
    for (const c of D.candidates) if (c !== D.ref.ref) list.push({ ...c, label: `${c.name}  ${fmtTime(c.trace.time)}` });
    for (const [id, label] of RACE_SETUP.choices.ai) {
      if (id === 'alien') continue;                                    // (a candidate already)
      const lap = aiLapOf(id, aero); if (lap) list.push({ id, name: `${label} · ${ghostDriver().code}`, trace: traceFromAi(lap), label: `${label} · ${ghostDriver().code}  ${fmtTime(lap.time)}` });
    }
    return list;
  }

  function render() {
    const me = laps[+$('anaLap').value]?.tr, ref = refs[+$('anaRef').value];
    const L = D.L, T = D.track;
    $('anaNote').textContent = !me ? 'Drive a lap first: every lap you complete is timed by sector and corner.' : !ref ? 'No lap to compare with yet.' : '';
    drawMap(me, ref);
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
    const mc = me ? cornerMetrics(me, L, T.ds) : [], rc = ref ? cornerMetrics(ref.trace, L, T.ds) : [];
    $('anaCorners').innerHTML = L.corners.map((c, k) => {
      const a = mc[k], b = rc[k], d = a && b ? a.time - b.time : NaN;
      return `<tr><td>${c.name}</td><td class="r num">${a ? secs(a.time) : '–'}</td><td class="r num ${gapCls(d)}">${gapText(d)}</td>`
        + `<td class="r num">${both(a?.brakeAt, b?.brakeAt)}</td><td class="r num">${both(a?.entry, b?.entry)}</td><td class="r num">${both(a?.min, b?.min)}</td>`
        + `<td class="r num">${both(a?.exit, b?.exit)}</td><td class="r num">${both(a?.fullAt, b?.fullAt, signed)}</td></tr>`;
    }).join('');
    $('anaCorners').closest('table').querySelector('caption').textContent = ref ? `you / ${ref.name}: brakes = metres before the apex, speeds in km/h, full gas = metres after the apex (− = before)` : '';
    renderPace();
  }

  function renderPace() {
    if (!D.laps.length) { $('anaPace').innerHTML = '<p class="gpu">Session pace appears here once you have driven laps in a race or time trial.</p>'; return; }
    const aero = raceAero(game.setup).activeAero, ai = {};
    for (const [id] of RACE_SETUP.choices.ai) { const lap = aiLapOf(id, aero); if (lap) ai[id] = lap.time; }
    const P = sessionPace(D.laps, D.L, ai), label = Object.fromEntries(RACE_SETUP.choices.ai);
    const stat = (k, v, title = '') => `<div title="${title}"><span class="lbl">${k}</span><b class="num">${v}</b></div>`;
    $('anaPace').innerHTML = `<div class="ana-stats">${[
      stat('Laps', `${P.valid} / ${P.laps}`, 'valid laps / all laps'),
      stat('Best', fmtTime(P.best)),
      stat('Average', P.avg ? fmtTime(P.avg) : '–', `your valid flying laps within ${Math.round((ANALYSIS.outlier - 1) * 100)} % of your best (no pit laps)`),
      stat('Spread', P.sd !== null ? '±' + P.sd.toFixed(3) : '–', 'standard deviation of those laps: lower = more consistent'),
      stat('Near best', `${P.within}`, `laps within ${ANALYSIS.within} s of your best`),
      stat('Theoretical', P.theo ? fmtTime(P.theo) : '–', 'this session: your best mini-sectors together'),
    ].join('')}</div>`
      + `<table class="res ana-ai"><thead><tr><th>Gap to the AI</th><th class="r">Lap</th><th class="r">Gap</th><th class="r">Pace</th></tr></thead><tbody>${
        Object.entries(P.gaps).map(([id, g]) => { const d = P.best - g.time;
          return `<tr><td>${label[id] || id}</td><td class="r num">${fmtTime(g.time)}</td><td class="r num ${gapCls(d)}">${gapText(d)}</td><td class="r num ${gapCls(d)}">${g.pct === null ? '–' : (g.pct > 0 ? '+' : '−') + Math.abs(g.pct).toFixed(2) + ' %'}</td></tr>`; }).join('')
      }</tbody></table>`;
  }

  // the circuit, each mini-sector coloured by your gap to the reference there (green = gained, red = lost; stronger
  // the more), corner names at their apexes, the sector lines
  function drawMap(me, ref) {
    const cv = $('anaMap'), g = cv.getContext('2d'), T = D.track, L = D.L, { N, PX, PZ } = T, { minX, maxX, minZ, maxZ } = T.bounds;
    const W = cv.width, H = cv.height, P = 30, s = Math.min((W - 2 * P) / (maxX - minX), (H - 2 * P) / (maxZ - minZ));
    const x = v => P + (v - minX) * s + (W - 2 * P - (maxX - minX) * s) / 2, z = v => P + (v - minZ) * s + (H - 2 * P - (maxZ - minZ) * s) / 2;
    g.clearRect(0, 0, W, H); g.lineJoin = g.lineCap = 'round';
    const path = (a, b) => { g.beginPath(); for (let i = a; i <= b; i++) { const k = Math.min(i, N - 1) % N; i === a ? g.moveTo(x(PX[k]), z(PZ[k])) : g.lineTo(x(PX[k]), z(PZ[k])); } };
    path(0, N); g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 14; g.stroke();
    const mm = me ? miniTimes(me, L) : null, rm = ref ? miniTimes(ref.trace, L) : null;
    L.minis.forEach((m, k) => {
      const d = mm && rm ? mm[k] - rm[k] : NaN, a = Math.min(1, Math.abs(d) / 0.3);
      g.strokeStyle = !Number.isFinite(d) ? '#e9ebe6' : d < 0 ? `rgba(54,210,127,${0.35 + 0.65 * a})` : `rgba(255,70,60,${0.35 + 0.65 * a})`;
      g.lineWidth = 7; path(m.from, m.to); g.stroke();
    });
    // sector lines and the start line
    g.strokeStyle = '#ffc21a'; g.lineWidth = 2;
    for (const sc of L.sectors) { const i = sc.from, k = (i + 1) % N, nx = -(PZ[k] - PZ[i]), nz = PX[k] - PX[i], l = Math.hypot(nx, nz) || 1;
      g.beginPath(); g.moveTo(x(PX[i]) - nx / l * 10, z(PZ[i]) - nz / l * 10); g.lineTo(x(PX[i]) + nx / l * 10, z(PZ[i]) + nz / l * 10); g.stroke(); }
    g.font = '600 13px "Saira Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // (sector names beside the middle of each sector, off to one side of the road: clear of the corner badges)
    const { NX, NZ } = T;
    L.sectors.forEach((sc, k) => { const i = (sc.from + Math.floor((sc.to - sc.from) / 2)) % N; g.fillStyle = '#ffc21a';
      g.fillText('S' + (k + 1), x(PX[i] + NX[i] * 22 / s), z(PZ[i] + NZ[i] * 22 / s)); });
    L.corners.forEach((c, k) => {
      const d = mm && rm ? mm[L.minis.findIndex(m => m.corner === k)] - rm[L.minis.findIndex(m => m.corner === k)] : NaN;
      g.fillStyle = 'rgba(10,13,17,.85)'; g.beginPath(); g.arc(x(PX[c.apex]), z(PZ[c.apex]), 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = !Number.isFinite(d) ? '#e9ebe6' : d < 0 ? '#5ff0a0' : '#ff8a80'; g.fillText(c.name, x(PX[c.apex]), z(PZ[c.apex]) + 1);
    });
  }

  function show(where) {
    if (where === 'start') D = sectors.menuData(track(), SIM.isModified(game.garage.mods), raceAero(game.setup).activeAero);
    else D = sectors.data || sectors.menuData(track(), SIM.isModified(game.garage.mods), raceAero(game.setup).activeAero);
    if (!D) return;
    from = Screens.current(); Screens.show(null);
    const lc = lapChoices(); laps = lc.list; refs = refChoices();
    $('anaLap').replaceChildren(...laps.map((o, k) => new Option(o.label, String(k))));
    $('anaRef').replaceChildren(...refs.map((o, k) => new Option(o.label, String(k))));
    $('anaLap').value = String(Math.max(0, lc.pick)); $('anaRef').value = '0';
    $('anaTitle').innerHTML = `Lap analysis <em>${D.track.name}</em>`;
    $('anaOv').hidden = false; open = true; $('anaClose').focus();
    render();
  }
  function close() { if (!open) return; open = false; $('anaOv').hidden = true; if (from) Screens.show(from); }
  $('anaLap').onchange = $('anaRef').onchange = () => render();
  $('anaClose').onclick = close;
  return { show, close, get open() { return open; } };
}
