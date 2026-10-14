import { CONFIG } from './config.js';
import { DESIGN_DEFAULTS } from './design-defaults.js';
import { Settings } from './settings.js';
import { createEmitter } from './util.js';

// Live design data (DESIGN_DEFAULTS + saved edits). Editors change `Design.data` in place, then call changed().
// Emits 'change' (section) after edits and 'replaced' after a reset or import (editors should re-read everything).
export const PART_DEFAULT = Object.freeze({ name: 'part', shape: 'box', size: [0.3, 0.3, 0.3], radius: 0.02, pos: [0, 0.5, 0], rot: [0, 0, 0], color: 'body', show: 'always', steer: false });
export const WHEEL_DEFAULT = Object.freeze({ name: 'wheel', pos: [0, 0.36, 0], radius: 0.36, width: 0.36, front: false });
export const Design = (() => {
  const clone = o => JSON.parse(JSON.stringify(o));
  const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const vec = (v, d) => d.map((x, i) => Array.isArray(v) && Number.isFinite(+v[i]) ? +v[i] : x);
  const part = p => ({ ...clone(PART_DEFAULT), ...p, size: vec(p.size, PART_DEFAULT.size), pos: vec(p.pos, PART_DEFAULT.pos), rot: vec(p.rot, PART_DEFAULT.rot) });
  const wheel = w => ({ ...clone(WHEEL_DEFAULT), ...w, pos: vec(w.pos, WHEEL_DEFAULT.pos) });
  // Defaults with `saved` laid over them; missing or malformed fields fall back to the defaults.
  // (When the format changes, bump DESIGN_DEFAULTS.version and migrate older saves here.)
  // Bring an older saved design up to the current format.
  function migrate(s) {
    const v = s.version || 1;
    if (v < 2 && isObj(s.car)) {
      // v2: steering-wheel parts and the screen are positioned relative to the wheel centre instead of the car
      const piv = vec(isObj(s.car.steering) ? s.car.steering.pivot : null, [0.45, 0.78, 0]);
      const rel = v => Array.isArray(v) ? v.map((x, i) => (+x || 0) - piv[i]) : v;
      if (Array.isArray(s.car.parts)) for (const p of s.car.parts) if (isObj(p) && p.steer) p.pos = rel(p.pos);
      if (isObj(s.car.screen)) s.car.screen.pos = rel(s.car.screen.pos);
    }
    if (v < 3 && isObj(s.car)) {
      // v3: wheel tilt → full rotation, uniform size → per-axis scale, screen always fixed to the wheel
      const st = s.car.steering;
      if (isObj(st)) {
        if (!Array.isArray(st.rot)) st.rot = [0, 0, +st.tilt || 0];
        if (!Array.isArray(st.scale)) { const k = +st.scale || 1; st.scale = [k, k, k]; }
        delete st.tilt;
      }
      if (isObj(s.car.screen)) delete s.car.screen.steer;
    }
    if (v < 4 && isObj(s.car)) {
      // v4: the curved F1 body replaced the box car; keep only the player's steering wheel (and its settings)
      const mine = Array.isArray(s.car.parts) ? s.car.parts.filter(p => isObj(p) && p.steer) : [];
      s.car.parts = DESIGN_DEFAULTS.car.parts.filter(p => !p.steer).concat(mine.length ? mine : DESIGN_DEFAULTS.car.parts.filter(p => p.steer));
      delete s.car.wheels;
    }
    s.version = DESIGN_DEFAULTS.version;
    return s;
  }
  function normalize(saved) {
    const d = clone(DESIGN_DEFAULTS), s = isObj(saved) ? migrate(clone(saved)) : {};
    if (Array.isArray(s.cameras)) d.cameras = d.cameras.map(c => ({ ...c, ...(s.cameras.find(x => isObj(x) && x.id === c.id) || {}) }));
    const car = isObj(s.car) ? s.car : {};
    d.car.parts = (Array.isArray(car.parts) ? car.parts.filter(isObj) : d.car.parts).map(part);
    d.car.wheels = (Array.isArray(car.wheels) && car.wheels.length ? car.wheels.filter(isObj) : d.car.wheels).map(wheel);
    if (isObj(car.steering)) { const c = car.steering, st = d.car.steering; d.car.steering = { ...st, ...c, pivot: vec(c.pivot, st.pivot), rot: vec(c.rot, st.rot), scale: vec(c.scale, st.scale) }; }
    if (isObj(car.screen)) { const c = car.screen, sc = d.car.screen; d.car.screen = { ...sc, ...c, pos: vec(c.pos, sc.pos), rot: vec(c.rot, sc.rot), size: vec(c.size, sc.size) }; }
    if (isObj(s.hud)) {
      if (isObj(s.hud.theme)) Object.assign(d.hud.theme, s.hud.theme);
      if (isObj(s.hud.layouts)) d.hud.layouts = { all: {}, ...s.hud.layouts };
    }
    return d;
  }
  const events = createEmitter(), KEY = CONFIG.storageKeys.design;
  let data = normalize((() => { try { return JSON.parse(Settings.get(KEY)); } catch (e) { return null; } })());
  let saveTimer = 0;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => Settings.set(KEY, JSON.stringify(data)), 300); };
  return {
    get data() { return data; },
    part, wheel,
    changed(section) { save(); events.emit('change', section); },
    replace(next) { data = normalize(next); save(); events.emit('change', 'all'); events.emit('replaced'); },
    reset(section) {
      const d = normalize(null);
      if (section) data[section] = d[section]; else data = d;
      save(); events.emit('change', section || 'all'); events.emit('replaced');
    },
    json: () => JSON.stringify(data, null, 2),
    defaults: () => normalize(null),
    on: events.on,
  };
})();
