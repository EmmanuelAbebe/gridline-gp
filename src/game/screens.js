import { RACE_SETUP } from './config.js';
import { $, ordinal, NUMBER_WORDS, ORDINAL_WORDS } from './util.js';

// Overlays (start / pause / results) and the start-menu controls.
export const Screens = (() => {
  const overlays = { start: $('startOv'), pause: $('pauseOv'), results: $('resOv') };
  const markSeg = (seg, attr, value) => { for (const b of seg.children) b.setAttribute('aria-pressed', b.dataset[attr] === String(value) ? 'true' : 'false'); };
  const bindSeg = (seg, attr, fn) => seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) fn(b.dataset[attr]); });
  return {
    show(name, focusId) { for (const [k, el] of Object.entries(overlays)) el.hidden = k !== name; if (focusId) $(focusId).focus(); },
    hud(on) { $('hud').hidden = !on; },
    describeEvent(track, cars, playerSlot) {
      $('eventLine').textContent = `Round 1 · ${track.name} Circuit · ${(track.L / 1000).toFixed(2)} km`;
      const n = NUMBER_WORDS[cars] || String(cars), word = n[0].toUpperCase() + n.slice(1);
      $('introText').textContent = cars === 1 ? 'Just you and the circuit: no rivals, so learn your lines.'
        : `${word} cars, five red lights. You start ${ORDINAL_WORDS[playerSlot] || ordinal(playerSlot + 1)} on the grid.`;
    },
    // Race setup controls (cars, race type, laps or minutes, gearbox, assists). `setup` is edited in place; onChange after each edit.
    bindSetup(setup, maxCars, onChange) {
      const minIdx = () => Math.max(0, RACE_SETUP.minutes.indexOf(setup.minutes));
      function render() {
        $('carsVal').textContent = setup.cars === 1 ? '1 (solo)' : String(setup.cars);
        markSeg($('typeSeg'), 't', setup.type);
        markSeg($('gearSeg'), 'b', setup.gearbox);
        markSeg($('assistSeg'), 'a', setup.assists);
        $('assistNote').textContent = RACE_SETUP.assistNotes[setup.assists];
        $('amountRow').hidden = setup.type === 'unlimited';
        $('amountLbl').textContent = setup.type === 'timed' ? 'Race time' : 'Laps';
        $('amountVal').textContent = setup.type === 'timed' ? setup.minutes + ' min' : setup.laps + (setup.laps === 1 ? ' lap' : ' laps');
        const [cDown, cUp] = $('carsStep').querySelectorAll('button'), [aDown, aUp] = $('amountStep').querySelectorAll('button');
        cDown.disabled = setup.cars <= 1; cUp.disabled = setup.cars >= maxCars;
        aDown.disabled = setup.type === 'timed' ? minIdx() === 0 : setup.laps <= 1;
        aUp.disabled = setup.type === 'timed' ? minIdx() === RACE_SETUP.minutes.length - 1 : setup.laps >= RACE_SETUP.maxLaps;
      }
      const change = () => { render(); onChange(); };
      // press and hold a stepper button to keep counting
      function stepper(el, step) {
        for (const b of el.querySelectorAll('button')) {
          let timer = 0;
          const stop = () => clearTimeout(timer);
          const tick = delay => { step(+b.dataset.d); change(); timer = setTimeout(() => tick(Math.max(60, delay * 0.8)), delay); };
          b.addEventListener('pointerdown', e => { if (e.button === 0 && !b.disabled) { e.preventDefault(); tick(380); } });
          for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
          b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(+b.dataset.d); change(); } });
        }
      }
      stepper($('carsStep'), d => { setup.cars = Math.min(maxCars, Math.max(1, setup.cars + d)); });
      stepper($('amountStep'), d => {
        if (setup.type === 'timed') setup.minutes = RACE_SETUP.minutes[Math.min(RACE_SETUP.minutes.length - 1, Math.max(0, minIdx() + d))];
        else setup.laps = Math.min(RACE_SETUP.maxLaps, Math.max(1, setup.laps + d));
      });
      bindSeg($('typeSeg'), 't', t => { setup.type = t; change(); });
      bindSeg($('gearSeg'), 'b', b => { setup.gearbox = b; change(); });
      bindSeg($('assistSeg'), 'a', a => { setup.assists = a; change(); });
      render();
    },
    onGfx(fn) { bindSeg($('gfxSeg'), 'g', fn); },
    showGfx(id, note) { markSeg($('gfxSeg'), 'g', id); $('gfxNote').textContent = note; },
  };
})();
