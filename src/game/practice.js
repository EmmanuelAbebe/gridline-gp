// Practice mode (2026-11-12; user: "practise specific turns and sections of a circuit, timed, against the AI or yourself";
// then, of the canvas mock-ups "Gridline practice mode": "i love all the moc practice screens implement them as is").
// The four screens: A = the start menu's practice page ON THE MAP (drag the ring / square, quick picks, the choices),
// B = BY CORNER (where your best lap loses time to the ALIEN, tick corners to join them), C = on track (a run's clock,
// its parts, the runs so far, where your best and the ALIEN brake, the ghost), D = the summary after the runs.
// A run: your car is put PRACTICE.lead m before the ring at your best lap's speed and gear there (or from rest just
// before it), held a moment, then timed from the ring to the square; it goes back by itself when you finish or go off
// (or you drive on round to the next one). Nothing of it counts for lap records, ghosts or the leaderboard.
// The pure part (sections, parts, runs, numbers, saving): practice-core.js.
// ctx: { game, track() (the menu's circuit), sectors (sector-timing.js), aiLapOf(id, aero), start() (a practice race:
//   main.js newRace), toMenu(), menuPage() (the start menu's practice page), startTrial(), compare(trace, label),
//   setMinimapSection(sec | null), snap(c) (the camera on the car at once), showMessage(m) }
import * as THREE from 'three';
import { SIM } from '../sim/index.js';
import { CONFIG, PHASE } from './config.js';
import { $ } from './util.js';
import { Settings } from './settings.js';
import { Display } from './display.js';
import { Design } from './design.js';
import { CarModels } from './car-models.js';
import { Hud } from './hud.js';
import { Screens } from './screens.js';
import { Input } from './input.js';
import { roadPose, savePoses } from './pose.js';
import { playerDriver } from './garage-store.js';
import { playerClass, classUi, allClasses } from './car-class.js';
import { raceAero } from './setup-store.js';
import { zoneTag, lapClass } from './aero-zones.js';
import { traceFromAi, cornerMetrics } from './lap-analysis.js';
import { replayOf } from './lap-replay.js';
import { ghostDriver } from './ai-ghosts.js';
import * as P from './practice-core.js';
import { createPracticeAnalysis } from './practice-analysis.js';

const { EV } = SIM;
const KEY = CONFIG.storageKeys.practice;
const MAP = { w: 720, h: 560, pad: 34 };              // the map's drawing box (A), scaled to fit
const SMALL = { w: 356, h: 240, pad: 14 };            // B's map
const AGAINST = { best: 'YOUR BEST RUN', alien: 'ALIEN GHOST', legend: 'LEGEND GHOST', none: 'NOBODY' };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const s3 = t => Number.isFinite(t) ? t.toFixed(3) : '—';
const sign = (d, n = 3) => !Number.isFinite(d) ? '' : Math.abs(d) < 0.5 * 10 ** -n ? (0).toFixed(n) : (d < 0 ? '−' : '+') + Math.abs(d).toFixed(n);
const chip = (text, on, onclick) => { const b = el('button', 'pr-chip', text); b.type = 'button'; b.setAttribute('aria-pressed', String(!!on)); b.onclick = onclick; return b; };

