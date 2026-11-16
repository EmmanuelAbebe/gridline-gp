// Painting the free livery (livery.js) on a Blender car: the paint texture (five panels: layers, the race number, the
// name, spray) and the shader that puts zones, the texture, the exhaust and the heat foil on the car's paint and carbon.
// The car has no UV map: every pixel works out where it is in the car's frame (uCarInv × the mesh's world matrix) and
// takes its zone from the model's boxes and its paint from the panel it faces (blended by the surface's facing).
import * as THREE from 'three';
import { BRANDS } from './config.js';
import { ATLAS, PANELS, ZONE_IDS, MAT, EXHAUSTS, CARBON, modelOf, panelRect, toPixel, planeOf, pixelsPerMetre, twinOf, zoneIndex, PARTS_DEFAULTS } from './livery.js';

const MAXBOX = 16, MASK = ATLAS / 2;
const FONT = '"Saira Condensed", "Arial Narrow", Arial, sans-serif';
// a zone finish → roughness, metalness, clearcoat (the paint's own looks: car-models.js FINISH_LOOKS; gloss = its default)
const FIN = { gloss: [0.32, 0.1, 1], metallic: [0.22, 0.65, 1], satin: [0.5, 0.15, 0.35], matte: [0.85, 0, 0], carbon: [0.4, 0.2, 0.8] };
const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
// white or near-black, whichever reads on a colour (the race number on the body)
export const contrastOf = c => ((c >> 16 & 255) * 0.299 + (c >> 8 & 255) * 0.587 + (c & 255) * 0.114) > 150 ? 0x111111 : 0xf2f3f0;

