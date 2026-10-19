import { html, render, useState, useEffect, useRef } from "./vendor/preact-htm.js";
import { BUTTONS, KEYBOARD_KEYS, MAX_BUTTONS, DEFAULTS, clone, sanitize, loadStore, saveStore, pedalValue, steerCurve, createFlick } from "./settings.js";
import * as engine from "./engine.js";

let haptics = true;
const buzz = (ms) => { if (haptics && navigator.vibrate) navigator.vibrate(ms); };

function setIn(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

function useLink() {
  const [link, setLink] = useState({ connected: engine.state.connected, paired: engine.state.paired });
  useEffect(() => engine.onStatus(setLink), []);
  return link;
}

// Runs `fn` every animation frame while mounted, for the 60 Hz bits that skip Preact rendering.
function useFrame(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id;
    const loop = () => { ref.current(); id = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(id);
  }, []);
}

// ---------------------------------------------------------------- app
function App() {
  const [store, setStore] = useState(loadStore);
  const [started, setStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warn, setWarn] = useState("");
  const cfg = store.profiles[store.active];

  engine.setConfig(cfg); // cheap, and keeps the engine in step on every render
  haptics = cfg.layout.haptics;
  useEffect(() => saveStore(store), [store]);
  useEffect(() => { engine.state.paused = settingsOpen; }, [settingsOpen]);

  // set("steer.smoothing", 30) edits the active profile.
  const set = (path, value) => setStore((s) => {
    const next = clone(s);
    setIn(next.profiles[next.active], path, value);
    return next;
  });

  async function start() {
    if (!window.isSecureContext) {
      setWarn("Open the exact link the PC printed (https:// over Wi-Fi, http://localhost over USB), otherwise the phone won't share tilt data.");
      return;
    }
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      try { await DeviceMotionEvent.requestPermission(); } catch (_) {}
    }
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await screen.orientation.lock("landscape");
    } catch (_) { /* not fatal */ }
    keepAwake();
    engine.start();
    setWarn("");
    setStarted(true);
    setTimeout(() => {
      if (!engine.state.gotMotion) {
        setStarted(false);
        setWarn("No tilt data from the phone's sensors. Check that motion sensors are allowed for Chrome (Settings → Site settings → Motion sensors).");
      }
    }, 1500);
  }

  return html`
    <${Drive} cfg=${cfg} set=${set} openSettings=${() => setSettingsOpen(true)} />
    ${!started && html`<${StartScreen} onStart=${start} warn=${warn} openSettings=${() => setSettingsOpen(true)} />`}
    ${settingsOpen && html`<${Settings} store=${store} setStore=${setStore} cfg=${cfg} set=${set} close=${() => setSettingsOpen(false)} />`}
  `;
}

let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wakeLock) keepAwake(); });

function StartScreen({ onStart, warn, openSettings }) {
  return html`
    <div class="overlay">
      <h1>Phone Wheel</h1>
      <p>Hold your phone sideways like a steering wheel and tilt to steer. Hold the pedals with your thumbs.
         Pedals, buttons, curves and layout can all be changed in Settings.</p>
      <p class="rotate">Turn your phone sideways first.</p>
      ${!engine.hasToken() && html`<p class="warn">Not paired yet: scan the QR code shown on the PC to connect this phone.</p>`}
      <div class="row">
        <button class="primary big" onClick=${onStart}>START DRIVING</button>
        <button class="big" onClick=${openSettings}>Settings</button>
      </div>
      ${warn && html`<div class="warn">${warn}</div>`}
    </div>`;
}

// ---------------------------------------------------------------- driving screen
function Drive({ cfg, set, openSettings }) {
  const L = cfg.layout;
  const [left, right] = L.swapPedals ? ["gas", "brake"] : ["brake", "gas"];
  return html`
    <div class="drive" style=${{ gridTemplateColumns: `${L.pedalSize}fr 1.1fr ${L.pedalSize}fr` }}>
      <${Pedal} key=${left} kind=${left} cfg=${cfg[left]} flick=${cfg.flick} toCenter=${1} />
      <${Center} cfg=${cfg} set=${set} openSettings=${openSettings} />
      <${Pedal} key=${right} kind=${right} cfg=${cfg[right]} flick=${cfg.flick} toCenter=${-1} />
    </div>`;
}