export function createPractice(ctx) {
  const { game } = ctx;
  const store = P.loadPractice(Settings.get(KEY));
  // (storage full: the best runs' telemetry goes, then their per-sample runs; the times and ghosts stay)
  const save = () => {
    const put = () => Settings.set(KEY, P.practiceJson(store));
    if (put()) return;
    for (const b of Object.values(store.best)) if (b) delete b.tel;
    if (put()) return;
    for (const b of Object.values(store.best)) if (b) delete b.s;
    put();
  };
  let view = 'map', sec = null, data = null, dataFor = '', aiTimer = 0;

  // ---- the menu's data for its circuit: the split, your best lap, the ALIEN's (else LEGEND's), corner by corner ----
  function menuData() {
    const T = ctx.track(), aero = raceAero(game.setup).activeAero, cls = playerClass(), modified = SIM.isModified(game.garage.mods, cls);
    const zones = zoneTag(T, aero), key = [T.id, aero, cls.id, modified, zones, game.setup.tyreTemp, game.garage.tyres.start].join('|');
    if (data && dataFor === key && data.aiDone) return data;
    if (!data || dataFor !== key) {
      const L = SIM.buildSectors(T), best = ctx.sectors.bestsFor(T, L, modified, zones, cls.id).best ?? null;
      data = { T, L, best, ref: null, refName: 'ALIEN', rows: P.cornerTable(L, best, null, T.ds), cls: lapClass(modified, zones, cls.id), aiDone: false };
      dataFor = key;
      // (the AI laps take a moment the first time on a circuit: the page shows first, they fill in after)
      clearTimeout(aiTimer);
      aiTimer = setTimeout(() => {
        if (dataFor !== key) return;
        const alien = ctx.aiLapOf('alien', aero), legend = alien ? null : ctx.aiLapOf('legend', aero);
        Object.assign(data, { ref: traceFromAi(alien || legend), refName: alien ? 'ALIEN' : 'LEGEND', aiDone: true });
        data.rows = P.cornerTable(data.L, data.best, data.ref, data.T.ds);
        if (!sec || !store.last[data.T.id]) sec = defaultSection();
        render();
      }, 30);
    }
    return data;
  }
  function defaultSection() {
    const D = data, w = D.ref && D.best ? P.weakestStretch(D.rows) : null;
    return w ? P.sectionFromCorners(D.L, w[0], w[1]) : P.sectionFromCorners(D.L, 0, Math.min(2, D.L.corners.length - 1));
  }
  function sectionNow() {
    const D = menuData(), N = D.T.N, saved = store.last[D.T.id];
    if (!sec || sec.N !== N || sec.circuit !== D.T.id) {
      const ok = saved && Number.isInteger(saved.from) && Number.isInteger(saved.to) && saved.from >= 0 && saved.from < N && saved.to >= 0 && saved.to < N;
      sec = ok ? { from: saved.from, to: saved.to } : defaultSection();
      sec.N = N; sec.circuit = D.T.id;
    }
    return sec;
  }
  function setSection(from, to) {
    const D = menuData(), N = D.T.N;
    sec = { from: SIM.wrapIdx(from, N), to: SIM.wrapIdx(to, N), N, circuit: D.T.id };
    store.last[D.T.id] = { from: sec.from, to: sec.to }; save();
    render();
  }
  const opts = store.opts;
  const setOpt = (k, v) => { opts[k] = v; save(); render(); };
  const refLabel = () => data?.refName ?? 'ALIEN';
  // your best over this section: a saved practice best (this start), else your best lap's time over it
  function yourBest(D, S) {
    const parts = P.partsOf(D.L, S), lead = P.leadSamples(D.T, opts.start === 'standing'), len = P.lengthOf(S, D.T.N);
    const saved = P.unpackRun(store.best[P.bestKey(D.T.id, D.cls, S, D.L) + '|' + opts.start], lead, len);
    const lap = D.best ? P.lapParts(D.best, S, parts, D.T.N) : null;
    const lapT = lap && Number.isFinite(lap.time) ? lap.time : null;
    return { saved, lap: lapT, time: saved && (lapT === null || saved.time < lapT) ? saved.time : lapT };
  }

  // ---- A: the map ----
  function fitter(T, box) {
    const { minX, maxX, minZ, maxZ } = T.bounds, k = Math.min((box.w - 2 * box.pad) / (maxX - minX), (box.h - 2 * box.pad) / (maxZ - minZ));
    const ox = (box.w - (maxX - minX) * k) / 2, oz = (box.h - (maxZ - minZ) * k) / 2;
    return { k, x: v => ox + (v - minX) * k, z: v => oz + (v - minZ) * k };
  }
  const pathOf = (T, F, a, n, step = 3) => {
    let d = '';
    for (let o = 0; o <= n; o += step) { const i = SIM.wrapIdx(a + Math.min(o, n), T.N); d += (d ? 'L' : 'M') + F.x(T.PX[i]).toFixed(1) + ' ' + F.z(T.PZ[i]).toFixed(1); }
    const i = SIM.wrapIdx(a + n, T.N); return d + 'L' + F.x(T.PX[i]).toFixed(1) + ' ' + F.z(T.PZ[i]).toFixed(1);
  };
  let drag = null;
  function drawMap(svg, box, big) {
    const D = menuData(), T = D.T, S = sectionNow(), N = T.N, F = fitter(T, box), len = P.lengthOf(S, N);
    svg.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
    const kids = [svgEl('path', { class: 'trk', d: pathOf(T, F, 0, N) })];
    if (big) {
      const lead = P.leadSamples(T, opts.start === 'standing');
      kids.push(svgEl('path', { class: 'lead', d: pathOf(T, F, S.from - lead, lead, 2) }));
    }
    kids.push(svgEl('path', { class: 'sec', d: pathOf(T, F, S.from, len, 2) }));
    if (big) {
      // the start / finish line, the corners' names (outside each bend; click = snap), the lead-in's start
      const nx = T.NX[0], nz = T.NZ[0], sx = F.x(T.PX[0]), sz = F.z(T.PZ[0]);
      kids.push(svgEl('line', { class: 'sfl', x1: sx - nx * 9, y1: sz - nz * 9, x2: sx + nx * 9, y2: sz + nz * 9 }));
      const sf = svgEl('text', { class: 'sf', x: sx + 12, y: sz - 12 }); sf.textContent = 'START / FINISH'; kids.push(sf);
      const inside = new Set(P.cornersIn(D.L, S));
      D.L.corners.forEach((c, k) => {
        const i = c.apex, out = -Math.sign(T.K[i] || 1) * 22;
        const t = svgEl('text', { class: 'cn' + (inside.has(k) ? ' in' : ''), x: F.x(T.PX[i] + T.NX[i] * out / F.k), y: F.z(T.PZ[i] + T.NZ[i] * out / F.k), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        t.textContent = c.name; t.addEventListener('click', () => snapTo(k)); kids.push(t);
      });
      const lead = P.leadSamples(T, opts.start === 'standing'), j = SIM.wrapIdx(S.from - lead, N);
      kids.push(svgEl('circle', { cx: F.x(T.PX[j]), cy: F.z(T.PZ[j]), r: 3.5, fill: '#ffc21a', 'fill-opacity': 0.7 }));
      const note = svgEl('text', { class: 'note', x: F.x(T.PX[j]) + 9, y: F.z(T.PZ[j]) - 9 });
      note.textContent = opts.start === 'standing' ? 'STANDING START HERE' : `JOIN HERE · ${P.PRACTICE.lead} M LEAD-IN`; kids.push(note);
    }
    const r = big ? 8 : 6, a = S.from, b = S.to;
    const ring = svgEl('circle', { class: 'handle ring', cx: F.x(T.PX[a]), cy: F.z(T.PZ[a]), r });
    const sq = svgEl('rect', { class: 'handle sq', x: F.x(T.PX[b]) - r, y: F.z(T.PZ[b]) - r, width: 2 * r, height: 2 * r });
    kids.push(ring, sq);
    svg.replaceChildren(...kids);
    if (!big) return;
    // dragging a handle along the track: the nearest sample to the pointer
    const toSample = e => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse());
      let bi = 0, bd = Infinity;
      for (let i = 0; i < N; i++) { const dx = F.x(T.PX[i]) - q.x, dz = F.z(T.PZ[i]) - q.y, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
      return bi;
    };
    const minLen = Math.round(60 / T.ds);
    const grab = which => e => { e.preventDefault(); drag = which; svg.setPointerCapture(e.pointerId); (which === 'ring' ? ring : sq).classList.add('drag'); };
    ring.onpointerdown = grab('ring'); sq.onpointerdown = grab('sq');
    svg.onpointermove = e => {
      if (!drag) return;
      const i = toSample(e), cur = sectionNow();
      if (drag === 'ring') { if (P.lengthOf({ from: i, to: cur.to }, N) >= minLen) setSection(i, cur.to); }
      else if (P.lengthOf({ from: cur.from, to: i }, N) >= minLen) setSection(cur.from, i);
    };
    svg.onpointerup = svg.onpointercancel = () => { drag = null; };
  }
  // a corner's name clicked: inside the section = start the timing at its braking point; else stretch the nearer end to it
  function snapTo(k) {
    const D = menuData(), N = D.T.N, S = sectionNow(), m = D.L.minis.find(x => x.corner === k);
    const inside = P.cornersIn(D.L, S).includes(k);
    if (inside) { if (P.lengthOf({ from: m.from, to: S.to }, N) > 20) setSection(m.from, S.to); return; }
    const toStart = P.lengthOf({ from: m.from, to: S.from }, N), fromEnd = P.lengthOf({ from: S.to, to: m.to }, N);
    if (toStart <= fromEnd) setSection(m.from, S.to); else setSection(S.from, m.to);
  }

  // ---- the page: A and B ----
  function sectionWords(D, S) {
    const T = D.T, N = T.N, len = P.lengthOf(S, N), c = P.cornersIn(D.L, S), m = Math.round(len * T.ds);
    const words = [`${m.toLocaleString('en')} m`, `${c.length} corner${c.length === 1 ? '' : 's'}`];
    if (T.elev) {
      const Y = i => T.elev.Y[SIM.wrapIdx(i, N)], lead = P.leadSamples(T), into = Y(S.from) - Y(S.from - lead), out = Y(S.to + lead) - Y(S.to);
      const first = c.length ? D.L.corners[c[0]].name : 'the ring', last = c.length ? D.L.corners[c[c.length - 1]].name : 'the square';
      if (Math.abs(into) > 3) words.push(`${into < 0 ? 'downhill' : 'uphill'} into ${first}`);
      if (Math.abs(out) > 3) words.push(`${out > 0 ? 'climbing' : 'dropping'} out of ${last}`);
    }
    return words.join(' · ');
  }
  function render() {
    if ($('pagePractice').hidden) return;
    const D = menuData(), S = sectionNow(), T = D.T, cls = playerClass();
    $('prCirc').textContent = `${T.name} · ${(T.N * T.ds / 1000).toFixed(2)} km`;
    // the car: every class, the picked one marked (main.js pickClass: its own setup, records and AI laps follow)
    $('prCar').replaceChildren(...allClasses().map(c => chip(classUi(c).name, c === cls, () => { ctx.pickClass(c.id); render(); })));
    $('prTabMap').setAttribute('aria-pressed', String(view === 'map')); $('prTabCorners').setAttribute('aria-pressed', String(view === 'corners'));
    $('prMapView').hidden = view !== 'map'; $('prCornerView').hidden = view !== 'corners';
    const name = P.sectionName(D.L, S, T.ds), b = yourBest(D, S), parts = P.partsOf(D.L, S);
    const ref = D.ref ? P.lapParts(D.ref, S, parts, T.N) : null, refT = ref && Number.isFinite(ref.time) ? ref.time : null;
    // the quick picks: the three sectors, the whole lap, the stretch you lose most on
    const w = D.ref && D.best ? P.weakestStretch(D.rows) : null, weak = w && P.sectionFromCorners(D.L, w[0], w[1]);
    const same = (x) => x && x.from === S.from && x.to === S.to;
    const sectors = D.L.sectors.map((s, k) => ({ from: SIM.wrapIdx(s.from, T.N), to: SIM.wrapIdx(s.to, T.N), label: `SECTOR ${k + 1}` }));
    const quick = $('prQuick'); quick.replaceChildren(quick.firstElementChild,
      ...sectors.map(x => chip(x.label, same(x), () => setSection(x.from, x.to))),
      chip('WHOLE LAP', S.from === 0 && S.to === 0, () => setSection(0, 0)),
      ...(weak ? [chip(`MY WEAKEST: ${P.sectionName(D.L, weak, T.ds)}`, same(weak), () => setSection(weak.from, weak.to))] : []));
    drawMap($('prMap'), MAP, true);
    $('prName').textContent = name; $('prSub').textContent = sectionWords(D, S);
    const tile = (label, value, cls2 = '') => { const t = el('div', 'pr-tile'); t.append(el('span', 'lbl', label), el('b', cls2, value)); return t; };
    const gap = b.time !== null && refT !== null ? b.time - refT : NaN;
    $('prTiles').replaceChildren(tile('YOUR BEST', b.time === null ? '—' : s3(b.time)), tile(refLabel(), refT === null ? (D.aiDone ? '—' : '…') : s3(refT), 'purple'),
      tile('GAP', Number.isFinite(gap) ? sign(gap) : '—', gap > 0 ? 'red' : gap < 0 ? 'green' : ''));
    $('prStart').replaceChildren(chip('ROLLING', opts.start === 'rolling', () => setOpt('start', 'rolling')), chip('STANDING', opts.start === 'standing', () => setOpt('start', 'standing')));
    $('prStartNote').textContent = opts.start === 'rolling' ? `You join ${P.PRACTICE.lead} m before the ring at your best lap's speed and gear, tyres warm.` : 'From rest just before the ring, tyres warm.';
    $('prAgainst').replaceChildren(...Object.entries(AGAINST).map(([k, t]) => chip(t, opts.against === k, () => setOpt('against', k))));
    $('prAfter').replaceChildren(chip('BACK TO THE START', opts.after === 'reset', () => setOpt('after', 'reset')), chip('DRIVE ON', opts.after === 'drive', () => setOpt('after', 'drive')));
    // B: corner by corner
    renderCorners(D, S, name);
    $('prGo').textContent = 'START PRACTICE';
    $('prGo2').textContent = `PRACTISE ${name}`;
  }
  function renderCorners(D, S, name) {
    const T = D.T, rows = D.rows, picked = new Set(P.cornersIn(D.L, S)), rn = refLabel();
    $('prRefHead').textContent = rn; $('prSlowHead').textContent = `SLOWEST · YOU / ${rn}`;
    $('prVsNote').textContent = D.best ? `your best lap vs the ${rn}, corner by corner (braking point to the next one) · in lap order` : `no lap of yours here yet: the ${rn}'s times`;
    const gaps = rows.map(r => r.gap).filter(Number.isFinite), most = Math.max(0.001, ...gaps), worst = rows.filter(r => r.gap > 0).reduce((a, r) => !a || r.gap > a.gap ? r : a, null);
    $('prRows').replaceChildren(...rows.map(r => {
      const b = el('button', 'pr-crow'); b.type = 'button'; b.setAttribute('aria-pressed', String(picked.has(r.k)));
      const kmh = v => Number.isFinite(v) ? Math.round(v) : '—';
      const loss = el('span', 'loss');
      if (r.gap > 0) { const bar = el('i', 'bar'); bar.style.width = Math.max(4, r.gap / most * 70) + 'px'; loss.append(bar); if (r === worst) loss.append(el('span', 'tagw', 'WEAKEST')); }
      else if (r.gap <= 0) loss.append(el('span', 'fast', 'FASTER'));
      b.append(el('span', 'tick', picked.has(r.k) ? '✓' : ''), el('span', 'nm', r.name), el('span', 'slow', `${kmh(r.youMin)} / ${kmh(r.refMin)} km/h`),
        el('span', 'r', s3(r.you)), el('span', 'r', s3(r.ref)), el('span', 'r ' + (r.gap > 0 ? 'red' : r.gap < 0 ? 'green' : ''), Number.isFinite(r.gap) ? sign(r.gap) : '—'), loss);
      b.onclick = () => tick(r.k);
      return b;
    }));
    drawMap($('prMapSmall'), SMALL, false);
    const ks = P.cornersIn(D.L, S);
    $('prPicked').textContent = ks.length ? ks.map(k => D.L.corners[k].name).join(' · ') : name;
    const m = Math.round(P.lengthOf(S, T.N) * T.ds), lose = ks.reduce((a, k) => a + (Number.isFinite(rows[k].gap) ? rows[k].gap : 0), 0);
    const total = rows.reduce((a, r) => a + (Number.isFinite(r.gap) ? r.gap : 0), 0);
    $('prPickedSub').textContent = D.best && D.ref ? `${m} m · you ${lose >= 0 ? 'lose' : 'gain'} ${Math.abs(lose).toFixed(3)} s here${lose > 0 && total > 0 ? `: ${Math.round(lose / total * 100)} % of your gap to the ${rn}` : ''}` : `${m} m`;
    const wk = P.weakestOf(rows, ks), words = wk === null ? [] : P.cornerWords(rows[wk].me, rows[wk].other);
    const box = $('prCornerBox');
    box.replaceChildren(...(words.length ? [el('span', 'lbl', `IN ${rows[wk].name}, AGAINST THE ${rn}`), ...words.map(([a, v]) => { const d = el('div'); d.append(el('span', '', a), el('b', '', v)); return d; })] : []));
    const order = Object.keys(AGAINST), next = order[(order.indexOf(opts.against) + 1) % order.length];
    $('prQuickOpts').replaceChildren(chip(opts.start === 'rolling' ? 'ROLLING' : 'STANDING', true, () => setOpt('start', opts.start === 'rolling' ? 'standing' : 'rolling')),
      chip(opts.against === 'none' ? 'NO GHOST' : `VS ${({ best: 'BEST RUN', alien: 'ALIEN', legend: 'LEGEND' })[opts.against]}`, opts.against !== 'none', () => setOpt('against', next)),
      chip('MORE ›', false, () => { view = 'map'; render(); }));
  }
  // B's ticks: a corner next to the picked ones joins them, an end one drops off, any other starts afresh
  function tick(k) {
    const D = menuData(), C = D.L.corners.length, ks = P.cornersIn(D.L, sectionNow());
    let a = ks[0], b = ks[ks.length - 1];
    if (!ks.length || (!ks.includes(k) && k !== (b + 1) % C && k !== (a - 1 + C) % C)) a = b = k;
    else if (k === (b + 1) % C && !ks.includes(k)) b = k;
    else if (k === (a - 1 + C) % C && !ks.includes(k)) a = k;
    else if (ks.length > 1 && k === a) a = ks[1];
    else if (ks.length > 1 && k === b) b = ks[ks.length - 2];
    else a = b = k;
    const S = P.sectionFromCorners(D.L, a, b); setSection(S.from, S.to);
  }
  $('prTabMap').onclick = () => { view = 'map'; render(); };
  $('prTabCorners').onclick = () => { view = 'corners'; render(); };
  $('prGo').onclick = $('prGo2').onclick = () => { sectionNow(); ctx.start(); };

  // ---- C: on track ----
  const ghost = CarModels.create(Display.scene, playerDriver(game.garage), Design.data.car);
  ghost.setMaterials(CarModels.ghostMaterials()); ghost.setShadows(false); ghost.setVisible(false);
  const stripMat = colour => new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const strip = colour => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, stripMat(colour)); m.visible = false; m.frustumCulled = false; m.renderOrder = 3; Display.scene.add(m); return m; };
  const mineStrip = strip(0xffc21a), refStrip = strip(0xb46cff);
  // a band across the road at sample i (1.4 m long), just above it
  function placeStrip(m, T, i) {
    const a = m.geometry.attributes.position, j = SIM.wrapIdx(i + 1, T.N), u = 1.4 / T.ds, W = T.HW + 0.3;
    const pts = [[i, -W], [i, W], [j, W], [j, -W]];
    pts.forEach(([s, lat], k) => {
      const f = s === i ? 0 : u, x = T.PX[i] + (T.PX[j] - T.PX[i]) * f + T.NX[i] * lat, z = T.PZ[i] + (T.PZ[j] - T.PZ[i]) * f + T.NZ[i] * lat;
      a.setXYZ(k, x, SIM.surfaceY(T, i, lat) + 0.07, z);
    });
    a.needsUpdate = true; m.geometry.computeBoundingSphere(); m.visible = true;
  }
  let R = null;                                  // the practice in progress (null = none)
  const holding = () => !!R && (R.state === 'ready');
  // off you go (from READY WHEN YOU ARE): the run starts at once
  function go() { if (!R || R.state !== 'ready') return false; $('pracReady').hidden = true; R.state = 'lead'; R.t = 0; Hud.flash('GO', 0.6); return true; }
  addEventListener('keydown', e => { if (e.code === 'Enter' && !e.repeat && R?.state === 'ready' && !game.paused && !game.ended && go()) e.preventDefault(); });
  const nearIdx = (T, x, z, guess) => { let bi = guess, bd = Infinity; for (let o = -40; o <= 40; o++) { const i = SIM.wrapIdx(guess + o, T.N), d = (T.PX[i] - x) ** 2 + (T.PZ[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };

  // the reference for this run: times from the ring at every window sample (the live delta), its parts, the ghost
  function refresh() {
    const { T, sec: S, lead, len, parts, W } = R, N = T.N, against = R.against;
    const best = R.runs.filter(r => Number.isFinite(r.time)).reduce((a, r) => !a || r.time < a.time ? r : a, null);
    const fromLap = tr => { if (!tr) return null; const ts = new Float32Array(W); for (let w = 0; w < W; w++) ts[w] = P.lapTimeFromRing(tr, S, SIM.wrapIdx(S.from - lead + w, N), N); return ts; };
    const fromRun = r => { const ts = new Float32Array(W); for (let w = 0; w < W; w++) ts[w] = r.run.t[w] - r.run.ring; return ts; };
    const frames = r => r.run.frames.map((v, i) => i % 4 === 0 ? v - r.run.ring : v);
    let ts = null, name = 'BEST', ghostOf = null, livery = null;
    if (against === 'alien' || against === 'legend') {
      const tr = against === 'alien' ? R.alien : R.legend;
      if (tr) { ts = fromLap(tr); name = against.toUpperCase(); const rp = replayOf(tr, T), t0 = S.from === 0 ? 0 : tr.t[S.from];
        ghostOf = tau => { let t = t0 + tau; t = ((t % tr.time) + tr.time) % tr.time; const p = rp.poseAt(t); return { ...p, idx: p.s }; };
        const d = ghostDriver(); livery = { ...game.garage.livery, color: d.color, accent: d.accent }; }
    }
    if (!ts) {
      // your best: this session's best run when quicker than the saved one, else the saved one, else your best lap
      const saved = R.saved, sess = best && (!saved || best.time < saved.time) ? best : null;
      if (sess) { ts = fromRun(sess); const F = frames(sess); ghostOf = tau => P.framePose(F, tau); }
      else if (saved) { ts = saved.ts; const F = saved.frames; ghostOf = tau => P.framePose(F, tau); }
      else if (R.bestLap) ts = fromLap(R.bestLap);
      name = 'BEST'; livery = game.garage.livery;
      if (against === 'none') ghostOf = null;
    }
    if (against === 'none') ghostOf = null;
    R.ref = { ts, name, total: ts ? ts[lead + len] : NaN, parts: ts ? parts.map(p => ts[lead + p.b] - ts[lead + p.a]) : parts.map(() => NaN) };
    R.ghostOf = ghostOf; R.ghostIdx = SIM.wrapIdx(S.from - lead, N);
    if (livery) ghost.setLivery(livery);
    // where your best (this session's best run, else your best lap) and the AI brake for each corner
    const mine = best ? P.runAsTrace(best.run, S) : R.bestLap, other = R.alien || R.legend;
    R.brakes = { mine: mine ? cornerMetrics(mine, R.L, T.ds) : null, other: other ? cornerMetrics(other, R.L, T.ds) : null, otherName: R.alien ? 'ALIEN' : 'LEGEND' };
    R.bestRun = best;
    // the racing line on the road (pref racingLine): the car you chase. An AI ghost = its lap; your best run = that run on
    // this stretch inside the ALIEN's lap; no ghost (or only a saved best, kept without its pedals) = the ALIEN's lap
    const aiTr = against === 'legend' ? R.legend || R.alien : R.alien || R.legend;
    const runFor = against === 'best' && best && (!R.saved || best.time <= R.saved.time + 1e-6) ? best : null;
    ctx.setRacingLine(aiTr ? lineOf(aiTr, runFor) : null);
  }

  // a racing line (racing-line.js: x, z, km/h, pedals at every sample) from an AI lap, with a run of yours over it
  function lineOf(tr, run) {
    const line = { x: Float32Array.from(tr.x), z: Float32Array.from(tr.z), kmh: Float32Array.from(tr.kmh), thr: Float32Array.from(tr.thr), brk: Float32Array.from(tr.brk) };
    if (run) for (let w = 0; w < R.W; w++) {
      const r = run.run; if (!Number.isFinite(r.x[w]) || !Number.isFinite(r.thr[w])) continue;
      const i = SIM.wrapIdx(R.sec.from - R.lead + w, R.T.N);
      line.x[i] = r.x[w]; line.z[i] = r.z[w]; line.kmh[i] = r.kmh[w]; line.thr[i] = r.thr[w]; line.brk[i] = r.brk[w];
    }
    return line;
  }
  // the car to the start of a run: before the ring at your best lap's speed, gear and line there (rolling), or still
  // every run waits at READY WHEN YOU ARE (the first, MORE RUNS, after a finish or going off, a restart) until you go
  function place() {
    const c = game.player, race = game.race, { T, sec: S, lead } = R, N = T.N, i = SIM.wrapIdx(S.from - lead, N);
    const src = R.bestLap || R.alien || R.legend, standing = R.standing;
    const has = src && Number.isFinite(src.x?.[i]) && Number.isFinite(src.z?.[i]) && Number.isFinite(src.h?.[i]);
    const lat = T.RO ? T.RO[i] : 0;
    const x = has ? src.x[i] : T.PX[i] + T.NX[i] * lat, z = has ? src.z[i] : T.PZ[i] + T.NZ[i] * lat, h = has ? src.h[i] : Math.atan2(T.TZ[i], T.TX[i]);
    const v = standing ? 0 : src && Number.isFinite(src.kmh[i]) ? src.kmh[i] / 3.6 : (T.VP ? T.VP[i] * 0.85 : 40);
    const gear = standing ? 1 : src?.gear && Number.isFinite(src.gear[i]) && src.gear[i] > 0 ? src.gear[i] : c.gear;
    Object.assign(c, { x, z, h, v, vy: 0, yawRate: 0, ax: 0, ay: 0, steer: 0, steerIn: null, sa: null, relaxF: null, relaxR: null, frontLock: 0, rearLock: 0, rearSpin: 0,
      slideF: 0, slideR: 0, lockF: false, lockR: false, spinR: false, air: null, upset: null, beached: false, beachedAt: 0, stuckT: 0, dirt: 0, gravelDepth: 0, damp: null,
      gear, shiftT: 0, downQueue: 0, drive: 0, thr: 0, brake: 0, movedOff: true, revT: 0, aeroOpen: 0, aeroWant: false, cutRun: 0, lapInvalid: false,
      wallHit: false, touching: false, offTrack: false, surface: 'track', boostOn: false, pit: null, pitRequest: false });
    c.soc = race.energy ? race.energy.perLap : c.spec.cls.ers.store * c.spec.cls.ers.start;
    if (SIM.rpmAt) c.rpm = Math.min(c.spec.cls.car.engine.redline ?? Infinity, SIM.rpmAt(v, gear, c.spec));   // (the dash while held)
    if (race.tyreTemp) { const win = c.spec.cls.compounds[c.compound]?.window ?? [90, 110]; c.tyreT = SIM.tyreSet((win[0] + win[1]) / 2, c.compound, c.spec.cls); }
    let bi = i, bd = Infinity; for (let o = -30; o <= 30; o++) { const k = SIM.wrapIdx(i + o, N), d = (T.PX[k] - x) ** 2 + (T.PZ[k] - z) ** 2; if (d < bd) { bd = d; bi = k; } }
    c.idx = bi; c.lat = (x - T.PX[bi]) * T.NX[bi] + (z - T.PZ[bi]) * T.NZ[bi];
    savePoses([c]); ctx.snap(c);
    R.rec = P.createRunRecorder(T, S, lead); R.state = 'ready'; R.t = 0; R.off = false; R.still = 0; R.gasUp = false;
    refresh();
    readyLine(); $('pracReady').hidden = false;
  }
  // the prompt's line about the run before: its time and the gap, or where it went off (purple = the session's best)
  function readyLine() {
    const last = R.runs[R.runs.length - 1], el = $('prReadyLast');
    el.className = '';
    if (!last) { el.textContent = `RUN 1 · ${R.name}`; return; }
    if (last.off) { el.textContent = `LAST RUN · OFF AT ${String(last.off).toUpperCase()}`; el.className = 'off'; return; }
    const d = last.time - R.ref.total, best = Math.min(...R.runs.filter(r => Number.isFinite(r.time)).map(r => r.time));
    el.textContent = `LAST RUN · ${s3(last.time)}${Number.isFinite(d) ? '  ' + sign(d, 2) : ''}`;
    if (last.time <= best) el.className = 'best';
  }
  // DRIVE ON: a new run starts as the car comes round to the start of the window
  function startHere() { R.rec = P.createRunRecorder(R.T, R.sec, R.lead); R.state = 'lead'; R.t = 0; R.off = false; R.still = 0; refresh(); }

  function finish() {
    const run = R.rec.run, time = P.runTime(run, R.lead + R.len), parts = P.runParts(run, R.parts), r = { time, parts, off: null, run };
    const d = time - R.ref.total;
    R.runs.push(r); R.last = r;
    if (!R.saved || time < R.saved.time) {
      const before = R.saved?.time ?? null;
      store.best[R.key] = P.packRun(r); save();
      R.saved = P.unpackRun(store.best[R.key], R.lead, R.len);
      ctx.showMessage({ toast: `New best run ${s3(time)}${before !== null ? `  (${sign(time - before)})` : ''}`, kind: 'purple' });
    } else Hud.flash(`${s3(time)}${Number.isFinite(d) ? '  ' + sign(d, 2) : ''}`, 1.2);
    next(P.PRACTICE.resetAfter);
  }
  function off(why) {
    const run = R.rec.run;
    if (Number.isFinite(run.ring)) {
      const parts = P.runParts(run, R.parts), at = R.rec.last - R.lead, p = R.parts.find(q => at >= q.a && at < q.b) ?? R.parts[R.parts.length - 1];
      R.runs.push({ time: null, parts, off: why || p.name, run });
      ctx.showMessage({ toast: `Off at ${why || p.name}`, kind: 'warn', secs: 1.2 });
    }
    next(P.PRACTICE.offReset);
  }
  function next(wait) {
    if (R.after === 'reset') { R.state = 'wait'; R.wait = wait; } else R.state = 'free';
    R.shown = -1;
  }

  function begin(race, player) {
    const T = race.track, S = sectionNow(), L = SIM.buildSectors(T), standing = opts.start === 'standing', lead = P.leadSamples(T, standing), len = P.lengthOf(S, T.N);
    const zones = zoneTag(T, race.activeAero), cls = lapClass(player.spec.modified, zones, race.carClass.id);
    const key = P.bestKey(T.id, cls, S, L) + '|' + opts.start;
    R = { T, L, sec: { from: S.from, to: S.to }, name: P.sectionName(L, S, T.ds), parts: P.partsOf(L, S), lead, len, W: lead + len + 1, standing, key, cls,
      saved: P.unpackRun(store.best[key], lead, len), bestLap: ctx.sectors.data?.bests?.best ?? null,
      alien: traceFromAi(ctx.aiLapOf('alien', race.activeAero)), legend: traceFromAi(ctx.aiLapOf('legend', race.activeAero)),
      against: opts.against, after: opts.after, runs: [], startT: performance.now(), savedBefore: null, state: 'ready', shown: -1, hudT: 0 };
    R.savedBefore = R.saved?.time ?? null;
    R.lapBefore = R.bestLap ? P.lapParts(R.bestLap, R.sec, R.parts, T.N).time : null;
    // no lights, no rival, no recorded ghost of a lap: practice is yours alone
    Object.assign(game, { phase: PHASE.RACE, trial: false, rival: null, ghost: null, ghostStart: null });
    race.t = 0; Hud.showLights(false); Hud.setDelta(null, false);
    $('hud').classList.add('practice');
    for (const id of ['pracBox', 'pracRuns', 'pracHint']) $(id).hidden = false;
    ctx.setMinimapSection(R.sec);
    $('prHName').textContent = `PRACTICE · ${R.name}`;
    place();
  }
  function stop() {
    if (!R) return;
    R = null; ghost.setVisible(false); mineStrip.visible = refStrip.visible = false;
    $('hud').classList.remove('practice');
    for (const id of ['pracBox', 'pracRuns', 'pracHint', 'pracReady', 'prTagGhost', 'prTagMine', 'prTagRef']) $(id).hidden = true;
    ctx.setMinimapSection(null); ctx.setRacingLine(undefined);
  }
  // every sim step (after the cars moved)
  function step(dt) {
    if (!R) return;
    const c = game.player;
    switch (R.state) {
      // waiting for you: A / Enter (go()), or the gas pressed (after it was let go: a held pedal from before doesn't count)
      case 'ready': if (Input.drive.thr < 0.2) R.gasUp = true; else if (R.gasUp && Input.drive.thr > 0.5) go(); return;
      case 'wait': R.wait -= dt; if (R.wait <= 0) place(); return;
      case 'free': { const w = R.rec.win(c.idx); if (w >= 0 && w < 8 && R.prevW !== w && (R.prevW < 0 || R.prevW > R.W - 20)) startHere(); R.prevW = w; return; }
    }
    R.t += dt; R.rec.sample(c, R.t); R.prevW = R.rec.win(c.idx);
    if (R.state === 'lead' && Number.isFinite(R.rec.run.ring)) R.state = 'run';
    R.still = SIM.speedOf(c) < 2 ? R.still + dt : 0;
    if (R.off || c.offTrack || c.beached) { off(); return; }
    if (R.still > 6) { off('stopped'); return; }
    if (R.rec.last >= R.lead + R.len) finish();
  }
  // the player's car events: going off (track limits, a wall) ends the run
  function onEvent(e) { if (R && (R.state === 'lead' || R.state === 'run') && (e.type === EV.CUT || e.type === EV.WALL)) R.off = true; }
  // a controller button / key while practising: Y (or the camera's button on a pad, key Y) = restart the run,
  // X (the pit box's on a pad, key X) = the next ghost
  function action(name, src) {
    if (!R || game.phase !== PHASE.RACE || game.paused || game.ended) return false;
    if (name === 'restartRun' || (name === 'camera' && src === 'pad')) { place(); return true; }
    if ((name === 'box' && src === 'pad') || (name === 'boost' && src === 'key')) {
      const order = Object.keys(AGAINST); R.against = order[(order.indexOf(R.against) + 1) % order.length];
      refresh(); ctx.showMessage({ toast: `Ghost: ${AGAINST[R.against].toLowerCase()}`, secs: 1.2 }); return true;
    }
    return false;
  }

  // every frame: the ghost, the braking marks, the tags, the HUD
  const v3 = new THREE.Vector3();
  function project(x, y, z, tag, text) {
    const e = $(tag); v3.set(x, y, z).project(Display.camera);
    const on = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    e.hidden = !on; if (!on) return;
    e.style.left = ((v3.x + 1) / 2 * innerWidth).toFixed(0) + 'px'; e.style.top = ((1 - v3.y) / 2 * innerHeight).toFixed(0) + 'px';
    if (e.textContent !== text) e.textContent = text;
  }
  function frame(dt, sub = 0) {
    if (!R || !game.player) return;
    const c = game.player, T = R.T, N = T.N, live = R.state === 'lead' || R.state === 'run' || R.state === 'ready';
    const w = R.rec.win(c.idx), ring = R.rec.run.ring, tau = Number.isFinite(ring) ? R.t - ring : NaN;
    const refTs = R.ref.ts, myTs = w >= 0 ? P.runTime(R.rec.run, w) : NaN, delta = live && R.state === 'run' && refTs && w >= R.lead ? myTs - refTs[w] : NaN;
    // the ghost: on the lead-in at your spot (by distance), from the ring on at your time
    // the ghost: a rolling start runs on one clock from the start of the run (both cars set off together at the same
    // speed: smooth; reading its time at your track sample stepped it ~2 m at a time), + the part of a sim step since the
    // last one (as your car is drawn); a standing start from the ring on, at your time
    let gp = null;
    const tNow = R.state === 'ready' ? 0 : R.t + sub;
    if (R.ghostOf && live && refTs) {
      const t = !R.standing ? refTs[0] + tNow : Number.isFinite(ring) ? tNow - ring : NaN;
      gp = Number.isFinite(t) ? R.ghostOf(t) : null;
    }
    ghost.setVisible(!!gp);
    if (gp) {
      R.ghostIdx = Number.isFinite(gp.idx) ? Math.round(gp.idx) % N : nearIdx(T, gp.x, gp.z, R.ghostIdx);
      const pose = roadPose(gp.x, gp.z, gp.h, R.ghostIdx);
      ghost.sync({ v: 0, roll: tNow * 50, steer: 0, brake: 0, aeroOpen: 0, attackOn: false, wingOff: null, ay: 0, air: null }, pose, dt);
      const gap = !Number.isFinite(delta) ? '' : Math.abs(delta) < 0.005 ? 'LEVEL WITH YOU' : `${Math.abs(delta).toFixed(2)} S ${delta < 0 ? 'BEHIND' : 'AHEAD OF'} YOU`;
      project(gp.x, pose.y + 1.5, gp.z, 'prTagGhost', [R.ref.name === 'BEST' ? 'BEST RUN' : R.ref.name, gap].filter(Boolean).join(' · '));
    } else $('prTagGhost').hidden = true;
    // the next corner's braking points (yours, the AI's) as bands across the road, ahead of you
    const relNow = P.relOf(R.sec, c.idx, N), inLead = relNow >= N - R.lead;
    const ks = P.cornersIn(R.L, R.sec), nextK = ks.find(k => { const r = P.relOf(R.sec, R.L.corners[k].apex, N); return inLead || r > relNow; });
    const at = M => { if (!M || nextK === undefined || M[nextK].brakeAt === null) return null; return SIM.wrapIdx(R.L.corners[nextK].apex - Math.round(M[nextK].brakeAt / T.ds), N); };
    const mi = live ? at(R.brakes.mine) : null, oi = live ? at(R.brakes.other) : null;
    const ahead = i => i !== null && SIM.wrapIdx(i - c.idx, N) < 250 / T.ds;
    if (ahead(mi)) { placeStrip(mineStrip, T, mi); project(T.PX[mi] + T.NX[mi] * (T.HW + 1.5), SIM.surfaceY(T, mi, 0) + 0.3, T.PZ[mi] + T.NZ[mi] * (T.HW + 1.5), 'prTagMine', 'YOUR BEST BRAKED HERE'); }
    else { mineStrip.visible = false; $('prTagMine').hidden = true; }
    if (ahead(oi)) {
      const d = mi !== null && oi !== null ? Math.round((R.brakes.mine[nextK].brakeAt - R.brakes.other[nextK].brakeAt)) : null;
      placeStrip(refStrip, T, oi);
      project(T.PX[oi] + T.NX[oi] * (T.HW + 1.5), SIM.surfaceY(T, oi, 0) + 0.3, T.PZ[oi] + T.NZ[oi] * (T.HW + 1.5), 'prTagRef',
        `${R.brakes.otherName} BRAKES${d === null || d === 0 ? ' HERE' : ` · ${Math.abs(d)} M ${d > 0 ? 'LATER' : 'EARLIER'}`}`);
    } else { refStrip.visible = false; $('prTagRef').hidden = true; }
    if ((R.hudT -= dt) > 0) return;
    R.hudT = 1 / 15;
    hud(w, tau, delta);
  }
  function hud(w, tau, delta) {
    const live = R.state === 'run' || R.state === 'lead' || R.state === 'ready', last = R.runs[R.runs.length - 1];
    $('prHRun').textContent = `RUN ${R.runs.length + (live ? 1 : 0)}`;
    const shown = R.state === 'run' ? tau.toFixed(2) : live ? '0.00' : last ? (Number.isFinite(last.time) ? s3(last.time) : 'OFF') : '0.00';
    $('prHTime').textContent = shown;
    const d = R.state === 'run' ? delta : !live && last && Number.isFinite(last.time) ? last.time - R.ref.total : NaN;
    $('prHDelta').textContent = Number.isFinite(d) ? sign(d, 2) : '';
    $('prHDelta').className = 'num ' + (d < 0 ? 'green' : d > 0 ? 'red' : '');
    // the parts: done = coloured, the one you are in = how far through, still to come = grey; their times under them
    const runs = live ? [...R.runs, { parts: R.parts.map((p, k) => P.runTime(R.rec.run, R.lead + p.b) - P.runTime(R.rec.run, R.lead + p.a)), time: null, off: null }] : R.runs;
    const k = runs.length - 1, cur = runs[k], at = w - R.lead;
    const bars = R.parts.map((p, j) => {
      const i = el('i'), t = cur?.parts[j]; i.style.flex = String(Number.isFinite(R.ref.parts[j]) ? R.ref.parts[j] : p.b - p.a);
      if (Number.isFinite(t)) i.className = P.partColour(runs, k, j);
      else if (cur?.off && !live) i.className = 'off';
      else if (live && at >= p.a && at < p.b) { const u = el('u'); u.style.width = ((at - p.a) / (p.b - p.a) * 100).toFixed(0) + '%'; i.append(u); }
      return i;
    });
    $('prHBars').replaceChildren(...bars);
    $('prHLabels').replaceChildren(...R.parts.map((p, j) => { const t = cur?.parts[j]; return el('span', Number.isFinite(t) ? P.partColour(runs, k, j) : '', `${p.name} ${Number.isFinite(t) ? s3(t) : '…'}`); }),
      el('span', '', Number.isFinite(R.ref.total) ? `vs ${R.ref.name === 'BEST' ? 'best' : R.ref.name} ${s3(R.ref.total)}` : 'first run sets your best'));
    // the runs so far (the last few) and the one going on
    if (R.shown !== R.runs.length + (live ? 0.5 : 0)) {
      R.shown = R.runs.length + (live ? 0.5 : 0);
      const S = P.sessionStats(R.runs), from = Math.max(0, R.runs.length - P.PRACTICE.listed + (live ? 1 : 0));
      const rows = R.runs.slice(from).map((r, j) => {
        const n = from + j, d2 = el('div', n === S.bestIndex ? 'best' : '');
        d2.append(el('span', '', String(n + 1)), Number.isFinite(r.time) ? el('span', '', s3(r.time) + (n === S.bestIndex ? ' ★' : '')) : el('s', '', `OFF · ${r.off}`));
        return d2;
      });
      if (live) { const d2 = el('div', 'now'); d2.append(el('span', '', String(R.runs.length + 1)), el('span', '', 'running')); rows.push(d2); }
      $('prHRuns').replaceChildren(...rows);
      $('pracHint').innerHTML = `<span><b>Y</b> RESTART RUN</span><span><b>X</b> SWITCH GHOST</span><span><b>≡</b> PAUSE · CHANGE SECTION</span><span>${R.after === 'reset' ? 'back to the start by itself when you finish or go off' : 'drive on round for the next run'}</span>`;
    }
  }

  // ---- D: the summary ----
  function summary() {
    if (!R) return;
    Object.assign(game, { paused: false, ended: true, resultsShown: true });
    ghost.setVisible(false); mineStrip.visible = refStrip.visible = false;
    for (const id of ['prTagGhost', 'prTagMine', 'prTagRef']) $(id).hidden = true;
    const S = P.sessionStats(R.runs), T = R.T, mins = Math.max(1, Math.round((performance.now() - R.startT) / 60000));
    $('prSumTitle').textContent = `Practice · ${R.name}`;
    $('prSumCtx').textContent = `${T.name} · ${R.runs.length} run${R.runs.length === 1 ? '' : 's'} · ${mins} min`.toUpperCase();
    const tile = (label, value, sub, cls = '') => { const t = el('div', 'pr-tile'); t.append(el('span', 'lbl', label), el('b', cls, value), el('small', '', sub)); return t; };
    const ai = R.alien || R.legend, aiName = R.alien ? 'ALIEN' : 'LEGEND', aiT = ai ? P.lapParts(ai, R.sec, R.parts, T.N).time : NaN;
    const before = [R.savedBefore, R.lapBefore].filter(Number.isFinite), was = before.length ? Math.min(...before) : null;
    const now = S.best !== null ? Math.min(S.best, was ?? Infinity) : was;
    const runsOf = S.ofEachRuns.map((k, p) => k >= 0 ? `${R.parts[p].name} run ${k + 1}` : '').filter(Boolean).join(', ');
    $('prSumTiles').replaceChildren(
      tile('BEST RUN', S.best === null ? '—' : s3(S.best), S.best === null ? 'no clean run yet' : was === null ? 'your first best here' : `${sign(S.best - was)} on your old best`, 'purple'),
      tile('AVERAGE', S.avg === null ? '—' : s3(S.avg), `${S.clean} clean run${S.clean === 1 ? '' : 's'} of ${S.runs}`),
      tile('SPREAD', S.spread === null ? '—' : S.spread.toFixed(2), S.last3 === null ? 'fastest to slowest' : `last 3 runs within ${S.last3.toFixed(2)}`),
      tile('BEST OF EACH CORNER', S.ofEach === null ? '—' : s3(S.ofEach), runsOf || '—'),
      tile(aiName, Number.isFinite(aiT) ? s3(aiT) : '—', Number.isFinite(aiT) && was !== null ? `${sign(was - aiT)} → ${sign(now - aiT)} now` : Number.isFinite(aiT) && now !== null ? `${sign(now - aiT)} now` : ''));
    const cols = `50px repeat(${R.parts.length}, minmax(0, 1fr)) 110px`;
    const head = $('prSumHead'); head.style.gridTemplateColumns = cols;
    head.replaceChildren(el('span', '', 'RUN'), ...R.parts.map(p => el('span', '', p.name)), el('span', 'r', 'TIME'));
    $('prSumRows').replaceChildren(...R.runs.map((r, k) => {
      const row = el('div', 'pr-rrow' + (k === S.bestIndex ? ' best' : '')); row.style.gridTemplateColumns = cols;
      row.append(el('span', 'n', String(k + 1)), ...R.parts.map((p, j) => { const c = P.partColour(R.runs, k, j); return el('span', c, Number.isFinite(r.parts[j]) ? s3(r.parts[j]) : c === 'off' && r.off === p.name ? 'off' : ''); }),
        el('span', 'r' + (Number.isFinite(r.time) ? (k === S.bestIndex ? ' purple' : '') : ' off'), Number.isFinite(r.time) ? s3(r.time) : '—'));
      return row;
    }));
    // the corner where your best run loses the most to the AI: run 1 → your best → the AI
    const bestRun = R.runs[S.bestIndex] ?? null, first = R.runs.find(r => Number.isFinite(r.parts[0])) ?? null;
    const aiParts = ai ? P.lapParts(ai, R.sec, R.parts, T.N).parts : null;
    let p = -1; if (bestRun && aiParts) bestRun.parts.forEach((t, j) => { if (R.parts[j].corner >= 0 && (p < 0 || t - aiParts[j] > bestRun.parts[p] - aiParts[p])) p = j; });
    const k = p >= 0 ? R.parts[p].corner : -1, name = p >= 0 ? R.parts[p].name : '';
    const mOf = r => r ? cornerMetrics(P.runAsTrace(r.run, R.sec), R.L, T.ds)[k] : null;
    const m1 = k >= 0 ? mOf(first) : null, mb = k >= 0 ? mOf(bestRun) : null, ma = k >= 0 && ai ? cornerMetrics(ai, R.L, T.ds)[k] : null;
    $('prWhatHead').textContent = k >= 0 ? `${name}: WHAT CHANGED · RUN 1 → BEST → ${aiName}` : 'WHAT CHANGED';
    const line = (label, f, unit) => { const d = el('div'); d.append(el('span', '', label), ...[[m1, 'was'], [mb, ''], [ma, 'ref']].map(([m, c]) => el('span', c, m && f(m) !== null && Number.isFinite(f(m)) ? Math.round(f(m)) + unit : '—'))); return d; };
    const headRow = el('div'); headRow.append(el('span', '', ''), el('span', '', 'RUN 1'), el('span', '', 'BEST'), el('span', '', aiName));
    $('prWhat').replaceChildren(...(k >= 0 ? [headRow, line('Brakes before the apex', m => m.brakeAt, ' m'), line('Slowest', m => m.min, ''), line('Full gas after the apex', m => m.fullAt, ' m'), line('Exit, 100 m on (km/h)', m => m.exit, '')] : []));
    $('prWhatText').textContent = k >= 0 ? P.changeSentence(name, m1, mb, ma, aiName === 'ALIEN' ? 'The ALIEN' : 'LEGEND') : R.runs.length ? '' : 'No runs yet: MORE RUNS to drive the section.';
    $('prCompare').disabled = !bestRun || !ai || !(R.sec.from > 0 && R.sec.to > R.sec.from);
    ana.reset();
    for (const b of $('prSumTabs').children) b.disabled = b.dataset.t !== 'runs' && !ana.has();
    Screens.show('pracSum', 'prMore');
  }
  // your best run inside the AI's lap (the rest of the lap is the AI's, shifted): the lap comparison can show it
  function spliced() {
    const S = P.sessionStats(R.runs), r = R.runs[S.bestIndex], ai = R.alien || R.legend; if (!r || !ai) return null;
    const N = R.T.N, { from, to } = R.sec, run = r.run, tr = { time: 0, t: Float32Array.from(ai.t), kmh: Float32Array.from(ai.kmh), thr: ai.thr && Float32Array.from(ai.thr), brk: ai.brk && Float32Array.from(ai.brk),
      x: ai.x && Float32Array.from(ai.x), z: ai.z && Float32Array.from(ai.z), h: ai.h && Float32Array.from(ai.h), gear: ai.gear && Float32Array.from(ai.gear) };
    const dT = r.time - (ai.t[to] - ai.t[from]);
    for (let i = from; i <= to; i++) {
      const w = R.lead + (i - from); tr.t[i] = ai.t[from] + run.t[w] - run.ring; tr.kmh[i] = run.kmh[w];
      for (const k of ['thr', 'brk', 'x', 'z', 'h', 'gear']) if (tr[k]) tr[k][i] = run[k][w];
    }
    for (let i = to + 1; i < N; i++) tr.t[i] = ai.t[i] + dT;
    tr.time = ai.time + dT;
    return tr;
  }
  $('prMore').onclick = () => { if (!R) return; Object.assign(game, { ended: false, resultsShown: false }); Screens.show(null); place(); };
  $('prSumDone').onclick = () => done();
  // the summary's views: RUNS, and the analysis's COMPARE / TELEMETRY / CORNER (practice-analysis.js)
  const ana = createPracticeAnalysis({ getR: () => R });
  for (const b of $('prSumTabs').children) b.onclick = () => ana.show(b.dataset.t);
  $('prChange').onclick = () => { stop(); ctx.toMenu(); ctx.menuPage(); };
  $('prLap').onclick = () => { stop(); ctx.startTrial(); };
  $('prCompare').onclick = () => { const tr = R && spliced(); if (tr) ctx.compare(tr, `Best run ${R.name} ${s3(P.sessionStats(R.runs).best)} (rest of the lap: ${R.alien ? 'ALIEN' : 'LEGEND'})`); };
  function done() { stop(); ctx.toMenu(); }

  return {
    get on() { return !!R; },
    show() { view = view || 'map'; render(); },
    render,
    begin, stop, step, holding, onEvent, action, frame, summary, done,
    ready: () => go(),                   // pad A while waiting: off you go (main.js, the 'menu' confirm)
    // the pause menu's RESUME tile while practising
    pauseInfo() {
      if (!R) return null;
      const S = P.sessionStats(R.runs);
      return { kick: 'YOUR BEST RUN', pos: S.best === null ? 'No run yet' : s3(S.best), gaps: `${R.runs.length} run${R.runs.length === 1 ? '' : 's'} · ${R.name}`, ctx: `Practice · ${R.name}` };
    },
  };
}

