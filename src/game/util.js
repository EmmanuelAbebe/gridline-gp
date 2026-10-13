// Small shared helpers: DOM lookup, formatting, an event emitter, race-clock timers.
export const $ = id => document.getElementById(id);

export const hexCss = n => '#' + n.toString(16).padStart(6, '0');
export const fmtTime = t => { if (!isFinite(t) || t <= 0) return '–'; const m = Math.floor(t/60), s = t - m*60; return m + ':' + s.toFixed(3).padStart(6, '0'); };
export const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th','st','nd','rd'][n % 10] || 'th');
export const NUMBER_WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
export const fmtClock = sec => { const t = Math.max(0, Math.ceil(sec)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
export const ORDINAL_WORDS = ['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];

export function createEmitter() {
  const handlers = {};
  return {
    on(name, fn) { (handlers[name] ||= []).push(fn); },
    emit(name, ...args) { for (const fn of handlers[name] || []) fn(...args); },
  };
}

// Delayed callbacks on whichever clock calls tick(). The game ticks them with race time, so they pause
// with the race and are cleared on restart (no stray setTimeouts firing into the next race).
export function createTimers() {
  let list = [];
  return {
    after(sec, fn) { list.push({ t: sec, fn }); },
    tick(dt) {
      if (!list.length) return;
      for (const x of list) x.t -= dt;
      const due = list.filter(x => x.t <= 0);
      if (due.length) { list = list.filter(x => x.t > 0); for (const x of due) x.fn(); }
    },
    clear() { list = []; },
  };
}