const PEDAL_HINT = { ramp: "hold longer = harder", slide: "slide up = harder", instant: "full on touch" };

// toCenter: +1 for the left pedal, -1 for the right (the direction of a flick toward the screen centre).
function Pedal({ kind, cfg, flick, toCenter }) {
  const el = useRef(), fill = useRef(), mark = useRef();
  const st = useRef({ pid: null, t0: 0, y: 0 });
  const cfgRef = useRef(cfg), flickRef = useRef(flick), flicker = useRef(createFlick());
  cfgRef.current = cfg; flickRef.current = flick;
  // flick to shift: brake = down, gas = up; the pedal stays pressed (a flick is sideways, pressure is up/down or time)
  const shift = kind === "brake" ? "down" : "up";
  const flicked = () => {
    engine.tap(flickRef.current[shift]);
    buzz(35);
    const m = mark.current;
    if (m) { m.classList.remove("show"); void m.offsetWidth; m.classList.add("show"); }
  };
  const track = (e) => { if (flickRef.current.on && flicker.current.add(e.clientX, e.clientY, performance.now(), toCenter, flickRef.current)) flicked(); };

  const put = (v) => {
    engine.state[kind] = v;
    if (fill.current) fill.current.style.height = v * 100 + "%";
  };
  const progress = () => {
    const c = cfgRef.current, s = st.current;
    if (c.mode === "slide") {
      const r = el.current.getBoundingClientRect();
      return (r.bottom - s.y) / (r.height * 0.85); // top 15% counts as fully pressed
    }
    if (c.mode === "instant") return 1;
    return (performance.now() - s.t0) / 1000 / c.rampTime;
  };
  const tick = () => {
    if (st.current.pid === null) return;
    put(pedalValue(progress(), cfgRef.current));
    requestAnimationFrame(tick);
  };
  const release = () => {
    st.current.pid = null;
    put(0);
    el.current && el.current.classList.remove("active");
  };
  useEffect(() => release, []); // let go if the pedal is removed or swapped

  const down = (e) => {
    const s = st.current;
    if (s.pid !== null) return;
    s.pid = e.pointerId; s.t0 = performance.now(); s.y = e.clientY;
    flicker.current.reset(); track(e);
    el.current.setPointerCapture(s.pid);
    el.current.classList.add("active");
    buzz(12);
    tick();
  };
  const move = (e) => { if (e.pointerId === st.current.pid) { st.current.y = e.clientY; track(e); } };
  const up = (e) => { if (e.pointerId === st.current.pid) release(); };

  return html`
    <div class="pedal ${kind}" ref=${el} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <div class="fill" ref=${fill}></div>
      <div class="label">${kind === "gas" ? "GAS" : "BRAKE"}</div>
      <div class="hint">${PEDAL_HINT[cfg.mode]}${flick.on ? html`<br/>flick ${toCenter > 0 ? "→" : "←"} = shift ${shift}` : ""}</div>
      <div class="shiftmark" ref=${mark}>${shift === "up" ? "▲" : "▼"}</div>
    </div>`;
}

// "good · 9 ms · 60 Hz": round trip to the PC, messages per second it receives, and the worst stall if any.
function linkText(l) {
  if (!l.quality) return "";
  if (l.quality === "stalled") return "stalled · no reply";
  const stall = Math.max(l.gap, l.sendGap);
  return `${l.quality} · ${l.rtt ?? "–"} ms · ${l.hz} Hz${stall > 100 ? ` · stall ${stall} ms` : ""}`;
}