// ---- the paint texture
// a panel's frame for a point: the pixel there and the pixels per metre along the plane's two axes (vectors)
function frame(model, panel, a, b) {
  const o = toPixel(model, panel, a, b), pa = toPixel(model, panel, a + 1, b), pb = toPixel(model, panel, a, b + 1);
  return { o, ea: [pa[0] - o[0], pa[1] - o[1]], eb: [pb[0] - o[0], pb[1] - o[1]] };
}
// where a layer goes: [panel, a, b, angle] per copy (side: the right and / or left panel at the same spot; top, front, rear:
// mirrored across the middle too when side is 'both')
function copiesOf(l) {
  if (l.view === 'side') return (l.side === 'both' ? ['right', 'left'] : [l.side]).map(p => [p, l.x, l.y, l.a]);
  const p = l.view, out = [[p, l.x, l.y, l.a]];
  if (l.side === 'both') out.push(p === 'top' ? [p, l.x, -l.y, -l.a] : [p, -l.x, l.y, 180 - l.a]);
  return out;
}
const SHAPE_PATHS = {
  // in a unit square (−0.5 … 0.5), +y = up on the car's plane
  chevron: g => { g.moveTo(-0.5, -0.5); g.lineTo(0.5, 0); g.lineTo(-0.5, 0.5); g.lineTo(-0.2, 0); g.closePath(); },
  circle: g => g.arc(0, 0, 0.5, 0, Math.PI * 2),
  ring: g => { g.arc(0, 0, 0.5, 0, Math.PI * 2); g.moveTo(0.32, 0); g.arc(0, 0, 0.32, 0, Math.PI * 2, true); },
  triangle: g => { g.moveTo(-0.5, -0.5); g.lineTo(0.5, -0.5); g.lineTo(0, 0.5); g.closePath(); },
  diamond: g => { g.moveTo(0, 0.5); g.lineTo(0.5, 0); g.lineTo(0, -0.5); g.lineTo(-0.5, 0); g.closePath(); },
  star: g => { for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.2 : 0.5, t = Math.PI / 2 + i * Math.PI / 5; g[i ? 'lineTo' : 'moveTo'](Math.cos(t) * r, Math.sin(t) * r); } g.closePath(); },
  square: g => g.rect(-0.5, -0.5, 1, 1),
  arrow: g => { g.moveTo(-0.5, -0.15); g.lineTo(0.1, -0.15); g.lineTo(0.1, -0.4); g.lineTo(0.5, 0); g.lineTo(0.1, 0.4); g.lineTo(0.1, 0.15); g.lineTo(-0.5, 0.15); g.closePath(); },
  bolt: g => { g.moveTo(-0.15, 0.5); g.lineTo(0.3, 0.5); g.lineTo(0.05, 0.1); g.lineTo(0.35, 0.1); g.lineTo(-0.25, -0.5); g.lineTo(-0.05, -0.05); g.lineTo(-0.35, -0.05); g.closePath(); },
};
// text upright in pixels along the copy's direction, fitted into w × h metres
function drawText(g, f, ang, w, h, text, fill, box, s) {
  const d = Math.PI / 180 * ang, ca = Math.cos(d), sa = Math.sin(d);
  let ux = (f.ea[0] * ca + f.eb[0] * sa) * s, uy = (f.ea[1] * ca + f.eb[1] * sa) * s;
  const vx = (-f.ea[0] * sa + f.eb[0] * ca) * s, vy = (-f.ea[1] * sa + f.eb[1] * ca) * s;
  const wpx = Math.hypot(ux, uy) * w, hpx = Math.hypot(vx, vy) * h;
  if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uy > 0)) { ux = -ux; uy = -uy; }        // (read left to right)
  g.save(); g.setTransform(1, 0, 0, 1, f.o[0] * s, f.o[1] * s); g.rotate(Math.atan2(uy, ux));
  if (box) { g.fillStyle = box; g.fillRect(-wpx / 2, -hpx / 2, wpx, hpx); }
  if (text) {
    let size = hpx * (box ? 0.72 : 1); g.font = `800 ${size}px ${FONT}`;
    const tw = g.measureText(text).width, room = wpx * (box ? 0.9 : 1);
    if (tw > room) { size *= room / tw; g.font = `800 ${size}px ${FONT}`; }
    g.fillStyle = fill; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, size * 0.04);
  }
  g.restore();
}
// one copy of a layer on a canvas (s = the canvas's scale: 1 the paint, 0.5 the mask); mask = a flat fill for the mask
function drawCopy(g, model, l, [panel, a, b, ang], s, mask) {
  const f = frame(model, panel, a, b), d = Math.PI / 180 * ang, ca = Math.cos(d), sa = Math.sin(d);
  const PA = [(f.ea[0] * ca + f.eb[0] * sa) * s, (f.ea[1] * ca + f.eb[1] * sa) * s], PB = [(-f.ea[0] * sa + f.eb[0] * ca) * s, (-f.ea[1] * sa + f.eb[1] * ca) * s];
  const [rx, ry, rw, rh] = panelRect(panel);
  g.save(); g.beginPath(); g.rect(rx * s, ry * s, rw * s, rh * s); g.clip();             // (a layer stays on its panel)
  g.globalAlpha = mask ? 1 : l.o;
  if (l.kind === 'text' || l.kind === 'logo') {
    const brand = l.kind === 'logo' && BRANDS.find(x => x[0] === l.brand);
    if (mask) drawText(g, f, ang, l.w, l.h, l.kind === 'logo' ? '' : l.text, mask, l.kind === 'logo' ? mask : null, s);
    else if (brand) drawText(g, f, ang, l.w, l.h, brand[0], brand[2], brand[1], s);
    else drawText(g, f, ang, l.w, l.h, l.text, hex(l.c), null, s);
  } else {
    g.setTransform(PA[0], PA[1], PB[0], PB[1], f.o[0] * s, f.o[1] * s);
    if (l.kind === 'fade' && !mask) {
      const gr = g.createLinearGradient(-l.w / 2, 0, l.w / 2, 0), c2 = hex(l.c2 ?? l.c);
      gr.addColorStop(0, c2 + '00'); gr.addColorStop(1, hex(l.c)); g.fillStyle = gr;
    } else g.fillStyle = mask || hex(l.c);
    if (l.kind === 'shape') { g.scale(l.w, l.h); g.beginPath(); SHAPE_PATHS[l.shape](g); g.fill('evenodd'); }
    else g.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
  }
  g.restore();
}
// the race number and the name: the model's spots (livery.js MODELS), as text copies
function numberCopies(model, L) {
  const M = modelOf(model), out = [], colour = L.numberLook?.colour ?? contrastOf(L.color);
  const t = String(L.number ?? '');
  if (t && L.numberLook?.side !== false) { const [x, y, h] = M.number.side; out.push({ kind: 'text', text: t, view: 'side', side: 'both', x, y, w: h * 1.6, h, a: 0, c: colour, o: 1 }); }
  if (t && L.numberLook?.nose !== false) { const [x, , h] = M.number.nose; out.push({ kind: 'text', text: t, view: 'top', side: 'right', x, y: 0, w: h * 1.6, h, a: 0, c: colour, o: 1 }); }
  if (L.name) { const [x, y, h] = M.name; out.push({ kind: 'text', text: L.name.toUpperCase(), view: 'side', side: 'both', x, y, w: h * 10, h, a: 0, c: colour, o: 1 }); }
  return out;
}

// a soft round brush in a colour (cached)
const brushes = new Map();
function brushOf(colour, soft) {
  const key = colour + ':' + soft;
  if (brushes.has(key)) return brushes.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64), col = hex(colour);
  gr.addColorStop(0, col + 'ff'); gr.addColorStop(Math.max(0.01, 1 - soft / 100) * 0.98, col + 'ff'); gr.addColorStop(1, col + '00');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  if (brushes.size > 64) brushes.clear();
  brushes.set(key, c); return c;
}

