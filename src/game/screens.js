import { RACE_SETUP } from './config.js';
import { $, ordinal, NUMBER_WORDS, ORDINAL_WORDS } from './util.js';

// Overlays (start / pause / results) and the start-menu controls.
export const Screens = (() => {
  const overlays = { start: $('startOv'), pause: $('pauseOv'), results: $('resOv') };
  const markSeg = (seg, attr, value) => { for (const b of seg.children) b.setAttribute('aria-pressed', b.dataset[attr] === String(value) ? 'true' : 'false'); };
  // a segmented control's buttons from a choices list ([value, label], config.js RACE_SETUP.choices)
  const fillSeg = (seg, attr, list) => seg.replaceChildren(...list.map(([v, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset[attr] = v; b.textContent = label;
    b.setAttribute('aria-pressed', 'false'); return b;
  }));
  const bindSeg = (seg, attr, fn) => seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) fn(b.dataset[attr]); });
  return {
    show(name, focusId) { for (const [k, el] of Object.entries(overlays)) el.hidden = k !== name; if (focusId) $(focusId).focus(); },
    current() { return Object.keys(overlays).find(k => !overlays[k].hidden) || null; },
    hud(on) { $('hud').hidden = !on; },
    describeEvent(track, cars, playerSlot) {
      $('eventLine').textContent = `Round 1 · ${track.name} Circuit · ${(track.L / 1000).toFixed(2)} km`;
      const n = NUMBER_WORDS[cars] || String(cars), word = n[0].toUpperCase() + n.slice(1);
      $('introText').textContent = cars === 1 ? 'Just you and the circuit: no rivals, so learn your lines.'
        : `${word} cars, five red lights. You start ${ORDINAL_WORDS[playerSlot] || ordinal(playerSlot + 1)} on the grid.`;
    },
    // Race setup controls (cars, race type, laps or minutes, rivals; gearbox and assists are on the Settings screen).
    // `setup` is edited in place; onChange after each edit. Returns render(), for edits made elsewhere.
    // circuits: [{ id, name, blurb }]; the length is filled in by trackInfo() once the circuit is built
    bindSetup(setup, maxCars, circuits, onChange) {
      const minIdx = () => Math.max(0, RACE_SETUP.minutes.indexOf(setup.minutes));
      fillSeg($('typeSeg'), 't', RACE_SETUP.choices.type); fillSeg($('aiSeg'), 'l', RACE_SETUP.choices.ai);
      function render() {
        $('trackVal').textContent = circuits.find(c => c.id === setup.track)?.name ?? setup.track;
        $('carsVal').textContent = setup.cars === 1 ? '1 (solo)' : String(setup.cars);
        markSeg($('typeSeg'), 't', setup.type);
        markSeg($('aiSeg'), 'l', setup.ai);
        $('aiNote').textContent = RACE_SETUP.aiLevels[setup.ai].note;
        const trial = setup.type === 'trial';
        $('aiSeg').closest('.row').hidden = $('aiNote').hidden = setup.cars === 1 || trial;
        $('carsStep').closest('.row').hidden = trial; $('ghostRow').hidden = !trial;
        $('amountRow').hidden = setup.type === 'unlimited' || trial;
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
      for (const b of $('trackStep').querySelectorAll('button')) b.addEventListener('click', () => {
        const i = circuits.findIndex(c => c.id === setup.track), n = circuits.length;
        setup.track = circuits[(i + +b.dataset.d + n) % n].id; change();
      });
      stepper($('carsStep'), d => { setup.cars = Math.min(maxCars, Math.max(1, setup.cars + d)); });
      stepper($('amountStep'), d => {
        if (setup.type === 'timed') setup.minutes = RACE_SETUP.minutes[Math.min(RACE_SETUP.minutes.length - 1, Math.max(0, minIdx() + d))];
        else setup.laps = Math.min(RACE_SETUP.maxLaps, Math.max(1, setup.laps + d));
      });
      bindSeg($('typeSeg'), 't', t => { setup.type = t; change(); });
      bindSeg($('aiSeg'), 'l', l => { setup.ai = l; change(); });
      render();
      return render;
    },
    trackInfo(track, blurb, record = '') { $('trackNote').textContent = `${(track.L / 1000).toFixed(2)} km · ${blurb}${record ? '  ·  Your ' + record : ''}`; },
    // one line under the race setup: the Settings-screen choices that change how the race drives
    summary(text) { $('setupSummary').textContent = text; },
  };
})();