function Center({ cfg, set, openSettings }) {
  const wheel = useRef(), readout = useRef(), linkEl = useRef();
  const { connected, paired } = useLink();
  let shown = "";
  useFrame(() => {
    const s = engine.state.steer;
    if (wheel.current) wheel.current.style.transform = `rotate(${s * 90}deg)`;
    if (readout.current) readout.current.textContent = `steer ${s >= 0 ? "+" : ""}${s.toFixed(2)}`;
    const t = connected ? linkText(engine.link) : "";
    if (linkEl.current && t !== shown) {
      shown = t; linkEl.current.textContent = t; linkEl.current.className = `linkq ${engine.link.quality}`;
      linkEl.current.title = `round trip ${engine.link.rtt ?? "–"} ms (worst of last 10: ${engine.link.rttMax ?? "–"} ms), PC receives ${engine.link.hz}/s, longest pause ${engine.link.gap} ms (PC) / ${engine.link.sendGap} ms (phone)`;
    }
  });
  const L = cfg.layout;
  return html`
    <div class="center">
      <div class="topbar">
        <div class="status ${connected ? "ok" : ""}"><i></i>${connected ? "connected to PC" : paired === false ? "not paired: scan the PC's QR code" : "connecting…"}</div>
        <div class="linkq" ref=${linkEl}></div>
        <button class="small" onClick=${openSettings}>⚙ Settings</button>
      </div>
      ${L.showWheel && html`<${Wheel} wheelRef=${wheel} />`}
      <div class="readout" ref=${readout}>steer +0.00</div>
      ${cfg.buttons.length > 0 && html`
        <div class="aux size-${L.buttonSize}">
          ${cfg.buttons.map((b, i) => html`<${AuxButton} key=${`${i}-${b.bind}-${b.toggle}`} index=${i} btn=${b} />`)}
        </div>`}
      <div class="row">
        <button onClick=${() => { engine.center(); buzz(30); }}>Center</button>
      </div>
      ${L.quickSliders && html`
        <label class="quick">Sensitivity
          <input type="range" min="-35" max="70" value=${cfg.steer.sensitivity} onInput=${(e) => set("steer.sensitivity", +e.target.value)} /></label>
        <label class="quick">Smoothing
          <input type="range" min="0" max="90" value=${cfg.steer.smoothing} onInput=${(e) => set("steer.smoothing", +e.target.value)} /></label>`}
    </div>`;
}

function Wheel({ wheelRef }) {
  return html`
    <svg class="wheel" ref=${wheelRef} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="7"/>
      <circle cx="50" cy="50" r="9" fill="currentColor"/>
      <path d="M8 52 L41 52 M59 52 L92 52 M50 59 L50 93" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
      <rect x="47" y="3" width="6" height="10" rx="2" fill="var(--accent)"/>
    </svg>`;
}

function AuxButton({ index, btn }) {
  const [down, setDown] = useState(false);
  const pid = useRef(null), on = useRef(false);
  useEffect(() => () => engine.setButton(index, false), []);

  const press = (e) => {
    buzz(15);
    if (btn.toggle) {
      on.current = !on.current;
      engine.setButton(index, on.current);
      setDown(on.current);
      return;
    }
    pid.current = e.pointerId;
    e.currentTarget.setPointerCapture(pid.current);
    engine.setButton(index, true);
    setDown(true);
  };
  const lift = (e) => {
    if (btn.toggle || e.pointerId !== pid.current) return;
    pid.current = null;
    engine.setButton(index, false);
    setDown(false);
  };
  return html`
    <button class="auxbtn ${down ? "down" : ""}" onPointerDown=${press} onPointerUp=${lift} onPointerCancel=${lift}>
      ${btn.label || btn.bind}
    </button>`;
}

// ---------------------------------------------------------------- settings
const TABS = ["Steering", "Pedals", "Buttons", "Layout", "Profiles"];

function Settings({ store, setStore, cfg, set, close }) {
  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem("pw-tab") || TABS[0]; } catch (_) { return TABS[0]; }
  });
  const pickTab = (t) => { setTab(t); try { sessionStorage.setItem("pw-tab", t); } catch (_) {} };
  return html`
    <div class="settings">
      <nav>
        ${TABS.map((t) => html`<button class=${t === tab ? "on" : ""} onClick=${() => pickTab(t)}>${t}</button>`)}
        <div class="grow"></div>
        <div class="profile-name">${store.active}</div>
        <button class="primary" onClick=${close}>Done</button>
      </nav>
      <section>
        ${tab === "Steering" && html`<${SteeringTab} cfg=${cfg} set=${set} />`}
        ${tab === "Pedals" && html`<${PedalsTab} cfg=${cfg} set=${set} />`}
        ${tab === "Buttons" && html`<${ButtonsTab} cfg=${cfg} set=${set} />`}
        ${tab === "Layout" && html`<${LayoutTab} cfg=${cfg} set=${set} />`}
        ${tab === "Profiles" && html`<${ProfilesTab} store=${store} setStore=${setStore} />`}
      </section>
    </div>`;
}

function Slider({ label, hint, value, min, max, step = 1, onInput, fmt = (v) => v }) {
  return html`
    <label class="field">
      <span class="name">${label}${hint && html`<small>${hint}</small>`}</span>
      <input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onInput(+e.target.value)} />
      <output>${fmt(value)}</output>
    </label>`;
}

