import { Design } from './design.js';
import { $ } from './util.js';

// Applies Design.data.hud: theme → CSS variables, layout → inline position/scale per panel (untouched panels keep
// their stylesheet position, including the phone layout).
export const HudStyle = (() => {
  const PANELS = { posPanel: 'Position & times', tower: 'Timing tower', map: 'Minimap', speedo: 'Speed & gear',
    hudBtns: 'Top buttons', teleBox: 'Ghost inputs', rearMirror: 'Rear-view mirror', lights: 'Start lights', msg: 'Big messages', toast: 'Lap toasts' };
  const GENERIC_FONTS = ['system-ui', 'monospace', 'serif', 'sans-serif'];
  const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  function applyTheme(t) {
    const s = document.documentElement.style, font = GENERIC_FONTS.includes(t.font) ? t.font : `"${t.font}"`;
    s.setProperty('--amber', t.accent); s.setProperty('--text', t.text); s.setProperty('--muted', t.muted);
    s.setProperty('--panel', rgba(t.panel, t.panelOpacity)); s.setProperty('--radius', t.radius + 'px');
    s.setProperty('--display', `${font},"Arial Narrow",Arial,sans-serif`);
  }
  const layoutFor = camId => { const L = Design.data.hud.layouts; return { ...L.all, ...(L[camId] || {}) }; };
  // anchor = vertical (t/c/b) + horizontal (l/c/r); x/y = px from that edge, or from the centre for 'c'
  function place(el, p) {
    const s = el.style;
    el.classList.toggle('lay-off', !!(p && p.hidden));
    if (!p) { s.left = s.right = s.top = s.bottom = s.transform = s.transformOrigin = ''; return; }
    const v = p.anchor[0], h = p.anchor[1];
    s.left = h === 'l' ? p.x + 'px' : h === 'c' ? `calc(50% + ${p.x}px)` : 'auto';
    s.right = h === 'r' ? p.x + 'px' : 'auto';
    s.top = v === 't' ? p.y + 'px' : v === 'c' ? `calc(50% + ${p.y}px)` : 'auto';
    s.bottom = v === 'b' ? p.y + 'px' : 'auto';
    s.transform = `translate(${h === 'c' ? '-50%' : '0'}, ${v === 'c' ? '-50%' : '0'}) scale(${p.scale})`;
    s.transformOrigin = `${h === 'l' ? 'left' : h === 'r' ? 'right' : 'center'} ${v === 't' ? 'top' : v === 'b' ? 'bottom' : 'center'}`;
  }
  return {
    PANELS, layoutFor,
    apply(camId) { applyTheme(Design.data.hud.theme); const lay = layoutFor(camId); for (const id in PANELS) place($(id), lay[id]); },
  };
})();
