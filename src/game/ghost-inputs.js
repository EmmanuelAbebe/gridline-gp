// The AI ghost's controls, live (2026-10-20, user: "observe the controls of the best car: input charts of steering,
// braking, gas"). A HUD panel (#teleBox) with three rolling charts over the last `secs` seconds, the ghost's trace
// bright and yours in amber on top, and the current values at the right; under them its speed and gear against yours.
// Shown in a time trial against an AI ghost (pref ghostInputs).
import { $ } from './util.js';

export const TELE = Object.freeze({
  secs: 6,              // s of history
  hz: 30,               // samples / redraws per second
  rows: [               // [key, label, ghost colour, centred (−1..1)?]
    ['steer', 'STEER', '#e8edf2', true],
    ['thr', 'GAS', '#36d27f', false],
    ['brk', 'BRAKE', '#ff3b30', false],
  ],
  you: '#ffc21a',
});

export function createGhostInputs() {
  const box = $('teleBox'), cv = $('teleChart'), ctx = cv.getContext('2d'), n = TELE.secs * TELE.hz;
  const hist = { ghost: TELE.rows.map(() => new Float32Array(n)), you: TELE.rows.map(() => new Float32Array(n)) };
  let head = 0, acc = 0, shown = false;

  function draw() {
    const W = cv.width, H = cv.height, rh = H / TELE.rows.length, lw = 46, gw = W - lw - 8;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '600 15px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    TELE.rows.forEach(([, label, colour, centred], r) => {
      const y0 = r * rh + 4, h = rh - 8;
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(lw, y0, gw, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(label, 0, y0 + h / 2);
      if (centred) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(lw, y0 + h / 2, gw, 1); }
      const yOf = v => centred ? y0 + h / 2 - v * h / 2 : y0 + h - v * h;
      for (const [who, col, width] of [['ghost', colour, 2.5], ['you', TELE.you, 1.6]]) {
        const a = hist[who][r];
        ctx.strokeStyle = col; ctx.lineWidth = width; ctx.globalAlpha = who === 'you' ? 0.9 : 1;
        ctx.beginPath();
        for (let k = 0; k < n; k++) { const v = a[(head + k) % n], x = lw + k / (n - 1) * gw; k ? ctx.lineTo(x, yOf(v)) : ctx.moveTo(x, yOf(v)); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    });
  }

  return {
    show(on, name = '') {
      shown = on; box.hidden = !on;
      if (on) { $('teleName').textContent = name; for (const w of ['ghost', 'you']) for (const a of hist[w]) a.fill(0); head = 0; }
    },
    // per frame while racing: the ghost's car and yours (steer −1..1, thr, brake 0..1, v, gear)
    update(g, you, dt) {
      if (!shown) return;
      acc += dt; if (acc < 1 / TELE.hz) return;
      acc %= 1 / TELE.hz;
      TELE.rows.forEach(([key], r) => {
        const val = c => key === 'brk' ? c.brake : key === 'steer' ? Math.max(-1, Math.min(1, c.steer)) : c.thr;
        hist.ghost[r][head] = val(g); hist.you[r][head] = val(you);
      });
      head = (head + 1) % n;
      draw();
      $('teleSpd').textContent = `${Math.round(g.v * 3.6)} km/h · ${g.gear}`;
      $('teleYou').textContent = `${Math.round(you.v * 3.6)} km/h · ${you.gear}`;
    },
  };
}