function Toggle({ label, hint, value, onChange }) {
  return html`
    <div class="field">
      <span class="name">${label}${hint && html`<small>${hint}</small>`}</span>
      <button class="switch ${value ? "on" : ""}" onClick=${() => onChange(!value)}>${value ? "On" : "Off"}</button>
    </div>`;
}

function Choice({ label, hint, value, options, onChange }) {
  return html`
    <div class="field">
      <span class="name">${label}${hint && html`<small>${hint}</small>`}</span>
      <div class="seg">
        ${options.map(([v, text]) => html`<button class=${v === value ? "on" : ""} onClick=${() => onChange(v)}>${text}</button>`)}
      </div>
    </div>`;
}

// Small graph of a 0..1 -> 0..1 response curve.
function CurvePreview({ fn, caption }) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    pts.push(`${(x * 100).toFixed(1)},${(100 - fn(x) * 100).toFixed(1)}`);
  }
  return html`
    <figure class="curve">
      <svg viewBox="-3 -3 106 106">
        <rect class="frame" x="0" y="0" width="100" height="100" />
        <line class="diag" x1="0" y1="100" x2="100" y2="0" />
        <polyline class="line" points=${pts.join(" ")} />
      </svg>
      <figcaption>${caption}</figcaption>
    </figure>`;
}

function LiveSteer() {
  const bar = useRef(), num = useRef();
  useFrame(() => {
    const s = engine.state.steer;
    if (bar.current) {
      bar.current.style.left = (s < 0 ? 50 + s * 50 : 50) + "%";
      bar.current.style.width = Math.abs(s) * 50 + "%";
    }
    if (num.current) num.current.textContent = (s >= 0 ? "+" : "") + s.toFixed(2);
  });
  return html`
    <div class="field">
      <span class="name">Live steering<small>tilt the phone to try your settings</small></span>
      <div class="meter"><div class="mid"></div><div class="bar" ref=${bar}></div></div>
      <output ref=${num}>+0.00</output>
    </div>`;
}

function SteeringTab({ cfg, set }) {
  const s = cfg.steer;
  return html`
    <h2>Steering</h2>
    <${LiveSteer} />
    <${Slider} label="Sensitivity" hint=${`full lock at ${85 - s.sensitivity}° of tilt`} min="-35" max="70" value=${s.sensitivity}
      onInput=${(v) => set("steer.sensitivity", v)} />
    <${Slider} label="Smoothing" hint="0 = raw and twitchy, higher = calmer but laggier" min="0" max="90" value=${s.smoothing}
      onInput=${(v) => set("steer.smoothing", v)} />
    <${Slider} label="Dead zone" hint="ignore small tilts around center" min="0" max="20" value=${s.deadzone}
      onInput=${(v) => set("steer.deadzone", v)} fmt=${(v) => v + "%"} />
    <div class="with-preview">
      <${Slider} label="Response curve" hint="above 1 = finer control near center" min="0.3" max="3" step="0.1" value=${s.curve}
        onInput=${(v) => set("steer.curve", v)} fmt=${(v) => v.toFixed(1)} />
      <${CurvePreview} fn=${(x) => steerCurve(x, s)} caption="tilt → steering" />
    </div>
    <${Toggle} label="Invert" hint="flip if steering goes the wrong way" value=${s.invert} onChange=${(v) => set("steer.invert", v)} />
    <div class="field"><span class="name">Center<small>make the current tilt straight ahead</small></span>
      <button onClick=${() => { engine.center(); buzz(30); }}>Center now</button></div>`;
}

