// The start menu (2026-10-29; user's pick of three mock-ups, "the combo": the home of one, the race setup of another, the
// pages and controls of the third). Home = tiles (Continue your last session, Race weekend, Quick race, Time trial,
// Leaderboard, Garage, Controller, Settings). A section = a rail on the left (jump between Race weekend, Time trial,
// Leaderboard, Garage, Lap analysis, Aero zones, Settings, Test controls; ‹ GRIDLINE GP goes home) and a page:
// Race weekend in four steps (circuit, field, rules, grid: each step's tab shows what is picked and jumps there),
// Time trial (the ghost to chase), Leaderboard (leaderboard-screen.js). Pad: the D-pad / arrow keys move the focus,
// A presses, B goes back, LB / RB change the circuit. The setup controls themselves (segments, steppers) stay
// screens.js bindSetup's; this module only arranges them and fills in what they don't.
// ctx: { game, track(), setType(type), switchTrack(id), setDriving(key, value), start(), openGarage(), openSettings(tab),
//        gridNow() (starting-grid.js forRace: null while the rivals are timed), leaderboard, ghostName(), playerColour() }
import { SIM } from '../sim/index.js';
import { RACE_SETUP } from './config.js';
import { $ } from './util.js';
import { OUTLINES } from './circuit-outlines.js';

// the race rules on step 3 (the choices are RACE_SETUP's, the same as Settings → Driving)
const RULES = [['fuel', 'Fuel use', 'How long a tank lasts'], ['tyres', 'Tyre wear', 'Worn tyres lose grip'], ['damage', 'Damage', 'Wings and floor from contact'],
  ['aero', 'Active aero', 'Straight mode on the straights'], ['overtake', 'Overtake mode', 'Extra power within a second'], ['tyreTemp', 'Tyre temperature', 'Cold off the blankets']];
const STEPS = 4;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const svgPath = (d, viewBox = '0 0 200 120') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', viewBox); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
const choiceLabel = (key, v) => RACE_SETUP.choices[key]?.find(c => c[0] === v)?.[1] ?? String(v).toUpperCase();

