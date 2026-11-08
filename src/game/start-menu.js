// The start menu (2026-10-29; user's pick of three mock-ups, "the combo": the home of one, the race setup of another, the
// pages and controls of the third). Home = tiles (Continue your last session, Race weekend, Quick race, Time trial,
// Leaderboard, Garage, Controller, Settings) and a row of tools under them (Lap analysis, Aero zones, Test controls).
// A section = one full-width page (2026-10-30, user's edit of the mock-up: the side rail went; Paddock / B go home):
// Race weekend in five steps (car, circuit, field, rules, grid: each step's tab shows what is picked and jumps there),
// Time trial (the car and the ghost to chase), Leaderboard (leaderboard-screen.js). The CAR step (2026-11-08, the user's
// pick C on the class-picker canvas): the cars as a list, the picked one's numbers beside it, COMPARE = every car's
// side by side. Pad: the D-pad / arrow keys move the focus,
// A presses, B goes back, LB / RB change the circuit. The setup controls themselves (segments, steppers) stay
// screens.js bindSetup's; this module only arranges them and fills in what they don't.
// ctx: { game, track(), setType(type), switchTrack(id), pickClass(id), setDriving(key, value), start(), openGarage(), openSettings(tab),
//        gridNow() (starting-grid.js forRace: null while the rivals are timed), leaderboard, ghostName(), playerColour() }
import { SIM } from '../sim/index.js';
import { RACE_SETUP } from './config.js';
import { $ } from './util.js';
import { OUTLINES } from './circuit-outlines.js';
import { playerClass, classUi, allClasses, classRows } from './car-class.js';

// the race rules on step 3 (the choices are RACE_SETUP's, the same as Settings → Driving)
const RULES = [['fuel', 'Fuel use', 'How long a tank lasts'], ['tyres', 'Tyre wear', 'Worn tyres lose grip'], ['damage', 'Damage', 'Wings and floor from contact'],
  ['aero', 'Active aero', 'Straight mode on the straights'], ['overtake', 'Overtake mode', 'Extra power within a second'], ['tyreTemp', 'Tyre temperature', 'Cold off the blankets']];
const STEPS = 5;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const svgPath = (d, viewBox = '0 0 200 120') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', viewBox); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
const svgIcon = d => { const s = svgPath(d, '0 0 40 20'); s.classList.add('car-icon'); return s; };
const choiceLabel = (key, v) => RACE_SETUP.choices[key]?.find(c => c[0] === v)?.[1] ?? String(v).toUpperCase();