function PedalsTab({ cfg, set }) {
  const [which, setWhich] = useState("gas");
  const p = cfg[which], k = which + ".";
  return html`
    <h2>Pedals</h2>
    <${Choice} label="Edit" value=${which} options=${[["gas", "Gas"], ["brake", "Brake"]]} onChange=${setWhich} />
    <${Choice} label="Mode" value=${p.mode} onChange=${(v) => set(k + "mode", v)}
      hint=${{ ramp: "pressure builds the longer you hold", slide: "slide your thumb up to press harder", instant: "full pressure as soon as you touch" }[p.mode]}
      options=${[["ramp", "Hold to build"], ["slide", "Slide"], ["instant", "On / off"]]} />
    ${p.mode === "ramp" && html`
      <${Slider} label="Ramp time" hint="seconds from touch to full" min="0.1" max="5" step="0.1" value=${p.rampTime}
        onInput=${(v) => set(k + "rampTime", v)} fmt=${(v) => v.toFixed(1) + " s"} />`}
    ${p.mode !== "instant" && html`
      <${Slider} label="Start value" hint="pressure the moment you touch" min="0" max="1" step="0.05" value=${p.min}
        onInput=${(v) => set(k + "min", v)} fmt=${(v) => Math.round(v * 100) + "%"} />
      <div class="with-preview">
        <${Slider} label="Curve" hint="above 1 = gentle start, below 1 = quick start" min="0.3" max="3" step="0.1" value=${p.curve}
          onInput=${(v) => set(k + "curve", v)} fmt=${(v) => v.toFixed(1)} />
        <${CurvePreview} fn=${(x) => pedalValue(x, p)} caption=${p.mode === "ramp" ? "hold time → pressure" : "thumb height → pressure"} />
      </div>`}
    <${Slider} label="Maximum" hint="cap the pedal below full" min="0.1" max="1" step="0.05" value=${p.max}
      onInput=${(v) => set(k + "max", v)} fmt=${(v) => Math.round(v * 100) + "%"} />
    <h2>Flick to shift</h2>
    <${Toggle} label="Flick to shift" hint="while on a pedal, flick your thumb toward the middle: brake = shift down, gas = shift up"
      value=${cfg.flick.on} onChange=${(v) => set("flick.on", v)} />
    ${cfg.flick.on && html`
      <${Slider} label="Flick distance" hint="how far the thumb must move; more = fewer accidental shifts" min="15" max="120" value=${cfg.flick.distance}
        onInput=${(v) => set("flick.distance", v)} fmt=${(v) => v + " px"} />
      <${Slider} label="Flick speed" hint="the distance has to happen within this time" min="80" max="400" step="10" value=${cfg.flick.time}
        onInput=${(v) => set("flick.time", v)} fmt=${(v) => v + " ms"} />
      <${FlickBind} label="Shift down sends" value=${cfg.flick.down} onChange=${(v) => set("flick.down", v)} />
      <${FlickBind} label="Shift up sends" value=${cfg.flick.up} onChange=${(v) => set("flick.up", v)} />`}`;
}

function FlickBind({ label, value, onChange }) {
  return html`
    <label class="field">
      <span class="name">${label}<small>Gridline GP shifts on LB / RB (or A / B)</small></span>
      <select value=${value} onChange=${(e) => onChange(e.target.value)}>
        ${BUTTONS.map(([id, name]) => html`<option value=${id}>${name}</option>`)}
      </select>
    </label>`;
}

function ButtonsTab({ cfg, set }) {
  const list = cfg.buttons;
  const update = (i, field, value) => set("buttons", list.map((b, j) => (j === i ? { ...b, [field]: value } : b)));
  const remove = (i) => set("buttons", list.filter((_, j) => j !== i));
  const add = () => {
    const used = new Set(list.map((b) => b.bind));
    const free = BUTTONS.find(([id]) => !used.has(id)) || BUTTONS[0];
    set("buttons", [...list, { label: String(list.length + 1), bind: free[0], toggle: false }]);
  };
  return html`
    <h2>Buttons</h2>
    <p class="note">Each on-screen button presses a controller button. Assign what it does in the game's control settings.
      In keyboard mode, A…RS press the keys ${KEYBOARD_KEYS.split("").join(" ")} and the D-pad isn't sent.</p>
    ${list.map((b, i) => html`
      <div class="btnrow">
        <input class="text" maxlength="4" value=${b.label} onInput=${(e) => update(i, "label", e.target.value)} aria-label="Label" />
        <select value=${b.bind} onChange=${(e) => update(i, "bind", e.target.value)}>
          ${BUTTONS.map(([id, name]) => html`<option value=${id}>${name}</option>`)}
        </select>
        <button class="switch ${b.toggle ? "on" : ""}" onClick=${() => update(i, "toggle", !b.toggle)}>${b.toggle ? "Toggle" : "Hold"}</button>
        <button class="danger" onClick=${() => remove(i)} aria-label="Remove">✕</button>
      </div>`)}
    ${list.length < MAX_BUTTONS && html`<button onClick=${add}>+ Add button</button>`}`;
}

