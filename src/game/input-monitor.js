// Input monitor (I, or the TEST CONTROLS / INPUT MONITOR buttons): what the game receives from the controller.
// Live steer/gas/brake, a 6-second graph, how often the controller sends new data, the longest stall, how long the
// pedals take to reach full, frame rate, and advice. Works in the menu too, so the wheel can be tested before a race.
//
// Update rate comes from Gamepad.timestamp, which the browser bumps whenever the device reports new data. Linux drops
// events whose value did not change, so a phone held perfectly still looks silent; a pause only counts as a stall when
// the steering moved across it (the phone was being turned, yet nothing arrived).
import { $ } from './util.js';

const CFG = Object.freeze({
  history: 6,            // seconds shown in the graph
  statsWindow: 5,        // seconds the longest stall is taken over
  stallMinMove: 0.01,    // steering change across a pause that makes it a stall
  full: 0.98,            // pedal value that counts as fully pressed
  textInterval: 0.2,     // seconds between text refreshes
  // verdict thresholds
  rateGood: 50, rateOk: 30,          // updates per second while steering
  stallGood: 60, stallOk: 150,       // ms
  rampSlow: 0.15,                    // s from press to full that counts as a ramping pedal
});

export const InputMonitor = (() => {
  const root = $('inputMon'), graph = $('imGraph'), ctx = graph.getContext('2d');
  let open = false, textT = 0, now = 0;
  const samples = [];          // { t, steer, thr, brk, upd }
  const updates = [];          // times the controller sent new data
  const stalls = [];           // { t, ms }
  let lastStamp = -1, lastUpdT = 0, lastUpdSteer = 0;
  const ramp = { thr: { t0: -1, first: 0, last: null }, brk: { t0: -1, first: 0, last: null } };
  let fpsN = 0, fpsSum = 0, fps = 0;

  function trackRamp(r, v) {
    if (v <= 0.001) { r.t0 = -1; return; }
    if (r.t0 < 0) { r.t0 = now; r.first = v; r.done = false; }
    else if (!r.done && v >= CFG.full) { r.done = true; r.last = { time: now - r.t0, first: r.first }; }
  }

  // Called every frame with the frame time and the Input module's state.
  function sample(dt, drive, pad) {
    now += dt;
    fpsN++; fpsSum += dt; if (fpsSum >= 0.5) { fps = fpsN / fpsSum; fpsN = 0; fpsSum = 0; }
    let upd = false;
    if (pad.connected && pad.timestamp !== lastStamp) {
      if (lastStamp >= 0) {
        upd = true;
        const gap = (now - lastUpdT) * 1000;
        if (Math.abs(pad.steerRaw - lastUpdSteer) > CFG.stallMinMove && gap > CFG.stallGood) stalls.push({ t: now, ms: gap });
        updates.push(now);
      }
      lastStamp = pad.timestamp; lastUpdT = now; lastUpdSteer = pad.steerRaw;
    }
    if (!pad.connected) lastStamp = -1;
    trackRamp(ramp.thr, drive.thr); trackRamp(ramp.brk, drive.brk);
    samples.push({ t: now, steer: drive.steer, thr: drive.thr, brk: drive.brk, upd });
    while (samples.length && now - samples[0].t > CFG.history) samples.shift();
    while (updates.length && now - updates[0] > CFG.statsWindow) updates.shift();
    while (stalls.length && now - stalls[0].t > CFG.statsWindow) stalls.shift();
    if (!open) return;
    draw();
    if ((textT -= dt) <= 0) { textT = CFG.textInterval; text(pad); }
  }

  // controller reports received in the last second
  const rate = () => updates.filter(t => now - t <= 1).length;
  const worstStall = () => stalls.reduce((m, s) => Math.max(m, s.ms), 0);
  const moving = () => { const r = samples.filter(s => now - s.t <= 1); if (r.length < 2) return false;
    let lo = Infinity, hi = -Infinity; for (const s of r) { lo = Math.min(lo, s.steer); hi = Math.max(hi, s.steer); } return hi - lo > 0.05; };

  function verdict(pad) {
    if (!pad.connected) return { cls: 'none', word: 'NO CONTROLLER', note: 'Keyboard and touch only. Press gas on the phone once so the game sees the wheel.' };
    const hz = rate(), stall = worstStall();
    if (!moving()) return { cls: 'idle', word: 'TURN THE WHEEL', note: 'Steer left and right for a few seconds to measure the connection.' };
    if (hz >= CFG.rateGood && stall <= CFG.stallGood) return { cls: 'good', word: 'GOOD', note: 'Steady updates, no stalls.' };
    if (hz >= CFG.rateOk && stall <= CFG.stallOk) return { cls: 'fair', word: 'CHOPPY', note: 'Some delay or uneven updates.' };
    return { cls: 'poor', word: 'LAGGY', note: 'Updates are slow or stalling.' };
  }

  const fmtRamp = r => r.last ? `starts at ${Math.round(r.last.first * 100)}%, full after ${r.last.time.toFixed(2)} s` : 'press it fully once to measure';
  function advice(pad) {
    const tips = [];
    const slow = ['thr', 'brk'].filter(k => ramp[k].last && (ramp[k].last.time > CFG.rampSlow || ramp[k].last.first < 0.9));
    if (slow.length) tips.push(`Your phone's ${slow.map(k => k === 'thr' ? 'gas' : 'brake').join(' and ')} ${slow.length > 1 ? 'ramp' : 'ramps'} up instead of going straight to full. On the phone: <b>Settings → Pedals</b>, pick Gas, set <b>Mode: Instant</b>, then the same for Brake (or <b>Slide</b> for a brake you can press partly). Ramp mode is the main cause of a slow-feeling wheel and slow corner exits.`);
    if (pad.connected && moving() && (rate() < CFG.rateGood || worstStall() > CFG.stallGood))
      tips.push('Wi-Fi delay: keep the phone near the router, turn off battery saver on the phone, or connect with a USB cable: <code>python server.py --usb</code>. The badge at the top of the phone screen shows the round trip.');
    if (fps && fps < 55) tips.push(`The game runs at ${Math.round(fps)} fps, which adds delay. Try Performance graphics (G).`);
    if (!tips.length && pad.connected) tips.push('Nothing to fix. The phone screen badge shows the Wi-Fi round trip if it still feels slow.');
    return tips;
  }

  let lastHtml = '';
  function text(pad) {
    const v = verdict(pad), stall = worstStall();
    const html = `
      <div class="im-verdict ${v.cls}"><b>${v.word}</b><span>${v.note}</span></div>
      <div class="im-grid">
        <span class="lbl">Controller</span><span>${pad.connected ? pad.id.replace(/\s*\(.*$/, '') + (pad.mapping ? ' · ' + pad.mapping : '') : 'none'}</span>
        <span class="lbl">Updates</span><span class="num">${pad.connected ? rate() + ' per second' : '–'}</span>
        <span class="lbl">Longest stall</span><span class="num">${pad.connected ? (stall ? Math.round(stall) + ' ms' : 'none') + ' (last 5 s)' : '–'}</span>
        <span class="lbl">Gas pedal</span><span>${fmtRamp(ramp.thr)}</span>
        <span class="lbl">Brake pedal</span><span>${fmtRamp(ramp.brk)}</span>
        <span class="lbl">Frame rate</span><span class="num">${Math.round(fps)} fps</span>
      </div>
      <ul class="im-tips">${advice(pad).map(t => `<li>${t}</li>`).join('')}</ul>`;
    if (html !== lastHtml) { lastHtml = html; $('imBody').innerHTML = html; }
  }

  function draw() {
    const W = graph.width, H = graph.height, mid = H * 0.32, amp = H * 0.28, pedTop = H * 0.66, pedH = H * 0.3;
    const x = t => W - (now - t) / CFG.history * W;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.moveTo(0, pedTop + pedH); ctx.lineTo(W, pedTop + pedH); ctx.stroke();
    for (let s = 1; s < CFG.history; s++) { const gx = W - s / CFG.history * W; ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    // controller updates: one tick per new report along the bottom; gaps in the ticks are stalls
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    for (const s of samples) if (s.upd) ctx.fillRect(x(s.t), H - 3, 1.5, 3);
    const line = (key, color, y0, k) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      samples.forEach((s, i) => { const px = x(s.t), py = y0 - s[key] * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    };
    line('steer', '#ffc21a', mid, amp);               // right = up
    line('thr', '#36d27f', pedTop + pedH, pedH);
    line('brk', '#ff2b2b', pedTop + pedH, pedH);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('steer', 6, 14); ctx.fillText('gas / brake', 6, pedTop + 2); ctx.fillText('updates', 6, H - 8);
  }

  function toggle(force) {
    open = force ?? !open;
    root.hidden = !open;
    if (open) { lastHtml = ''; textT = 0; }
  }
  $('imClose').onclick = () => toggle(false);
  return { sample, toggle, get open() { return open; } };
})();