export function createStartMenu(ctx) {
  const { game } = ctx, root = $('startOv');
  let page = null, step = 0, compare = false;    // page: null = home, 'race' | 'trial' | 'board'; compare: the CAR step's
  const ids = Object.keys(SIM.CIRCUITS);

  // ---- the circuit list (step 1) and the rules (step 3): built once ----
  const circList = $('circuitList');
  for (const id of ids) {
    const b = el('button'); b.type = 'button'; b.dataset.id = id; b.setAttribute('role', 'radio');
    b.append(svgPath(OUTLINES[id].d), el('b', '', SIM.CIRCUITS[id].name), el('small', '', OUTLINES[id].km.toFixed(2) + ' km'));
    b.onclick = () => ctx.switchTrack(id);
    circList.append(b);
  }
  // the Continue tile's circuit picker: a dot per circuit (the arrows: screens.js bindSetup, #trackStep)
  for (const id of ids) {
    const b = el('button'); b.type = 'button'; b.setAttribute('aria-label', SIM.CIRCUITS[id].name); b.dataset.id = id;
    b.onclick = () => ctx.switchTrack(id);
    $('contDots').append(b);
  }
  // the cars (step 1 and the time trial page): built once, the picked one marked in refresh
  const carList = $('carList'), trialCar = $('trialCar');
  for (const cls of allClasses()) {
    const U = classUi(cls), b = el('button'); b.type = 'button'; b.dataset.id = cls.id; b.setAttribute('role', 'radio');
    const words = el('span'); words.append(el('b', '', U.name), el('small', '', U.tag));
    b.append(svgIcon(U.icon), words);
    b.onclick = () => { ctx.pickClass(cls.id); refresh(); };
    carList.append(b);
    const t = el('button', '', U.name); t.type = 'button'; t.dataset.id = cls.id;
    t.onclick = () => { ctx.pickClass(cls.id); refresh(); };
    trialCar.append(t);
  }
  let shownMap = null;
  const ruleRows = $('ruleRows'), ruleText = {};
  // (a class with attack mode: the Overtake setting turns that on: SIM raceAero)
  const ruleWords = (key, cls) => key === 'overtake' && cls.attack ? ['Attack mode', 'Twice a race, through the activation zone'] : RULES.find(r => r[0] === key).slice(1);
  for (const [key, label, note] of RULES) {
    const row = el('div', 'rule'), info = el('div'), seg = el('div', 'seg');
    const name = document.createTextNode(label), small = el('small', '', note);
    info.append(name, small); ruleText[key] = [name, small];
    seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', label); seg.dataset.key = key;
    for (const [v, text] of RACE_SETUP.choices[key]) {
      const b = el('button', '', text); b.type = 'button'; b.dataset.v = v;
      b.onclick = () => { ctx.setDriving(key, v); refresh(); };
      seg.append(b);
    }
    row.append(info, seg); ruleRows.append(row);
  }

  // ---- views ----
  function show(next, at = 0) {
    if (page === 'board' && next !== 'board') ctx.leaderboard.hide();
    page = next; step = next === 'race' ? at : 0;
    $('mnHome').hidden = !!page; $('mnSection').hidden = !page;
    $('pageRace').hidden = page !== 'race'; $('pageTrial').hidden = page !== 'trial'; $('lbOv').hidden = page !== 'board';
    if (page === 'race' && game.setup.type === 'trial') ctx.setType('laps');
    if (page === 'trial' && game.setup.type !== 'trial') ctx.setType('trial');
    if (page === 'board') ctx.leaderboard.show(() => show(null));
    refresh();
    focusFirst();
  }
  function goStep(k) { step = Math.max(0, Math.min(STEPS - 1, k)); refresh(); focusFirst(); }
  const focusFirst = () => requestAnimationFrame(() => {
    const target = !page ? $('contGo') : page === 'race' ? document.querySelector(`#raceSteps [data-step="${step}"]`) : page === 'trial' ? $('trialGo') : $('lbClose');
    if (root.hidden) return;
    target?.focus({ preventScroll: true });
  });

  // ---- what every view shows, from the setup ----
  function refresh() {
    const s = game.setup, T = ctx.track(), O = OUTLINES[T.id], name = SIM.CIRCUITS[T.id].name, trial = s.type === 'trial';
    const level = choiceLabel('ai', s.ai), dist = s.type === 'timed' ? s.minutes + ' min' : s.type === 'unlimited' ? 'no limit' : s.laps + (s.laps === 1 ? ' lap' : ' laps');
    // home
    showMap(T.id);
    $('contTitle').textContent = trial ? `Time trial · ${name}` : `Race · ${name}`;
    $('contSub').textContent = trial ? `Chasing ${ctx.ghostName()}` : `${s.cars === 1 ? 'Solo' : s.cars + ' cars · ' + level} · ${dist}`;
    $('tileRaceSub').textContent = `${name} · ${level} · ${trial ? s.laps + ' laps' : dist}`;
    $('tileTrialSub').textContent = `Chase ${ctx.ghostName()}`;
    const A = ctx.online.account;
    $('tileBoardSub').textContent = ctx.online.signedIn ? `Signed in as ${A.name}` : 'Not joined yet';
    $('tileBoardSub').style.color = ctx.online.signedIn ? 'var(--green)' : '';
    // race weekend: the steps' tabs
    const quali = s.quali !== 'off';
    const vals = [classUi(playerClass()).name, name, s.cars === 1 ? 'you alone' : `${s.cars} cars · ${level}`, `${dist} · aero ${choiceLabel('aero', s.aero)}`, s.cars === 1 ? 'solo' : quali ? `qualifying ${s.quali} min` : 'from your best'];
    vals.forEach((v, k) => { $('stepVal' + k).textContent = v; });
    for (const b of document.querySelectorAll('#raceSteps button')) {
      const k = +b.dataset.step; b.classList.toggle('done', k <= step); b.setAttribute('aria-current', k === step ? 'step' : 'false');
    }
    for (const d of document.querySelectorAll('.mn-step')) d.hidden = +d.dataset.step !== step;
    const last = step === STEPS - 1;
    $('raceNext').hidden = last; $('raceNow').hidden = last; $('startBtn').hidden = !last;
    $('startBtn').textContent = s.cars === 1 ? 'Drive' : quali ? 'To qualifying' : 'To the grid';
    $('raceBack').textContent = step === 0 ? 'Paddock' : 'Back';
    // step 1: the car
    drawCars();
    // step 2: the circuit
    $('circName').textContent = name;
    $('raceMap').setAttribute('d', O.d); $('raceMapU').setAttribute('d', O.d);
    $('raceMapSvg').setAttribute('aria-label', `Map of ${name}`);
    $('raceMapStart').setAttribute('x', O.start[0] - 1.2); $('raceMapStart').setAttribute('y', O.start[1] - 3.5);
    for (const b of circList.children) b.setAttribute('aria-checked', String(b.dataset.id === T.id));
    // step 4: the rules
    for (const [key, [name, small]] of Object.entries(ruleText)) [name.textContent, small.textContent] = ruleWords(key, playerClass());
    for (const seg of ruleRows.querySelectorAll('.seg')) for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(s[seg.dataset.key])));
    // step 5: the grid (your best against the rivals' times, or qualifying first)
    drawGrid();
    // time trial
    $('trialTitle').textContent = `Time trial · ${name}`;
    $('trialGo').textContent = `Drive · chase ${ctx.ghostName()}`;
  }
  // the Continue tile's map: slides in from the side of the circuit picked (the shorter way round), the old one out
  function showMap(id) {
    if (id === shownMap) return;
    const box = $('contMaps'), cur = box.lastElementChild, d = OUTLINES[id].d;
    for (const b of $('contDots').children) b.setAttribute('aria-current', String(b.dataset.id === id));
    const calm = !shownMap || root.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let dir = (ids.indexOf(id) - ids.indexOf(shownMap) + ids.length) % ids.length;
    dir = dir > ids.length / 2 ? -1 : 1;
    shownMap = id;
    while (box.children.length > 1) box.firstElementChild.remove();
    if (calm) { for (const p of cur.children) p.setAttribute('d', d); return; }
    const next = cur.cloneNode(true);
    for (const p of next.children) p.setAttribute('d', d);
    box.append(next);
    const ease = { duration: 450, easing: 'ease' };
    cur.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 100}%)`, opacity: 0 }], ease).onfinish = () => cur.remove();
    next.animate([{ transform: `translateX(${dir * 100}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], ease);
  }
  // the car list and the numbers: the picked car's, or every car's side by side (COMPARE)
  function drawCars() {
    const cur = playerClass(), classes = compare ? allClasses() : [cur];
    for (const b of carList.children) b.setAttribute('aria-checked', String(b.dataset.id === cur.id));
    for (const b of trialCar.children) b.setAttribute('aria-pressed', String(b.dataset.id === cur.id));
    const head = $('carHead'), cols = `170px repeat(${classes.length}, minmax(0, 1fr))`, toggle = el('button', 'iconbtn mn-compare', compare ? 'COMPARE: ON' : 'COMPARE');
    toggle.type = 'button'; toggle.setAttribute('aria-pressed', String(compare));
    toggle.onclick = () => { compare = !compare; drawCars(); $('carHead').querySelector('.mn-compare').focus(); };
    const names = el('div', 'mn-carcols'); names.style.gridTemplateColumns = cols;
    names.append(toggle, ...classes.map(c => el('b', c === cur ? 'on' : '', classUi(c).name)));   // (the toggle over the labels)
    head.replaceChildren(names);
    const rows = classes.map(classRows);
    $('carRows').replaceChildren(...rows[0].map(([label], k) => {
      const r = el('div', 'mn-carcols'); r.style.gridTemplateColumns = cols;
      r.append(el('span', 'lbl', label), ...rows.map((R, i) => el('span', compare && classes[i] === cur ? 'on' : '', R[k][1])));
      return r;
    }));
    $('carDetail').classList.toggle('compare', compare);
  }
  function drawGrid() {
    const s = game.setup, box = $('gridPreview'), g = ctx.gridNow(), quali = s.quali !== 'off';
    if (s.cars === 1) { box.replaceChildren(el('p', 'gpu', 'Just you and the circuit.')); return; }
    if (!g) { box.replaceChildren(el('p', 'gpu', 'Timing the rivals…')); return; }
    const order = quali ? [...g.order.filter(d => !d.player), { player: true, q: true }] : g.order;
    box.replaceChildren(...order.map((d, k) => {
      const row = el('div', d.player ? 'you' + (d.q ? ' q' : '') : ''), sw = el('i');
      sw.style.background = d.player ? ctx.playerColour() : '#' + d.color.toString(16).padStart(6, '0');
      row.append(el('b', '', d.q ? 'Q' : 'P' + (k + 1)), sw, el('span', '', d.player ? 'You' : d.name), el('small', '', d.player ? (d.q ? 'after qualifying' : 'Gridline') : d.team));
      return row;
    }));
  }

  // ---- buttons ----
  $('contGo').onclick = () => ctx.start();
  $('tileRace').onclick = () => show('race');
  $('tileQuick').onclick = () => { if (game.setup.type === 'trial') ctx.setType('laps'); ctx.start(); };
  $('tileTrial').onclick = () => show('trial');
  $('padStatus').onclick = () => ctx.openSettings('controller');
  $('trialBack').onclick = () => show(null);
  for (const b of document.querySelectorAll('#raceSteps button')) b.onclick = () => goStep(+b.dataset.step);
  $('raceNext').onclick = () => goStep(step + 1);
  $('raceBack').onclick = () => back();
  $('raceNow').onclick = () => ctx.start();
  $('trialGo').onclick = () => ctx.start();
  for (const b of document.querySelectorAll('[data-circ]')) b.onclick = () => circuit(+b.dataset.circ);
  function circuit(d) { const i = ids.indexOf(ctx.track().id); ctx.switchTrack(ids[(i + d + ids.length) % ids.length]); }
  // B / Escape: a step back, a page back home
  function back() {
    if (page === 'race' && step > 0) { goStep(step - 1); return true; }
    if (page) { show(null); return true; }
    return false;
  }

  // ---- moving the focus with the D-pad / arrow keys: the nearest visible button that way ----
  function nav(dir) {
    if (!root.contains(document.activeElement)) { focusFirst(); return; }
    moveFocus(root, dir);
  }
  addEventListener('keydown', e => {
    if (root.hidden || e.target.closest?.('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir) { e.preventDefault(); nav(dir); }
  });

  // the menu keeps the mock-up's size and proportions: a fixed 1280 × 800, shrunk evenly only when the window is smaller
  // (user, 1440p: scaled up it was "too big"; styles: .mn)
  const MENU_SIZE = [1280, 800];
  // (on the page's root: the pause menu and the results are panels of the same size)
  const fit = () => document.documentElement.style.setProperty('--mn-scale', String(Math.min(1, innerWidth / MENU_SIZE[0], innerHeight / MENU_SIZE[1])));
  addEventListener('resize', fit); fit();

  return {
    get page() { return page; },
    home() { show(null); }, show, refresh, nav, back, circuit,
    // pad A: press the focused button (nothing focused yet: focus the first one)
    confirm() { const f = document.activeElement; if (root.contains(f) && f.tagName === 'BUTTON') f.click(); else focusFirst(); },
  };
}

// the D-pad / arrow keys in a menu panel: the focus moves to the nearest visible button that way (edge to edge that way;
// across, 0 when the two line up at all, else the gap: a tall tile reaches both rows beside it, and between equals the
// first in the page wins). Nothing in the panel focused yet: its first button.
export function moveFocus(root, dir) {
  const all = [...root.querySelectorAll('button, [tabindex="0"]')].filter(b => b.offsetParent && !b.disabled && !b.hidden);
  const cur = root.contains(document.activeElement) ? document.activeElement : null;
  if (!cur) { all[0]?.focus(); return; }
  const r = cur.getBoundingClientRect(), horiz = dir === 'left' || dir === 'right';
  let best = null, score = Infinity;
  for (const b of all) {
    if (b === cur) continue;
    const q = b.getBoundingClientRect();
    const along = { right: q.left - r.right, left: r.left - q.right, down: q.top - r.bottom, up: r.top - q.bottom }[dir];
    if (along < -2) continue;                                  // (not that way)
    const side = horiz ? Math.max(0, q.top - r.bottom, r.top - q.bottom) : Math.max(0, q.left - r.right, r.left - q.right);
    const sc = Math.max(0, along) + side * 2;
    if (sc < score) { score = sc; best = b; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
}