// the player's paint per model (the garage's car and the race car share it)
const painters = new Map();
export function painterFor(model) {
  if (painters.has(model)) return painters.get(model);
  const mk = n => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
  const atlas = mk(ATLAS), spray = mk(ATLAS), mask = mk(MASK), sprayMask = mk(MASK);
  const ga = atlas.getContext('2d'), gs = spray.getContext('2d'), gm = mask.getContext('2d'), gsm = sprayMask.getContext('2d');
  const atlasTex = new THREE.CanvasTexture(atlas), maskTex = new THREE.CanvasTexture(mask);
  atlasTex.anisotropy = 4; atlasTex.premultiplyAlpha = true;
  maskTex.minFilter = maskTex.magFilter = THREE.NearestFilter; maskTex.generateMipmaps = false;
  let last = null, sprayRef = null, done = { s: 0, p: 0 }, scratch = null;

  // one stroke's points from index `from` (a point = 3 numbers) onto the spray canvases
  function strokeOnto(st, from) {
    const lockFill = `rgb(${st.lock},0,0)`, line = st.k === 'l';
    const paint = (panel, a, b, prev) => {
      const [x, y] = toPixel(model, panel, a / 1000, b / 1000), ppm = pixelsPerMetre(model, panel)[0], r = st.r / 1000 * ppm;
      if (line) {
        if (!prev) return;
        const [px, py] = toPixel(model, panel, prev[0] / 1000, prev[1] / 1000);
        for (const [g, s, col] of [[gs, 1, hex(st.c)], [gsm, 0.5, lockFill]]) {
          g.save(); g.strokeStyle = col; g.lineWidth = 2 * r * s; g.lineCap = 'butt'; g.beginPath(); g.moveTo(px * s, py * s); g.lineTo(x * s, y * s); g.stroke(); g.restore();
        }
        return;
      }
      // dabs every quarter of the brush from the last point
      const n = prev ? Math.max(1, Math.ceil(Math.hypot(x - prev.x, y - prev.y) / Math.max(1, r * 0.25))) : 1;
      for (let i = 1; i <= n; i++) {
        const t = i / n, dx = prev ? prev.x + (x - prev.x) * t : x, dy = prev ? prev.y + (y - prev.y) * t : y;
        gs.save();
        if (st.k === 'e') gs.globalCompositeOperation = 'destination-out';
        gs.globalAlpha = st.flow / 100 * 0.5; gs.drawImage(brushOf(st.k === 'e' ? 0 : st.c, st.soft), dx - r, dy - r, 2 * r, 2 * r);
        gs.restore();
        if (st.k !== 'e') { gsm.fillStyle = lockFill; gsm.beginPath(); gsm.arc(dx / 2, dy / 2, r * 0.85 / 2, 0, Math.PI * 2); gsm.fill(); }
      }
      return { x, y };
    };
    const tracks = st.m ? [false, true] : [false];
    for (const twin of tracks) {
      let prev = null, prevPanel = -1;
      const start = Math.max(0, from - 3);                  // (the point before, to join up)
      for (let i = start; i + 2 < st.p.length; i += 3) {
        let panel = PANELS[st.p[i]], a = st.p[i + 1], b = st.p[i + 2];
        if (twin) [panel, a, b] = twinOf(panel, a, b);
        if (st.p[i] !== prevPanel) prev = null;
        const lineFrom = line && i > 0 ? (twin ? twinOf(PANELS[st.p[i - 3]], st.p[i - 2], st.p[i - 1]).slice(1) : [st.p[i - 2], st.p[i - 1]]) : null;
        if (i < from && !line) { const [x, y] = toPixel(model, panel, a / 1000, b / 1000); prev = { x, y }; }
        else prev = paint(panel, a, b, line ? lineFrom : prev);
        prevPanel = st.p[i];
      }
    }
  }
  function sprayAll(list) {
    gs.clearRect(0, 0, ATLAS, ATLAS); gsm.clearRect(0, 0, MASK, MASK);
    for (const st of list) strokeOnto(st, 0);
    done = { s: list.length, p: list.length ? list[list.length - 1].p.length : 0 };
  }
  function sprayMore(list) {
    if (list !== sprayRef || list.length < done.s || (done.s && list[done.s - 1].p.length < done.p)) { sprayRef = list; sprayAll(list); return true; }
    let any = false;
    for (let i = Math.max(0, done.s - 1); i < list.length; i++) {
      const from = i === done.s - 1 ? done.p : 0;
      if (list[i].p.length > from) { strokeOnto(list[i], from); any = true; }
    }
    if (list.length) done = { s: list.length, p: list[list.length - 1].p.length };
    return any;
  }
  // the whole texture for a livery: the layers (+ their mask: 'body only'), the number and name, the spray over them
  let lastL = null;
  function update(L, force = false) {
    lastL = L;
    const layersKey = JSON.stringify([L.layers, L.number, L.numberLook, L.name, L.color]);
    const sprayChanged = sprayMore(L.spray || []);
    if (!force && !sprayChanged && layersKey === last) return;
    last = layersKey;
    ga.clearRect(0, 0, ATLAS, ATLAS); gm.clearRect(0, 0, MASK, MASK);
    for (const l of [...(L.layers || []).filter(l => l.on), ...numberCopies(model, L)])
      for (const c of copiesOf(l)) {
        const st = STICKERS.has(l.kind) ? stickerOf(model, l, c) : null;
        if (!st) { drawCopy(ga, model, l, c, 1, null); drawCopy(gm, model, l, c, 0.5, `rgb(0,${l.body ? 255 : 0},0)`); continue; }
        // (flat on a scratch canvas, then laid on its surface: wrapSticker)
        const k = DEPTH.div, bx = st.x * k, by = st.y * k, bw = st.w * k, bh = st.h * k;
        scratch ??= mk(ATLAS); const gx = scratch.getContext('2d', { willReadFrequently: true });
        gx.clearRect(bx, by, bw, bh); gx.save(); gx.beginPath(); gx.rect(bx, by, bw, bh); gx.clip(); drawCopy(gx, model, l, c, 1, null); gx.restore();
        const lay = wrapSticker(st, gx.getImageData(bx, by, bw, bh).data, bx, by, bw, bh);
        gx.putImageData(new ImageData(lay, bw, bh), bx, by);
        ga.drawImage(scratch, bx, by, bw, bh, bx, by, bw, bh);
        gm.save(); gm.beginPath(); gm.rect(bx / 2, by / 2, bw / 2, bh / 2); gm.clip(); drawCopy(gm, model, l, c, 0.5, `rgb(0,${l.body ? 255 : 0},0)`); gm.restore();
      }
    ga.drawImage(spray, 0, 0); gm.drawImage(sprayMask, 0, 0);
    atlasTex.needsUpdate = true; maskTex.needsUpdate = true;
  }
  const p = { atlasTex, maskTex, update, model, canvas: atlas, redraw: () => { if (lastL) update(lastL, true); },
    // the colour at a pixel of the paint (the garage's colour picker), or null where it is bare
    colourAt(panel, a, b) { const [x, y] = toPixel(model, panel, a, b), d = ga.getImageData(Math.round(x), Math.round(y), 1, 1).data; return d[3] > 128 ? (d[0] << 16) | (d[1] << 8) | d[2] : null; } };
  painters.set(model, p);
  return p;
}
// redraw once the fonts are in (the number and text layers)
document.fonts?.load(`800 64px ${FONT}`).then(() => { for (const p of painters.values()) p.redraw(); }).catch(() => {});

