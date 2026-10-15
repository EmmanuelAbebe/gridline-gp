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
    flash, toast,
    // fades out flash/toast on real time
    tick(dt) {
      if (msgTimer > 0 && (msgTimer -= dt) <= 0) $('msg').classList.remove('show');
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');
    },
    setStartLamps(n) { lampEls.forEach((l, i) => l.classList.toggle('on', i < n)); },
    showLights(on) { $('lights').hidden = !on; },
    setLapTimes(last, best, lastInvalid = false) { $('tLast').textContent = fmtTime(last); $('tLast').classList.toggle('invalid', lastInvalid); $('tBest').textContent = fmtTime(best); },
    // revs: rev-light fraction 0..1 (all lit = shift); slip: slipstream strength 0..1
    updateDash({ kmh, gear, revs, steer, thr, brk, lapTime, slip = 0, lapInvalid = false }) {
      setText('spd', kmh);
      setText('gear', gear);
      setOnce('revs', Math.round(revs * REV_LEDS), n => revEls.forEach((s, i) => s.classList.toggle('on', i < n)));
      setOnce('slipOn', slip > 0.08, on => $('slipTag').classList.toggle('on', on));
      setOnce('slip', Math.round(slip * 40), q => { fill.slip.style.transform = `scaleX(${q / 40})`; });
      setOnce('steer', Math.round(steer * 100), q => { fill.steer.style.transform = `translateX(${q < 0 ? q : 0}%) scaleX(${Math.abs(q) / 100})`; });
      setOnce('thr', Math.round(thr * 50), q => { fill.thr.style.transform = `scaleX(${q / 50})`; });
      setOnce('brk', Math.round(brk * 50), q => { fill.brk.style.transform = `scaleX(${q / 50})`; });
      setText('tCur', lapTime);
      setOnce('lapInvalid', lapInvalid, on => $('tCur').classList.toggle('invalid', on));
    },
    updateTower(race, player, showGaps) {
      const ord = SIM.order(race), leader = ord[0];
      setText('towerLap', towerTitle(race, leader));
      setText('posOf', '/' + race.cars.length);
      const timed = race.format.type === 'timed';
      $('timeLeftBox').hidden = !timed;
      if (timed) setText('timeLeft', fmtClock(race.duration - race.t));
      $('towerList').innerHTML = ord.map((c, i) =>
        `<li class="${c.player ? 'me' : ''} ${c.finished ? 'fin' : ''}"><span class="p">${i+1}</span><i style="background:${hexCss(c.color)}"></i><span class="c">${c.code}</span><span class="g num">${towerGap(race, leader, c, i, showGaps)}</span></li>`).join('');
      setText('pos', 'P' + (ord.indexOf(player) + 1));
      setText('lap', lapOf(race, player));
    },
    renderResults(race, player) {
      const ord = SIM.order(race), leader = ord[0], pos = ord.indexOf(player) + 1, gained = (player.slot + 1) - pos;
      $('verdict').innerHTML = pos === 1 ? 'Race <em>winner</em>' : `Finished <em>${ordinal(pos)}</em>`;
      $('verdict').title = gained > 0 ? `Gained ${gained} places` : '';
      $('resBody').innerHTML = ord.map((c, i) =>
        `<tr class="${c.player ? 'me' : ''}"><td class="num">${i+1}</td><td><i style="background:${hexCss(c.color)}"></i>${c.name}</td><td class="team">${c.team}</td><td class="r num">${resultTime(race, leader, c, i)}${c.penalty ? `<span class="pen">+${c.penalty} s pen</span>` : ''}</td><td class="r num${race.fastestBy === c ? ' best' : ''}">${fmtTime(c.bestLap)}</td></tr>`).join('');
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
      const label = on ? 'Wheel connected. Tilt to steer, pedals for gas and brake, A to start.'
        : allowed ? `Phone wheel: press gas on your phone once so ${window.gridlineApp ? 'the game' : 'the browser'} sees it.`
        : 'This view blocks controllers. Run the wheel in keyboard mode: PhoneWheel --keyboard --window gridline';
      if (label !== padLabel) { $('padText').textContent = label; padLabel = label; }
    },
  };
})();