function LayoutTab({ cfg, set }) {
  const L = cfg.layout;
  return html`
    <h2>Layout</h2>
    <${Toggle} label="Swap pedals" hint="gas on the left, brake on the right" value=${L.swapPedals} onChange=${(v) => set("layout.swapPedals", v)} />
    <${Slider} label="Pedal width" min="0.6" max="1.6" step="0.1" value=${L.pedalSize}
      onInput=${(v) => set("layout.pedalSize", v)} fmt=${(v) => v.toFixed(1) + "×"} />
    <${Choice} label="Button size" value=${L.buttonSize} onChange=${(v) => set("layout.buttonSize", v)}
      options=${[["s", "Small"], ["m", "Medium"], ["l", "Large"]]} />
    <${Toggle} label="Show wheel" value=${L.showWheel} onChange=${(v) => set("layout.showWheel", v)} />
    <${Toggle} label="Quick sliders" hint="sensitivity and smoothing on the driving screen" value=${L.quickSliders}
      onChange=${(v) => set("layout.quickSliders", v)} />
    <${Toggle} label="Vibration" hint="buzz when you press a pedal or button" value=${L.haptics} onChange=${(v) => set("layout.haptics", v)} />`;
}

function ProfilesTab({ store, setStore }) {
  const [name, setName] = useState("");
  const [io, setIo] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const names = Object.keys(store.profiles);

  const change = (fn) => setStore((s) => { const next = clone(s); fn(next); return next; });
  const unique = (base) => { let n = base, i = 2; while (store.profiles[n]) n = `${base} ${i++}`; return n; };

  const saveAs = () => {
    const n = unique(name.trim() || "Profile");
    change((s) => { s.profiles[n] = clone(s.profiles[s.active]); s.active = n; });
    setName(""); setMsg(`Saved as "${n}".`);
  };
  const remove = (n) => change((s) => {
    delete s.profiles[n];
    if (s.active === n) s.active = Object.keys(s.profiles)[0];
  });
  const reset = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    change((s) => { s.profiles[s.active] = sanitize(clone(DEFAULTS)); });
    setConfirmReset(false); setMsg("Profile reset to defaults.");
  };
  const exportJson = async () => {
    const text = JSON.stringify({ name: store.active, settings: store.profiles[store.active] });
    setIo(text);
    try { await navigator.clipboard.writeText(text); setMsg("Copied to clipboard."); } catch (_) { setMsg("Copy the text below."); }
  };
  const importJson = () => {
    try {
      const data = JSON.parse(io);
      const n = unique(typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Imported");
      change((s) => { s.profiles[n] = sanitize(data.settings || data); s.active = n; });
      setMsg(`Imported as "${n}".`);
    } catch (_) {
      setMsg("That text isn't a valid profile.");
    }
  };

  return html`
    <h2>Profiles</h2>
    <div class="profiles">
      ${names.map((n) => html`
        <div class="profile ${n === store.active ? "on" : ""}">
          <button class="pick" onClick=${() => change((s) => { s.active = n; })}>${n === store.active ? "● " : ""}${n}</button>
          ${names.length > 1 && html`<button class="danger" onClick=${() => remove(n)} aria-label=${`Delete ${n}`}>✕</button>`}
        </div>`)}
    </div>
    <div class="field">
      <span class="name">Save as new<small>copy the current settings into a new profile</small></span>
      <input class="text" placeholder="Name" maxlength="24" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button onClick=${saveAs}>Save</button>
    </div>
    <div class="field">
      <span class="name">Reset<small>put "${store.active}" back to defaults</small></span>
      <button class=${confirmReset ? "danger" : ""} onClick=${reset}>${confirmReset ? "Tap again to reset" : "Reset"}</button>
    </div>
    <div class="field">
      <span class="name">Share<small>export to text, or paste text and import</small></span>
      <div class="seg">
        <button onClick=${exportJson}>Export</button>
        <button onClick=${importJson}>Import</button>
      </div>
    </div>
    <textarea class="text io" placeholder="Profile text appears here, or paste one to import" value=${io} onInput=${(e) => setIo(e.target.value)}></textarea>
    ${msg && html`<p class="note">${msg}</p>`}`;
}

render(html`<${App} />`, document.getElementById("root"));