// ---- the outer skin seen from each panel's side (2026-11-16, user: layers looked "like a projection … from one side,
// splitting the text, shape … across different parts of the body": a layer went onto every surface behind the skin too):
// per texel of the paint texture's layout (a quarter of its size), how far out the car's outermost surface is toward that
// panel's viewer (right z, left −z, top y, front x, rear −x), from the model's own triangles (paint, carbon, halo; not the
// wheels or lights). The shader paints a pixel only within DEPTH.tol of it: a layer stays on the skin it was put on.
const COVER = ['0.10', '0.35'];   // a panel's paint from this facing (n · its direction) up to full
export const DEPTH = { div: 4, tol: 0.03, roles: new Set(['paint_main', 'paint_accent', 'carbon', 'halo']), range: 4 };
const DS = ATLAS / DEPTH.div, depths = new Map();
const outward = { right: p => p.z, left: p => -p.z, top: p => p.y, front: p => p.x, rear: p => -p.x };
export function depthFor(model, template) {
  if (depths.has(model)) return depths.get(model);
  const D = new Float32Array(DS * DS).fill(-99), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const rects = Object.fromEntries(PANELS.map(n => [n, panelRect(n).map(v => v / DEPTH.div)]));
  const put = (n, c, r, d) => {
    const [rx, ry, rw, rh] = rects[n], i = Math.floor(c), j = Math.floor(r);
    if (i < rx || i >= rx + rw || j < ry || j >= ry + rh) return;
    const k = (DS - 1 - j) * DS + i; if (d > D[k]) D[k] = d;              // (rows from the bottom: the texture's v runs up)
  };
  const proj = (n, p) => { const [px, py] = toPixel(model, n, ...planeOf(n, p)); return [px / DEPTH.div, py / DEPTH.div, outward[n](p)]; };
  template.updateMatrixWorld(true);
  template.traverse(o => {
    if (!o.isMesh || !DEPTH.roles.has(o.material?.name) || /^(helmet|visor)$/.test(o.name)) return;
    for (let q = o.parent; q; q = q.parent) if (/^wheel_/.test(q.name)) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n3 = idx ? idx.count : pos.count;
    for (let t = 0; t < n3; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      A.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      for (const n of PANELS) {
        const a = proj(n, A), b = proj(n, B), c = proj(n, C);
        put(n, a[0], a[1], a[2]); put(n, b[0], b[1], b[2]); put(n, c[0], c[1], c[2]);       // (triangles smaller than a texel)
        const x0 = Math.floor(Math.min(a[0], b[0], c[0])), x1 = Math.ceil(Math.max(a[0], b[0], c[0])), y0 = Math.floor(Math.min(a[1], b[1], c[1])), y1 = Math.ceil(Math.max(a[1], b[1], c[1]));
        const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(det) < 1e-9 || (x1 - x0) * (y1 - y0) > 40000) continue;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const px = x + 0.5, py = y + 0.5, l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det, l3 = 1 - l1 - l2;
          if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
          put(n, px, py, l1 * a[2] + l2 * b[2] + l3 * c[2]);
        }
      }
    }
  });
  // (a texel's neighbours too: no pinholes between triangles, and a surface sloping across a texel still within it)
  const out = new Uint8Array(DS * DS * 4), grid = new Float32Array(DS * DS).fill(-99);
  for (let j = 0; j < DS; j++) for (let i = 0; i < DS; i++) {
    let m = -99;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di; if (jj >= 0 && jj < DS && ii >= 0 && ii < DS) m = Math.max(m, D[jj * DS + ii]); }
    if (m < -50) continue;
    grid[j * DS + i] = m;
    const v = Math.round(Math.min(1, Math.max(0, (m + DEPTH.range) / (2 * DEPTH.range))) * 65535), k = (j * DS + i) * 4;
    out[k] = v >> 8; out[k + 1] = v & 255; out[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, DS, DS, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  depths.set(model, tex); skins.set(model, grid);
  painters.get(model)?.redraw();          // (drawn before the skin was known: again, each layer on its own surface)
  return tex;
}
const skins = new Map();
// A layer as a sticker (2026-11-16, user: layers "split … across different parts of the body"): the part of the outer skin
// reachable from the layer's middle without a step (neighbouring texels less than STEP apart toward the viewer), within
// its reach; the layer is drawn there only. → { x, y, w, h (texels), canvas (white where it goes) } or null (no skin known)
const STEP = 0.035;
function stickerOf(model, l, [panel, a, b]) {
  const G = skins.get(model); if (!G) return null;
  const [rx, ry, rw, rh] = panelRect(panel).map(v => v / DEPTH.div), [px, py] = toPixel(model, panel, a, b), ppm = pixelsPerMetre(model, panel);
  const reach = Math.hypot(l.w * ppm[0], l.h * ppm[1]) / 2 / DEPTH.div + 2;
  const x0 = Math.max(rx, Math.floor(px / DEPTH.div - reach)), x1 = Math.min(rx + rw, Math.ceil(px / DEPTH.div + reach));
  const y0 = Math.max(ry, Math.floor(py / DEPTH.div - reach)), y1 = Math.min(ry + rh, Math.ceil(py / DEPTH.div + reach));
  const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return null;
  const at = (i, j) => G[(DS - 1 - j) * DS + i];                      // (texel column i, row j from the top)
  let si = Math.floor(px / DEPTH.div), sj = Math.floor(py / DEPTH.div), found = false;
  for (let r = 0; r <= 8 && !found; r++) for (let dj = -r; dj <= r && !found; dj++) for (let di = -r; di <= r && !found; di++) {
    const i = si + di, j = sj + dj; if (i >= x0 && i < x1 && j >= y0 && j < y1 && at(i, j) > -50) { si = i; sj = j; found = true; }
  }
  if (!found) return null;
  const mark = new Uint8Array(w * h), q = [si, sj]; mark[(sj - y0) * w + (si - x0)] = 1;
  while (q.length) {
    const j = q.pop(), i = q.pop(), d = at(i, j);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj; if (ii < x0 || ii >= x1 || jj < y0 || jj >= y1) continue;
      const k = (jj - y0) * w + (ii - x0); if (mark[k]) continue;
      const e = at(ii, jj); if (e < -50 || Math.abs(e - d) > STEP) continue;
      mark[k] = 1; q.push(ii, jj);
    }
  }
  // (spikes and specks along a step: texels with fewer than 3 neighbours in the region dropped, twice)
  for (let pass = 0; pass < 2; pass++) {
    const drop = [];
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i; if (!mark[k] || (i + x0 === si && j + y0 === sj)) continue;
      if (mark[k - 1] + mark[k + 1] + mark[k - w] + mark[k + w] < 3) drop.push(k);
    }
    for (const k of drop) mark[k] = 0;
  }
  // the skin's height at a paint pixel (bilinear between texels; NaN off the sticker's surface)
  const hAt = (X, Y) => {
    const fx = X / DEPTH.div - 0.5, fy = Y / DEPTH.div - 0.5, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    let sum = 0, wsum = 0;
    for (const [di, dj, ww] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const ii = i + di, jj = j + dj; if (ii < x0 || ii >= x1 || jj < y0 || jj >= y1 || !mark[(jj - y0) * w + (ii - x0)]) continue;
      sum += at(ii, jj) * ww; wsum += ww;
    }
    return wsum > 0.01 ? sum / wsum : NaN;
  };
  return { x: x0, y: y0, w, h, mark, hAt, ax: px, ay: py, ppm };
}
// A sticker lies on the surface: each paint pixel of it takes the flat layer's pixel at its distance from the middle
// measured along the skin (arc length along its row, then along its column), so where the bodywork turns away the layer
// keeps its real size instead of stretching down the slope. src = the flat layer's pixels over the box (RGBA), → RGBA
const TURN = 2;   // slope (along the surface / across the view) where a sticker ends
function wrapSticker(st, src, bx, by, bw, bh) {
  const out = new Uint8ClampedArray(bw * bh * 4), { hAt, ax, ay, ppm } = st, mx = 1 / ppm[0], my = 1 / ppm[1];
  const AX = Math.round(ax), AY = Math.round(ay);
  // along each row from the middle's column: arc length (pixels of plane) to every pixel
  const rowArc = new Float32Array(bw * bh).fill(NaN), colArc = new Float32Array(bw * bh).fill(NaN);
  for (let y = 0; y < bh; y++) {
    const Y = by + y + 0.5, a0 = Math.min(bw - 1, Math.max(0, AX - bx)); let h0 = hAt(bx + a0 + 0.5, Y);
    if (Number.isNaN(h0)) continue;
    rowArc[y * bw + a0] = 0;
    for (const dir of [1, -1]) {
      let acc = 0, hp = h0;
      for (let x = a0 + dir; x >= 0 && x < bw; x += dir) {
        const h = hAt(bx + x + 0.5, Y); if (Number.isNaN(h)) break;
        const sl = (h - hp) / mx; if (Math.abs(sl) > TURN) break;     // (turned away past ~63°: the sticker's edge)
        acc += Math.hypot(1, sl); hp = h; rowArc[y * bw + x] = acc * dir;
      }
    }
  }
  for (let x = 0; x < bw; x++) {
    const X = bx + x + 0.5, b0 = Math.min(bh - 1, Math.max(0, AY - by)); const h0 = hAt(X, by + b0 + 0.5);
    if (Number.isNaN(h0)) continue;
    colArc[b0 * bw + x] = 0;
    for (const dir of [1, -1]) {
      let acc = 0, hp = h0;
      for (let y = b0 + dir; y >= 0 && y < bh; y += dir) {
        const h = hAt(X, by + y + 0.5); if (Number.isNaN(h)) break;
        const sl = (h - hp) / my; if (Math.abs(sl) > TURN) break;
        acc += Math.hypot(1, sl); hp = h; colArc[y * bw + x] = acc * dir;
      }
    }
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x, u = rowArc[k], v = colArc[k];
    if (Number.isNaN(u) || Number.isNaN(v) || Number.isNaN(hAt(bx + x + 0.5, by + y + 0.5))) continue;
    const sx = Math.round(AX - bx + u), sy = Math.round(AY - by + v);
    if (sx < 0 || sx >= bw || sy < 0 || sy >= bh) continue;
    const q = (sy * bw + sx) * 4, o = k * 4;
    out[o] = src[q]; out[o + 1] = src[q + 1]; out[o + 2] = src[q + 2]; out[o + 3] = src[q + 3];
  }
  return out;
}
const STICKERS = new Set(['text', 'logo', 'shape']);   // (stripes and fades are paint across the car: projected)