export function createStartMenu(ctx) {
  const { game } = ctx, root = $('startOv');
  let page = null, step = 0;                 // page: null = home, 'race' | 'trial' | 'board'
  const ids = Object.keys(SIM.CIRCUITS);

  // ---- the circuit list (step 1) and the rules (step 3): built once ----
  const circList = $('circuitList');
  for (const id of ids) {
    const b = el('button'); b.type = 'button'; b.dataset.id = id; b.setAttribute('role', 'radio');
    b.append(svgPath(OUTLINES[id].d), el('b', '', SIM.CIRCUITS[id].name), el('small', '', OUTLINES[id].km.toFixed(2) + ' km'));
    b.onclick = () => ctx.switchTrack(id);
    circList.append(b);
  }
  const ruleRows = $('ruleRows');
  for (const [key, label, note] of RULES) {
    const row = el('div', 'rule'), info = el('div'), seg = el('div', 'seg');
    info.append(document.createTextNode(label), el('small', '', note));
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
    for (const b of document.querySelectorAll('.mn-nav[data-page]')) b.setAttribute('aria-current', b.dataset.page === page ? 'page' : 'false');
    if (page === 'race' && game.setup.type === 'trial') ctx.setType('laps');
    if (page === 'trial' && game.setup.type !== 'trial') ctx.setType('trial');
    if (page === 'board') ctx.leaderboard.show(() => show(null));
    refresh();
    focusFirst();
  }
  function goStep(k) { step = Math.max(0, Math.min(STEPS - 1, k)); refresh(); focusFirst(); }
  const focusFirst = () => requestAnimationFrame(() => {
    const target = !page ? $('tileContinue') : page === 'race' ? document.querySelector(`#raceSteps [data-step="${step}"]`) : page === 'trial' ? $('trialGo') : $('lbClose');
    if (root.hidden) return;
    target?.focus({ preventScroll: true });
  });

  // ---- what every view shows, from the setup ----
  function refresh() {
    const s = game.setup, T = ctx.track(), O = OUTLINES[T.id], name = SIM.CIRCUITS[T.id].name, trial = s.type === 'trial';
    const level = choiceLabel('ai', s.ai), dist = s.type === 'timed' ? s.minutes + ' min' : s.type === 'unlimited' ? 'no limit' : s.laps + (s.laps === 1 ? ' lap' : ' laps');
    // home
    $('contMap').setAttribute('d', O.d); $('contMapU').setAttribute('d', O.d);
    $('contTitle').textContent = trial ? `Time trial · ${name}` : `Race · ${name}`;
    $('contSub').textContent = trial ? `Chasing ${ctx.ghostName()}` : `${s.cars === 1 ? 'Solo' : s.cars + ' cars · ' + level} · ${dist}`;
    $('tileRaceSub').textContent = `${name} · ${level} · ${trial ? s.laps + ' laps' : dist}`;
    $('tileTrialSub').textContent = `Chase ${ctx.ghostName()}`;
    const A = ctx.online.account;
    $('tileBoardSub').textContent = ctx.online.signedIn ? `Signed in as ${A.name}` : 'Not joined yet';
    $('tileBoardSub').style.color = ctx.online.signedIn ? 'var(--green)' : '';
    // race weekend: the steps' tabs
    const quali = s.quali !== 'off';
    const vals = [name, s.cars === 1 ? 'you alone' : `${s.cars} cars · ${level}`, `${dist} · aero ${choiceLabel('aero', s.aero)}`, s.cars === 1 ? 'solo' : quali ? `qualifying ${s.quali} min` : 'from your best'];
    vals.forEach((v, k) => { $('stepVal' + k).textContent = v; });
    for (const b of document.querySelectorAll('#raceSteps button')) {
      const k = +b.dataset.step; b.classList.toggle('done', k <= step); b.setAttribute('aria-current', k === step ? 'step' : 'false');
    }
    for (const d of document.querySelectorAll('.mn-step')) d.hidden = +d.dataset.step !== step;
    const last = step === STEPS - 1;
    $('raceNext').hidden = last; $('raceNow').hidden = last; $('startBtn').hidden = !last;
    $('startBtn').textContent = s.cars === 1 ? 'Drive' : quali ? 'To qualifying' : 'To the grid';
    $('raceBack').textContent = step === 0 ? 'Paddock' : 'Back';
    // step 1: the circuit
    $('circName').textContent = name;
    $('raceMap').setAttribute('d', O.d); $('raceMapU').setAttribute('d', O.d);
    $('raceMapSvg').setAttribute('aria-label', `Map of ${name}`);
    $('raceMapStart').setAttribute('x', O.start[0] - 1.2); $('raceMapStart').setAttribute('y', O.start[1] - 3.5);
    for (const b of circList.children) b.setAttribute('aria-checked', String(b.dataset.id === T.id));
    // step 2: the field
    const field = [...SIM.DRIVERS.filter(d => !d.player).slice(0, Math.max(0, s.cars - 1)), { name: 'You', team: 'Gridline', color: null, you: true }];
    $('fieldChips').replaceChildren(...field.map(d => { const c = el('span', d.you ? 'you' : ''), sw = el('i');
      sw.style.background = d.you ? ctx.playerColour() : '#' + d.color.toString(16).padStart(6, '0');
      c.append(sw, document.createTextNode(d.name + ' '), el('em', '', d.team)); return c; }));
    // step 3: the rules
    for (const seg of ruleRows.querySelectorAll('.seg')) for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(s[seg.dataset.key])));
    // step 4: the grid (your best against the rivals' times, or qualifying first)
    drawGrid();
    // time trial
    $('trialTitle').textContent = `Time trial · ${name}`;
    $('trialGo').textContent = `Drive · chase ${ctx.ghostName()}`;
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
  $('tileContinue').onclick = () => ctx.start();
  $('tileRace').onclick = () => show('race');
  $('tileQuick').onclick = () => { if (game.setup.type === 'trial') ctx.setType('laps'); ctx.start(); };
  $('tileTrial').onclick = () => show('trial');
  $('padStatus').onclick = () => ctx.openSettings('controller');
  $('mnHomeBtn').onclick = () => show(null);
  for (const b of document.querySelectorAll('.mn-nav[data-page]')) b.onclick = () => show(b.dataset.page);
  $('railGarage').onclick = () => ctx.openGarage();
  $('railSettings').onclick = () => ctx.openSettings();
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
    const all = [...root.querySelectorAll('button, [tabindex="0"]')].filter(b => b.offsetParent && !b.disabled && !b.hidden);
    const cur = root.contains(document.activeElement) ? document.activeElement : null;
    if (!cur) { focusFirst(); return; }
    // (edge to edge that way; across, 0 when the two line up at all, else the gap: a tall tile reaches both rows beside it,
    // and between equals the first in the page wins)
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
  addEventListener('keydown', e => {
    if (root.hidden || e.target.closest?.('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir) { e.preventDefault(); nav(dir); }
  });

  // the menu keeps the mock-up's size and proportions: a fixed 1280 × 800, shrunk evenly only when the window is smaller
  // (user, 1440p: scaled up it was "too big"; styles: .mn)
  const MENU_SIZE = [1280, 800];
  const fit = () => root.style.setProperty('--mn-scale', String(Math.min(1, innerWidth / MENU_SIZE[0], innerHeight / MENU_SIZE[1])));
  addEventListener('resize', fit); fit();

  return {
    get page() { return page; },
    home() { show(null); }, show, refresh, nav, back, circuit,
    // pad A: press the focused button (nothing focused yet: focus the first one)
    confirm() { const f = document.activeElement; if (root.contains(f) && f.tagName === 'BUTTON') f.click(); else focusFirst(); },
  };
}
