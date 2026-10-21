// Is the driver still there? (pure: no DOM; tests/presence.test.js). 2026-10-21, user: detect an idle phone wheel or
// gamepad and ask "are you there?". Each frame while racing it looks at the controller that drives and says why the race
// should stop, or null:
//   'phone'  the phone wheel says it is on a table or was left alone for 10 s (the phone decides: it has the motion sensors; it sends
//            neutral inputs with `a` > 0 and shows its own "I'm here" button)
//   'idle'   a gamepad / wheel / joystick whose every axis and button stayed exactly the same for PRESENCE.idleAfter s
//            (a held pad always moves a little; one put down doesn't)
//   'lost'   the controller that was driving disconnected (or the phone's link dropped) for PRESENCE.lostAfter s
// Keyboard-only driving never counts as idle.
export const PRESENCE = Object.freeze({
  idleAfter: 10,        // s without any change on a pad (2026-10-21, user: 10 s, as the phone)
  lostAfter: 1,         // s gone before it counts (a phone's Wi-Fi blip reconnects within that)
  axisStep: 0.004,      // an axis must move more than this to count as a change (some pads repeat tiny noise)
});

export function createPresence() {
  let lastSig = '', still = 0, gone = 0, had = null;
  const sig = p => p.axes.map(a => Math.round(a / PRESENCE.axisStep)).join(',') + '|' + p.buttons.map(b => b.pressed ? 1 : Math.round((b.value || 0) * 100)).join(',');
  return {
    // racing: the race clock is running for the player; pad: the controller that drives (controllers.js pick) or
    // null; phoneAway: the phone's `a` (0 = there)
    update(dt, { racing, pad, phoneAway = 0 }) {
      if (!racing) { still = gone = 0; lastSig = ''; had = pad ? pad.key : null; return null; }
      if (!pad) {
        if (had) { gone += dt; if (gone >= PRESENCE.lostAfter) return 'lost'; }
        return null;
      }
      gone = 0; had = pad.key;
      if (pad.kind === 'phone') { still = 0; return phoneAway > 0 ? 'phone' : null; }
      const s = sig(pad);
      if (s !== lastSig) { lastSig = s; still = 0; return null; }
      still += dt;
      return still >= PRESENCE.idleAfter ? 'idle' : null;
    },
    // after "I'm here": start counting again
    reset() { still = gone = 0; lastSig = ''; had = null; },   // (and forget a lost controller: carrying on without it)
    // the controller that was driving (for 'lost': waiting for it to come back)
    get lastKey() { return had; },
  };
}