// ---- the shader
const empty = (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })();
// one car's uniforms, shared by its paint and carbon materials (each adds its own uMatBit)
export function liveryUniforms(model) {
  const v4 = () => Array.from({ length: MAXBOX }, () => new THREE.Vector4());
  const M = modelOf(model), U = {
    uCarInv: { value: new THREE.Matrix4() }, uBoxA: { value: v4() }, uBoxB: { value: v4() }, uBoxCol: { value: v4() }, uBoxFin: { value: v4() },
    uAtlas: { value: empty }, uMask: { value: empty }, uHasAtlas: { value: 0 }, uDepth: { value: empty }, uHasDepth: { value: 0 },
    uPlane: { value: new THREE.Vector4(M.panels.x[0], M.panels.x[1], M.panels.y[0], M.panels.y[1]) }, uPlaneZ: { value: M.panels.z },
    uEx: { value: [0, 1, 2, 3].map(() => new THREE.Color()) }, uExLip: { value: new THREE.Color() }, uExGeo: { value: new THREE.Vector4() },
    uExFin: { value: new THREE.Vector2() }, uExC: { value: M.exhaust?.y ?? 0 }, uHeat: { value: 0 }, uFoil: { value: 0 }, uIds: { value: new THREE.Vector2(zoneIndex('exhaust'), zoneIndex('foil')) },
  };
  return U;
}
// a livery onto the uniforms: zone boxes with their colours and finishes, the exhaust, the foil, the paint texture
export function setLivery(U, model, L, painter = null) {
  const M = modelOf(model), parts = L.parts ?? PARTS_DEFAULTS;
  const colourOfZone = id => {
    const z = L.zones?.[id]; if (!z) return null;
    if (z.ref === 'body') return L.color; if (z.ref === 'accent') return L.accent;
    return z.c ?? (z.f === 'carbon' ? CARBON : null);
  };
  M.boxes.slice(0, MAXBOX).forEach(([id, x0, x1, y0, y1, z0, z1, mat], i) => {
    U.uBoxA.value[i].set(x0, x1, y0, y1); U.uBoxB.value[i].set(z0, z1, zoneIndex(id), mat);
    const c = colourOfZone(id), f = L.zones?.[id]?.f ?? (c !== null ? L.finish ?? 'gloss' : null);
    const col = new THREE.Color(c ?? 0); U.uBoxCol.value[i].set(col.r, col.g, col.b, c !== null ? 1 : 0);
    const fin = FIN[f]; U.uBoxFin.value[i].set(fin?.[0] ?? 0, fin?.[1] ?? 0, fin?.[2] ?? 0, fin ? 1 : 0);
  });
  for (let i = M.boxes.length; i < MAXBOX; i++) U.uBoxB.value[i].set(0, 0, -1, 0);
  const E = EXHAUSTS[parts.exhaust] ?? EXHAUSTS.worn;
  E.stops.forEach((c, i) => U.uEx.value[i].setHex(c)); U.uExLip.value.setHex(E.lip);
  U.uExGeo.value.set(M.exhaust?.root ?? 0, M.exhaust?.lip ?? -1, M.exhaust ? 1 : 0, parts.glow ? 1 : 0);
  U.uExFin.value.set(E.rough, E.metal);
  U.uFoil.value = parts.foil ? 1 : 0;
  U.uAtlas.value = painter?.atlasTex ?? empty; U.uMask.value = painter?.maskTex ?? empty; U.uHasAtlas.value = painter ? 1 : 0;
}
const VERT_HEAD = 'uniform mat4 uCarInv;\nvarying vec3 vCarPos;\nvarying vec3 vCarNrm;\n';
const VERT_BODY = '{ vec4 lwp = modelMatrix * vec4(transformed, 1.0); vCarPos = (uCarInv * lwp).xyz; vCarNrm = mat3(uCarInv) * (mat3(modelMatrix) * objectNormal); }\n';
const FRAG_HEAD = `
varying vec3 vCarPos; varying vec3 vCarNrm;
uniform vec4 uBoxA[${MAXBOX}]; uniform vec4 uBoxB[${MAXBOX}]; uniform vec4 uBoxCol[${MAXBOX}]; uniform vec4 uBoxFin[${MAXBOX}];
uniform float uMatBit; uniform sampler2D uAtlas; uniform sampler2D uMask; uniform float uHasAtlas; uniform sampler2D uDepth; uniform float uHasDepth;
// on a panel's side, is this point on the car's outer skin there (within the tolerance of the outermost surface)?
float livSkin(vec2 uv, float d, float f) {
  if (uHasDepth < 0.5) return 1.0;
  vec4 t = texture2D(uDepth, uv); if (t.a < 0.5) return 0.0;
  float outer = (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * ${(2 * DEPTH.range).toFixed(1)} - ${DEPTH.range.toFixed(1)};
  // (a surface steep to the viewer drops a lot within one texel: more room there)
  return step(outer - d, min(0.15, ${DEPTH.tol.toFixed(3)} + 0.017 * sqrt(max(0.0, 1.0 - f * f)) / max(f, 0.1)));
}
uniform vec4 uPlane; uniform float uPlaneZ;
uniform vec3 uEx[4]; uniform vec3 uExLip; uniform vec4 uExGeo; uniform float uExC; uniform vec2 uExFin; uniform float uHeat; uniform float uFoil; uniform vec2 uIds;
vec4 livFin = vec4(0.0); vec3 livEmit = vec3(0.0);
float livHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// a panel's texture coordinates from its place in the atlas (pixels, from the top) and the point's place on it (0..1)
vec2 livUV(vec4 r, vec2 f) { return vec2((r.x + f.x * r.z) / ${ATLAS}.0, 1.0 - (r.y + (1.0 - f.y) * r.w) / ${ATLAS}.0); }
float livIn(vec2 f) { return step(0.0, f.x) * step(f.x, 1.0) * step(0.0, f.y) * step(f.y, 1.0); }
`;
const R = name => { const [x, y, w, h] = panelRect(name); return `vec4(${x}.0, ${y}.0, ${w}.0, ${h}.0)`; };
const FRAG_COLOUR = `
{
  vec3 p = vCarPos; vec3 n = normalize(vCarNrm); float az = abs(p.z);
  float zid = -1.0; vec4 zcol = vec4(0.0); vec4 zfin = vec4(0.0);
  for (int i = 0; i < ${MAXBOX}; i++) {
    vec4 a = uBoxA[i]; vec4 b = uBoxB[i];
    if (p.x >= a.x && p.x <= a.y && p.y >= a.z && p.y <= a.w && az >= b.x && az <= b.y && mod(floor(b.w / uMatBit + 0.001), 2.0) > 0.5) { zid = b.z; zcol = uBoxCol[i]; zfin = uBoxFin[i]; }
  }
  vec3 base = diffuseColor.rgb;
  if (zcol.a > 0.5) base = zcol.rgb;
  bool hw = false;   // (the exhaust and its foil: no paint over them)
  if (abs(zid - uIds.x) < 0.5 && uExGeo.z > 0.5) {
    hw = true;
    float t = clamp((uExGeo.x - p.x) / max(0.001, uExGeo.x - uExGeo.y), 0.0, 1.0), s = t * 3.0;
    base = s < 1.0 ? mix(uEx[0], uEx[1], s) : s < 2.0 ? mix(uEx[1], uEx[2], s - 1.0) : mix(uEx[2], uEx[3], s - 2.0);
    // soot toward the lip, and the bore inside dark (faces turned toward the pipe's axis)
    float inside = step(dot(n.yz, normalize(vec2(p.y - uExC, p.z) + 1e-5)), -0.2);
    base = mix(base, uExLip, max(smoothstep(0.82, 1.0, t), inside * 0.9));
    zfin = vec4(uExFin, 0.0, 1.0);
    livEmit = vec3(1.0, 0.38, 0.08) * uHeat * uExGeo.w * smoothstep(0.45, 1.0, t) * 1.4;
  } else if (abs(zid - uIds.y) < 0.5 && uFoil > 0.5) {
    hw = true;
    // crinkled foil: patches a few centimetres across, each catching the light a little differently
    vec2 q = vec2(p.x + p.y * 0.7, p.z + p.y * 0.3) * 45.0, iq = floor(q), fq = fract(q);
    float a = livHash(iq), b = livHash(iq + vec2(1.0, 0.0)), c = livHash(iq + vec2(0.0, 1.0)), d = livHash(iq + vec2(1.0, 1.0));
    vec2 sm = fq * fq * (3.0 - 2.0 * fq); float crinkle = mix(mix(a, b, sm.x), mix(c, d, sm.x), sm.y);
    base = vec3(0.86, 0.68, 0.27) * (0.8 + 0.35 * crinkle);
    zfin = vec4(0.15 + 0.25 * crinkle, 1.0, 0.0, 1.0);
  }
  if (uHasAtlas > 0.5 && !hw) {
    float ux = (p.x - uPlane.x) / (uPlane.y - uPlane.x), vy = (p.y - uPlane.z) / (uPlane.w - uPlane.z), uz = (p.z + uPlaneZ) / (2.0 * uPlaneZ);
    vec2 fR = vec2(ux, vy), fL = vec2(1.0 - ux, vy), fT = vec2(ux, 1.0 - uz), fF = vec2(1.0 - uz, vy), fB = vec2(uz, vy);
    // (2026-11-16: like a sticker pressed on from that side: each panel covers every surface of the outer skin facing its
    // way by more than LO, fully past HI, so a layer runs on round a curve instead of fading out half way (the old blend
    // by facing⁴ cut texts in two); where two panels overlap, the one the surface faces most goes on top)
    float wS = abs(n.z), wT = max(n.y, 0.0), wX = abs(n.x);
    vec4 rS = n.z >= 0.0 ? ${R('right')} : ${R('left')}; vec2 fS = n.z >= 0.0 ? fR : fL;
    vec4 rX = n.x >= 0.0 ? ${R('front')} : ${R('rear')}; vec2 fX = n.x >= 0.0 ? fF : fB;
    vec2 uS = livUV(rS, fS), uT = livUV(${R('top')}, fT), uX = livUV(rX, fX);
    float kS = livIn(fS) * smoothstep(${COVER[0]}, ${COVER[1]}, wS) * livSkin(uS, n.z >= 0.0 ? p.z : -p.z, wS);
    float kT = livIn(fT) * smoothstep(${COVER[0]}, ${COVER[1]}, wT) * livSkin(uT, p.y, wT);
    float kX = livIn(fX) * smoothstep(${COVER[0]}, ${COVER[1]}, wX) * livSkin(uX, n.x >= 0.0 ? p.x : -p.x, wX);
    vec4 l0 = texture2D(uAtlas, uS) * kS, l1 = texture2D(uAtlas, uT) * kT, l2 = texture2D(uAtlas, uX) * kX, tl; float w0 = wS, w1 = wT, w2 = wX, tw;
    if (w0 > w1) { tl = l0; l0 = l1; l1 = tl; tw = w0; w0 = w1; w1 = tw; }
    if (w1 > w2) { tl = l1; l1 = l2; l2 = tl; tw = w1; w1 = w2; w2 = tw; }
    if (w0 > w1) { tl = l0; l0 = l1; l1 = tl; }
    vec2 um = wS >= wT && wS >= wX ? uS : wT >= wX ? uT : uX;
    vec4 m = texture2D(uMask, um);
    float lock = floor(m.r * 255.0 + 0.5), k = 1.0;
    if (lock > 0.5 && abs(lock - (zid + 1.0)) > 0.5) k = 0.0;          // (sprayed on another zone only)
    if (m.g > 0.5 && uMatBit > 3.5) k = 0.0;                            // (a layer on the paint only)
    base = base * (1.0 - l0.a * k) + l0.rgb * k;                        // (premultiplied, the most-faced panel last)
    base = base * (1.0 - l1.a * k) + l1.rgb * k;
    base = base * (1.0 - l2.a * k) + l2.rgb * k;
  }
  diffuseColor.rgb = base;
  livFin = zfin;
}
`;
// patch a car material: the livery's colour before the vertex colours (the baked shading), its finish, the exhaust's glow
export function patchLivery(mat, U, bit) {
  const own = { uMatBit: { value: bit } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', FRAG_COLOUR + '#include <color_fragment>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += livEmit;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (livFin.w > 0.5) roughnessFactor = livFin.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (livFin.w > 0.5) metalnessFactor = livFin.y;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef CLEARCOAT\nif (livFin.w > 0.5) material.clearcoat = livFin.z;\n#endif');
  };
  mat.customProgramCacheKey = () => 'livery-2';
  return mat;
}
export { MAT, ZONE_IDS };
