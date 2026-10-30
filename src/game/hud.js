import { SIM } from '../sim/index.js';
import { CONFIG } from './config.js';
import { $, fmtTime, fmtClock, ordinal, hexCss } from './util.js';

// All DOM writes for the in-race graphics. Writes are cached so unchanged values don't touch the DOM.
export const Hud = (() => {
  const REV_LEDS = 14, REV_RED = 9, REV_VIOLET = 12;
  const revEls = [];
  for (let i = 0; i < REV_LEDS; i++) { const s = document.createElement('span'); if (i >= REV_RED) s.className = i >= REV_VIOLET ? 'v' : 'r'; $('revs').appendChild(s); revEls.push(s); }
  const lampEls = [];
  for (let i = 0; i < CONFIG.lights.count; i++) { const d = document.createElement('div'); d.className = 'lamp'; d.innerHTML = '<i></i><i></i>'; $('lights').appendChild(d); lampEls.push(d); }
  const fill = { steer: $('steerFill'), thr: $('thrFill'), brk: $('brkFill'), slip: $('slipFill') };

  const cache = {}, els = {};
  function setText(id, v) { v = String(v); if (cache[id] === v) return; cache[id] = v; (els[id] ||= $(id)).textContent = v; }
  function setOnce(key, v, apply) { if (cache[key] === v) return; cache[key] = v; apply(v); }

  let msgTimer = 0, toastTimer = 0, padLabel = '';
  function flash(text, dur = 1) { $('msg').textContent = text; $('msg').classList.add('show'); msgTimer = dur; }
  function toast(text, cls = '', dur = 2.2) { const t = $('toast'); t.textContent = text; t.className = 'panel show ' + cls; toastTimer = dur; }
  // team radio: the pit wall talking to the player (fuel, tyres, damage, pit stops)
  let radioTimer = 0;
  function radio(text, dur = 4.5) { $('radioText').textContent = text; $('radio').classList.add('show'); radioTimer = dur; }

  const towerGap = (race, leader, c, i, showGaps) => {
    if (!showGaps) return '';
    if (i === 0) return leader.finished ? 'WIN' : 'LEADER';
    const gp = SIM.gapTo(race, leader, c);
    return gp.laps ? '+' + gp.laps + ' LAP' : '+' + gp.t.toFixed(1);
  };
  const resultTime = (race, leader, c, i) => {
    if (i === 0) { if (c.finished) return fmtTime(SIM.raceTime(c)); const n = Math.max(0, c.lap - 1); return `${n} lap${n === 1 ? '' : 's'}`; }   // race ended early
    const gp = SIM.gapTo(race, leader, c);
    return gp.laps ? '+' + gp.laps + ' lap' + (gp.laps > 1 ? 's' : '') : '+' + gp.t.toFixed(3);
  };
  // "2/5" in a lap race; the current lap (or laps done, once finished) in timed and unlimited races
  const lapOf = (race, c) => race.format.type === 'laps' ? Math.min(race.laps, Math.max(1, c.lap)) + '/' + race.laps
    : String(Math.max(1, c.finished ? c.finishLap - 1 : c.lap));
  function towerTitle(race, leader) {
    if (race.format.type !== 'timed') return 'LAP ' + lapOf(race, leader);
    if (race.chequered) return 'CHEQUERED FLAG';
    const left = race.duration - race.t;
    return left > 0 ? fmtClock(left) + ' LEFT' : 'FINAL LAP';
  }

  return {
    flash, toast, radio,
    // fades out flash/toast on real time
    tick(dt) {
      if (msgTimer > 0 && (msgTimer -= dt) <= 0) $('msg').classList.remove('show');
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');
      if (radioTimer > 0 && (radioTimer -= dt) <= 0) $('radio').classList.remove('show');
    },
    setStartLamps(n) { lampEls.forEach((l, i) => l.classList.toggle('on', i < n)); },
    showLights(on) { $('lights').hidden = !on; },
    setLapTimes(last, best, lastInvalid = false) { $('tLast').textContent = fmtTime(last); $('tLast').classList.toggle('invalid', lastInvalid); $('tBest').textContent = fmtTime(best); },
    // revs: rev-light fraction 0..1 (all lit = shift); slip: slipstream strength 0..1; dirt: tyre dirt 0..1
    // gearNext: the gear a waiting manual downshift will drop to (shown in the gear label), or null
    updateDash({ kmh, gear, gearNext = null, revs, steer, steerIn, thr, brk, lapTime, slip = 0, lapInvalid = false, dirt = 0 }) {
      setText('spd', kmh);
      setText('gear', gear);
      setOnce('gearNext', gearNext, n => { $('gearLbl').textContent = n ? '▼ ' + n : 'Gear'; $('gearLbl').classList.toggle('queued', !!n); });
      setOnce('revs', Math.round(revs * REV_LEDS), n => revEls.forEach((s, i) => s.classList.toggle('on', i < n)));
      setOnce('slipOn', slip > 0.08, on => $('slipTag').classList.toggle('on', on));
      setOnce('dirtOn', dirt > 0.05, on => $('dirtTag').classList.toggle('on', on));   // dirty tyres after an off
      setOnce('slip', Math.round(slip * 40), q => { fill.slip.style.transform = `scaleX(${q / 40})`; });
      setOnce('steer', Math.round(steer * 100), q => { fill.steer.style.transform = `translateX(${q < 0 ? q : 0}%) scaleX(${Math.abs(q) / 100})`; });
      setOnce('steerLock', Math.abs(steerIn ?? steer) >= 0.98 ? Math.sign(steerIn ?? steer) : 0, l => { const m = $('steerMeter'); m.classList.toggle('lock-l', l < 0); m.classList.toggle('lock-r', l > 0); });   // full lock
      setOnce('thr', Math.round(thr * 50), q => { fill.thr.style.transform = `scaleX(${q / 50})`; });
      setOnce('brk', Math.round(brk * 50), q => { fill.brk.style.transform = `scaleX(${q / 50})`; });
      setText('tCur', lapTime);
      setOnce('lapInvalid', lapInvalid, on => $('tCur').classList.toggle('invalid', on));
    },
    // time trial: your lap time minus the ghost's at the same point (+ = slower; null = no ghost / before the first split)
    setDelta(d, on) {
      setOnce('deltaOn', on, v => { $('tDelta').hidden = $('deltaLbl').hidden = !v; });
      const t = d === null || d === undefined ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(2);
      setOnce('deltaTxt', t, v => { $('tDelta').textContent = v; $('tDelta').className = 'num ' + (d > 0.005 ? 'slower' : d < -0.005 ? 'faster' : ''); });
    },
    // ---- sectors (sector-timing.js): a cell per sector, a bar per mini-sector; colour = purple / green / yellow / invalid /
    // none; the last lap's stay dim until this lap's replace them ----
    sectorSetup(L) {
      const row = $('secRow'); row.style.setProperty('--n', L.sectors.length);
      row.replaceChildren(...L.sectors.map((_, s) => { const d = document.createElement('div'); d.className = 'sec';
        d.innerHTML = `<span class="lbl">S${s + 1}</span><b class="num">–</b><i class="num"></i>`; return d; }));
      $('secMinis').replaceChildren(...L.minis.map(m => { const e = document.createElement('span'); e.title = m.name; return e; }));
    },
    sectorRef(text) { setText('secRef', text ? 'vs ' + text : ''); },
    sectorNewLap() {
      for (const d of $('secRow').children) d.classList.add('old');
      for (const e of $('secMinis').children) e.classList.add('old');
    },
    sectorMini(m, colour) { const e = $('secMinis').children[m]; if (e) e.className = colour; },
    sectorTime(s, time, delta, colour) {
      const d = $('secRow').children[s]; if (!d) return;
      d.className = 'sec ' + colour;
      d.querySelector('b').textContent = time.toFixed(3);
      const i = d.querySelector('i');
      i.textContent = delta === null ? '' : (delta > 0 ? '+' : delta < 0 ? '−' : '±') + Math.abs(delta).toFixed(3);
      i.className = 'num ' + (delta === null ? '' : delta < -0.0005 ? 'faster' : delta > 0.0005 ? 'slower' : '');
    },
    // car condition rows (only what the race uses) and the pit status line
    updateCar(race, c) {
      const W = race.wear, tt = !!(race.tyreTemp && c.tyreT), on = !!(W && (W.fuelLaps || W.tyreLaps || W.damage)) || tt;
      setOnce('carOn', true, v => { $('carState').hidden = !v; });   // (the tyres row always: the compound)
      setOnce('ttOn', tt, v => { $('tt').hidden = !v; $('ttLbl').hidden = !v; });
      if (tt) {                                    // the four tyres' grip temperatures, FL FR / RL RR
        const [lo, hi] = c.tyreT.win, cells = ($('tt').children);   // (the compound's window)
        for (let i = 0; i < 4; i++) {
          const t = Math.round(SIM.gripTemp(c.tyreT, i));
          setOnce('tt' + i, t, v => { cells[i].textContent = v; cells[i].className = v < lo - 5 ? 'cold' : v > hi + 5 ? 'hot' : 'ok'; });
        }
      }
      const showRow = (id, v) => { $(id).hidden = !v; $(id + 'Lbl').hidden = !v; };   // (fuelLbl, tyresLbl, dmgLbl)
      setOnce('fuelOn', !!W?.fuelLaps, v => showRow('fuel', v)); setOnce('tyresOn', true, v => showRow('tyres', v)); setOnce('dmgOn', !!W?.damage, v => showRow('dmg', v));
      // the compound on the car (S / M / H in Pirelli's colours) and, with tyre wear, how much is left
      const q = W?.tyreLaps ? Math.round((1 - c.tyreWear) * 100) : null;
      setOnce('tyreTxt', `${c.compound}:${q}`, () => {
        const k = el => { const b = document.createElement('b'); b.className = 'cmp ' + c.compound; b.textContent = el; return b; };
        $('tyres').replaceChildren(k(c.compound[0].toUpperCase()), q === null ? ' ' + c.compound.toUpperCase() : ` ${q} %`);
      });
      if (on && W) {
        if (W.fuelLaps) {
          const left = SIM.fuelLaps(race, c), short = left < SIM.lapsToGo(race, c);
          setOnce('fuelTxt', c.fuel <= 0 ? 'EMPTY' : left.toFixed(1) + ' laps', t => { $('fuel').textContent = t; });
          setOnce('fuelCls', c.fuel <= 0 || (short && left < 1) ? 'bad' : short ? 'warn' : '', k => { $('fuel').className = k; });
        }
        if (W.tyreLaps) setOnce('tyreCls', q < 25 ? 'bad' : q < 45 ? 'warn' : '', k => { $('tyres').className = k; });
        if (W.damage) {
          const d = c.damage, parts = [['wing', 'WING'], ['floor', 'FLOOR'], ['susp', 'SUSP']].filter(([k]) => d[k] > 0.08);
          const worst = Math.max(d.wing, d.floor, d.susp);
          setOnce('dmgTxt', parts.length ? parts.map(([k, n]) => `${n} ${Math.round(d[k] * 100)}%`).join(' ') : 'none', t => { $('dmg').textContent = t; });
          setOnce('dmgCls', worst > 0.5 ? 'bad' : worst > 0.08 ? 'warn' : '', k => { $('dmg').className = k; });
        }
      }
      // the power unit's battery (SIM ERS): charge, and whether it is deploying (yellow) or harvesting (blue)
      const soc = Math.round(c.soc / SIM.ERS.store * 100), ers = c.ersKw > 5 ? 'out' : c.ersKw < -5 ? 'in' : '';
      setOnce('ersPct', soc, v => { $('ersPct').textContent = v + '%'; $('ersFill').style.width = v + '%'; });
      setOnce('ersFlow', ers, k => { $('ers').className = k; });
      const pit = c.pit ? (c.pit.phase === 'stop' ? 'PIT STOP' : c.pitLimiter ? 'PIT LIMITER' : c.pit.drive && !c.pit.entered ? 'PIT ENTRY' : 'PIT EXIT')
        : c.pitLimiter ? 'PIT LIMITER' : c.pitRequest ? 'BOX THIS LAP' : '';
      // active aero: straight mode chip (on the button setting: dim = in a zone, yours to open), overtake mode (ready /
      // on with seconds left) and its button (BUTTON setting)
      const aero = !race.activeAero ? '' : c.aeroOpen > 0.5 ? 'on' : !c.aeroAuto && race.track.aeroZone[c.idx] && !c.pit ? 'ready' : '';
      setOnce('aeroOn', aero, v => { $('aeroTag').classList.toggle('on', !!v); $('aeroTag').classList.toggle('ready', v === 'ready'); });
      const boost = c.boostOn ? `OVERTAKE ${c.boostLeft.toFixed(1)} s` : c.boostLeft > 0 ? (c.boostAuto ? 'OVERTAKE READY' : 'OVERTAKE READY · X') : '';
      setOnce('boostTxt', boost, t => { if (t) $('boostTag').textContent = t; $('boostTag').classList.toggle('on', !!t); });
      setOnce('boostLive', c.boostOn, v => { $('boostTag').classList.toggle('live', v); $('boostBtn').classList.toggle('on', v); });
      setOnce('boostBtn', !!race.overtake && !c.boostAuto, v => { $('boostBtn').hidden = !v; });
      setOnce('pitTxt', pit, t => { $('pitState').hidden = !t; $('pitState').textContent = t; $('pitState').classList.toggle('limiter', !!c.pit || c.pitLimiter); $('boxBtn').classList.toggle('on', !!c.pit || c.pitRequest); });
    },
    updateTower(race, player, showGaps) {
      const ord = SIM.order(race), leader = ord[0];
      setText('towerLap', towerTitle(race, leader));
      setText('posOf', '/' + race.cars.length);
      const timed = race.format.type === 'timed';
      $('timeLeftBox').hidden = !timed;
      if (timed) setText('timeLeft', fmtClock(race.duration - race.t));
      $('towerList').innerHTML = ord.map((c, i) =>
        `<li class="${c.player ? 'me' : ''} ${c.finished ? 'fin' : ''}"><span class="p">${i+1}</span><i style="background:${hexCss(c.color)}"></i><span class="c">${c.code}</span><span class="g num">${c.pit ? 'PIT' : towerGap(race, leader, c, i, showGaps)}</span></li>`).join('');
      setText('pos', 'P' + (ord.indexOf(player) + 1));
      setText('lap', lapOf(race, player));
    },
    // qualifying (starting-grid.js): the timing screen instead of the running order. rows = grid.js qualiStandings
    updateQualiTower(race, rows) {
      const left = race.duration - race.t;
      setText('towerLap', race.chequered || left <= 0 ? 'FINISH YOUR LAP' : 'QUALIFYING');
      setText('posOf', '/' + rows.length);
      $('timeLeftBox').hidden = false; setText('timeLeft', fmtClock(left));
      $('towerList').innerHTML = rows.map((r, i) =>
        `<li class="${r.driver.player ? 'me' : ''}"><span class="p">${i+1}</span><i style="background:${hexCss(r.driver.color)}"></i><span class="c">${r.driver.code}</span><span class="g num">${r.time === null ? 'NO TIME' : i === 0 ? fmtTime(r.time) : '+' + r.gap.toFixed(3)}</span></li>`).join('');
      setText('pos', 'P' + (rows.findIndex(r => r.driver.player) + 1));
      setText('lap', String(Math.max(1, race.cars.find(c => c.player).lap)));
    },
    // the qualifying classification (results screen): your slot on the grid
    renderQualiResults(rows) {
      const pos = rows.findIndex(r => r.driver.player) + 1, me = rows[pos - 1];
      $('verdict').innerHTML = me.time === null ? 'No time set: <em>back of the grid</em>' : pos === 1 ? '<em>Pole</em> position' : `Qualified <em>${ordinal(pos)}</em>`;
      $('verdict').title = '';
      $('resBody').innerHTML = rows.map((r, i) =>
        `<tr class="${r.driver.player ? 'me' : ''}"><td class="num">${i+1}</td><td><i style="background:${hexCss(r.driver.color)}"></i>${r.driver.name}</td><td class="team">${r.driver.team}</td><td class="r num">${r.time === null ? 'no time' : i === 0 ? 'POLE' : '+' + r.gap.toFixed(3)}</td><td class="r num${i === 0 && r.time !== null ? ' best' : ''}">${r.time === null ? '–' : fmtTime(r.time)}</td></tr>`).join('');
    },
    renderResults(race, player) {
      const ord = SIM.order(race), leader = ord[0], pos = ord.indexOf(player) + 1, gained = (player.slot + 1) - pos;
      $('verdict').innerHTML = pos === 1 ? 'Race <em>winner</em>' : `Finished <em>${ordinal(pos)}</em>`;
      $('verdict').title = gained > 0 ? `Gained ${gained} places` : '';
      $('resBody').innerHTML = ord.map((c, i) =>
        `<tr class="${c.player ? 'me' : ''}"><td class="num">${i+1}</td><td><i style="background:${hexCss(c.color)}"></i>${c.name}${c.player && c.spec.modified ? '<span class="mod" title="Open mods in the garage">MODIFIED</span>' : ''}</td><td class="team">${c.team}</td><td class="r num">${resultTime(race, leader, c, i)}${c.penalty ? `<span class="pen">+${c.penalty} s pen</span>` : ''}${c.pitStops ? `<span class="stops">${c.pitStops} stop${c.pitStops > 1 ? 's' : ''}</span>` : ''}</td><td class="r num${race.fastestBy === c ? ' best' : ''}">${fmtTime(c.bestLap)}</td></tr>`).join('');
    },
    setFps(fps, title) {
      setText('fpsNum', Math.round(fps));
      const chip = $('fpsChip'); chip.classList.toggle('low', fps < CONFIG.fps.low); chip.title = title;
    },
    showFps(on) { $('fpsChip').hidden = !on; },
    setMuted(m) { $('muteBtn').textContent = m ? 'SOUND OFF' : 'SOUND ON'; },
    setPad(on, allowed) {
      $('padChip').hidden = !on; $('padChip').classList.toggle('on', on);
      const row = $('padStatus');
      row.classList.toggle('on', on); row.classList.toggle('warn', !on && !allowed);
      // (the start menu's Race weekend footer shows it too)
      $('raceCtl').classList.toggle('on', on); $('raceCtlText').textContent = on ? 'Controller connected' : 'No controller connected';
      const label = on ? 'Controller connected. A to start; Settings → Controller lists every device.'
        : allowed ? (window.gridlineApp?.phone ? 'Phone wheel: connect it in Settings → Controller. Other controllers: press a button on it once.'
          : 'Phone wheel or controller: press gas or a button once so the browser sees it.')
        : 'This view blocks controllers. Run the wheel in keyboard mode: PhoneWheel --keyboard --window gridline';
      if (label !== padLabel) { $('padText').textContent = label; padLabel = label; }
    },
  };
})();
