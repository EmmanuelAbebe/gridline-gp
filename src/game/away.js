// "Are you there?" (split out of main.js 2026-10-21; presence.js decides): the phone wheel put down, a pad untouched
// for 10 s, or the controller that drives gone → the race pauses behind #awayOv; back = the phone's I'M HERE, A / Enter
// / the button, or the controller returning → a 3-2-1 count, then it runs (so the car doesn't jerk on the first input).
// Also: the race pauses when the window loses focus or is hidden (pref pauseOnBlur).
// ctx: { game, racing() (the race clock runs for the player), togglePause() }
import { SFX } from './config.js';
import { $ } from './util.js';
import { Input } from './input.js';
import { Sound } from './sound.js';
import { Screens } from './screens.js';
import { PhoneWheel } from './phone-wheel.js';
import { createPresence } from './presence.js';

const AWAY = {
  phone: ['Phone wheel put down', "Pick the phone up and tap I'm here on it: the race carries on after a 3 second count."],
  idle: ['Are you there?', "Your controller hasn't moved for a while. Press A, Enter or I'm here to carry on."],
  lost: ['Controller disconnected', 'Connect it again to carry on, or continue with the keyboard.'],
};

export function createAway({ game, racing, togglePause }) {
  const presence = createPresence();
  let away = null;                 // { reason, counting, key } while the overlay is up
  function show(reason) {
    away = { reason, counting: false, key: presence.lastKey };
    game.paused = true;
    const [title, note] = AWAY[reason];
    $('awayTitle').textContent = title; $('awayNote').textContent = note;
    $('awayBtn').textContent = reason === 'phone' ? 'Waiting for the phone…' : reason === 'lost' ? 'Continue' : "I'm here";
    $('awayBtn').disabled = reason === 'phone';
    Screens.show('away', reason === 'phone' ? 'awayMenuBtn' : 'awayBtn');
  }
  function back() {
    if (!away || away.counting) return;
    away.counting = true; $('awayBtn').disabled = true;
    let n = 3;
    const tick = () => {
      if (!away) return;                                  // went to the pause menu meanwhile
      if (n === 0) { away = null; Screens.show(null); game.paused = false; presence.reset(); return; }
      $('awayTitle').textContent = String(n); $('awayNote').textContent = 'Get ready'; Sound.beep(...SFX.light);
      n--; setTimeout(tick, 700);
    };
    tick();
  }
  const toPauseMenu = () => { away = null; Screens.show('pause', 'resumeBtn'); };
  $('awayBtn').onclick = back;
  $('awayMenuBtn').onclick = toPauseMenu;
  const leave = () => { if (game.prefs.pauseOnBlur && racing()) togglePause(); };
  addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });

  return {
    get open() { return !!away; },
    toPauseMenu,
    // pad A / Enter while it is up (the phone's own button is the way back from 'phone')
    confirm() { if (away && away.reason !== 'phone') back(); },
    // every frame, after Input.poll
    watch(dt) {
      if (away) {
        if (away.reason === 'phone' && !PhoneWheel.away) back();                                  // tapped "I'm here"
        if (away.reason === 'lost' && Input.device && Input.device.key === away.key) back();      // it's back
        return;
      }
      const why = presence.update(dt, { racing: racing() && !game.autopilot, pad: Input.device, phoneAway: PhoneWheel.away });
      if (why) show(why);
    },
  };
}
