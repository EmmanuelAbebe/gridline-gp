// Layout → Move and resize (2026-10-26, user: "manipulate the UI as I want … simple relocation and resizing of
// elements"; 2026-10-31 reworked from the canvas mock-up, user: "more robust alignment and resizing of elements to make it
// easier to group buttons and actions"): over the driving screen every element is a box. Drag = move, the corner = resize,
// both snapping to an 8 px grid (GRID) and to the other boxes' edges and centres (a guide line shows what lined up).
// SELECT MORE picks several; then align (left / centre / right, top / middle / bottom: one box aligns to the screen),
// SAME SIZE, SPREAD (equal gaps, 3 or more), GROUP (moves as one, a named frame; UNGROUP splits it), MIRROR (the left
// side's boxes copied onto their right-hand partners), UNDO. Nothing is sent to the game meanwhile (App pauses the
// engine). Done saves the boxes and groups as the profile's own layout (layout.free / layout.groups); Standard goes back
// to the race wheel.
import { useRef, useState } from 'react';
import { clampRect, MIN_BOX, type Config, type FreeLayout, type Groups, type Rect } from '../settings/settings.ts';
import { boxStyle, fallbackRect, type Slot } from './Drive.tsx';
import { buzz } from './screen.ts';
import './LayoutEditor.css';

export interface Draft { boxes: FreeLayout; groups: Groups }
// the race wheel's clusters as the editor's first groups: PIT (its buttons + wheel / settings), RACE (+ reconnect / full screen)
export const clusterGroups = (cfg: Config): Groups => Object.fromEntries([
  ...cfg.buttons.map((b, i): [string, string] => [`btn${i}`, b.side === 'pit' ? 'PIT' : 'RACE']),
  ['wheel', 'PIT'], ['settings', 'PIT'], ['reconnect', 'RACE'], ['full', 'RACE']]);
const GRID = 8, NEAR = 6;   // px

// where every element is now on the screen (the race wheel, or your own layout), as shares of the screen
export function measureLayout(): FreeLayout {
  const out: FreeLayout = {}, W = innerWidth, H = innerHeight;
  document.querySelectorAll<HTMLElement>('.drive [data-slot]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out[el.dataset.slot!] = clampRect({ x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H });
  });
  return out;
}

type Px = { x: number; y: number; w: number; h: number };
const toPx = (r: Rect): Px => ({ x: r.x * innerWidth, y: r.y * innerHeight, w: r.w * innerWidth, h: r.h * innerHeight });
const toRect = (p: Px): Rect => clampRect({ x: p.x / innerWidth, y: p.y / innerHeight, w: p.w / innerWidth, h: p.h / innerHeight });
interface Guide { v: boolean; at: number; mid?: boolean }

export function LayoutEditor({ slots, pairs, draft, setDraft, done, cancel, standard }: {
  slots: Slot[]; pairs: [string, string][]; draft: Draft; setDraft: (d: Draft) => void; done: () => void; cancel: () => void; standard: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]), [more, setMore] = useState(false), [grid, setGrid] = useState(true);
  const [guides, setGuides] = useState<Guide[]>([]), [undo, setUndo] = useState<Draft[]>([]), [barDown, setBarDown] = useState(false);
  const drag = useRef<{ id: string; mode: 'move' | 'size'; x: number; y: number; pid: number; from: Record<string, Px>; moving: string[] } | null>(null);
  let missing = 0;
  const rects = slots.map((s) => ({ s, r: draft.boxes[s.id] ?? fallbackRect(missing++) }));
  const ids = rects.map((x) => x.s.id), px = (): Record<string, Px> => Object.fromEntries(rects.map(({ s, r }) => [s.id, toPx(r)]));
  const label = (id: string) => slots.find((s) => s.id === id)?.label ?? id;
  const groupOf = (id: string) => { const g = draft.groups[id]; return g ? ids.filter((k) => draft.groups[k] === g) : [id]; };
  const remember = () => setUndo((u) => [...u.slice(-29), draft]);
  const commit = (boxes: Record<string, Px>, groups = draft.groups) =>
    setDraft({ boxes: { ...draft.boxes, ...Object.fromEntries(Object.entries(boxes).map(([k, p]) => [k, toRect(p)])) }, groups });

  const start = (e: React.PointerEvent, id: string, mode: 'move' | 'size') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pick = groupOf(id);
    const next = more ? (sel.includes(id) ? sel.filter((k) => !pick.includes(k)) : [...new Set([...sel, ...pick])])
      : sel.includes(id) ? sel : pick;
    setSel(next); remember(); buzz(10);
    drag.current = { id, mode, x: e.clientX, y: e.clientY, pid: e.pointerId, from: px(), moving: mode === 'move' ? (next.includes(id) ? next : pick) : [id] };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y, me = d.from[d.id];
    const others = Object.entries(d.from).filter(([k]) => !d.moving.includes(k)).map(([, p]) => p), found: Guide[] = [];
    if (d.mode === 'size') {
      let w = me.w + dx, h = me.h + dy;
      if (grid) { w = Math.round((me.x + w) / GRID) * GRID - me.x; h = Math.round((me.y + h) / GRID) * GRID - me.y; }
      for (const o of others) {
        for (const ex of [o.x, o.x + o.w]) if (Math.abs(me.x + w - ex) < NEAR) { w = ex - me.x; found.push({ v: true, at: ex }); }
        for (const ey of [o.y, o.y + o.h]) if (Math.abs(me.y + h - ey) < NEAR) { h = ey - me.y; found.push({ v: false, at: ey }); }
        if (Math.abs(w - o.w) < NEAR) w = o.w;           // the same size as another box
        if (Math.abs(h - o.h) < NEAR) h = o.h;
      }
      const minW = MIN_BOX * innerWidth, minH = MIN_BOX * innerHeight;
      setGuides(found);
      commit({ [d.id]: { ...me, w: Math.max(minW, Math.min(w, innerWidth - me.x)), h: Math.max(minH, Math.min(h, innerHeight - me.y)) } });
      return;
    }
    // move: the dragged box snaps (grid, then the other boxes' edges and centres, the screen's centre line); the rest
    // of the selection / group follows by the same amount
    let x = me.x + dx, y = me.y + dy;
    if (grid) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
    let bx = NEAR, by = NEAR, sx = x, sy = y;
    for (const o of others) {
      for (const [mine, theirs] of [[0, o.x], [me.w, o.x + o.w], [me.w / 2, o.x + o.w / 2], [0, o.x + o.w], [me.w, o.x]]) {
        const dd = Math.abs(x + mine - theirs); if (dd < bx) { bx = dd; sx = theirs - mine; }
      }
      for (const [mine, theirs] of [[0, o.y], [me.h, o.y + o.h], [me.h / 2, o.y + o.h / 2], [0, o.y + o.h], [me.h, o.y]]) {
        const dd = Math.abs(y + mine - theirs); if (dd < by) { by = dd; sy = theirs - mine; }
      }
    }
    const mid = innerWidth / 2;
    if (Math.abs(mid - (x + me.w / 2)) < bx) { sx = mid - me.w / 2; found.push({ v: true, at: mid, mid: true }); }
    x = sx; y = sy;
    for (const o of others) {
      for (const g of [o.x, o.x + o.w / 2, o.x + o.w]) if ([x, x + me.w / 2, x + me.w].some((v) => Math.abs(v - g) < 0.5)) found.push({ v: true, at: g });
      for (const g of [o.y, o.y + o.h / 2, o.y + o.h]) if ([y, y + me.h / 2, y + me.h].some((v) => Math.abs(v - g) < 0.5)) found.push({ v: false, at: g });
    }
    const ox = x - me.x, oy = y - me.y;
    setGuides(found);
    commit(Object.fromEntries(d.moving.map((k) => { const f = d.from[k];
      return [k, { ...f, x: Math.max(0, Math.min(innerWidth - f.w, f.x + ox)), y: Math.max(0, Math.min(innerHeight - f.h, f.y + oy)) }]; })));
  };
  const end = (e: React.PointerEvent) => { if (drag.current?.pid === e.pointerId) { drag.current = null; setGuides([]); } };

  // the tools: each works on the selection, in px
  const chosen = () => { const all = px(); return sel.filter((k) => all[k]).map((k) => [k, all[k]] as [string, Px]); };
  const apply = (fn: (p: [string, Px][]) => Record<string, Px>) => { const p = chosen(); if (!p.length) return; remember(); commit(fn(p)); buzz(10); };
  const align = (how: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom') => apply((p) => {
    const L = Math.min(...p.map(([, r]) => r.x)), R = Math.max(...p.map(([, r]) => r.x + r.w)), T = Math.min(...p.map(([, r]) => r.y)), B = Math.max(...p.map(([, r]) => r.y + r.h));
    const one = p.length === 1, cx = one ? innerWidth / 2 : (L + R) / 2, cy = one ? innerHeight / 2 : (T + B) / 2;
    const l = one ? 0 : L, r = one ? innerWidth : R, t = one ? 0 : T, b = one ? innerHeight : B;
    return Object.fromEntries(p.map(([k, q]) => [k, { ...q, ...({ left: { x: l }, centre: { x: cx - q.w / 2 }, right: { x: r - q.w },
      top: { y: t }, middle: { y: cy - q.h / 2 }, bottom: { y: b - q.h } })[how] }]));
  });
  const sameSize = () => apply((p) => { const w = Math.max(...p.map(([, r]) => r.w)), h = Math.max(...p.map(([, r]) => r.h));
    return Object.fromEntries(p.map(([k, q]) => [k, { ...q, w, h }])); });
  const spread = () => apply((p) => {
    if (p.length < 3) return {};
    const spanX = Math.max(...p.map(([, r]) => r.x + r.w)) - Math.min(...p.map(([, r]) => r.x)), spanY = Math.max(...p.map(([, r]) => r.y + r.h)) - Math.min(...p.map(([, r]) => r.y));
    const k = spanX >= spanY ? 'x' : 'y', size = k === 'x' ? 'w' : 'h', s = [...p].sort((a, b) => a[1][k] - b[1][k]);
    const total = s.reduce((t, [, r]) => t + r[size], 0), last = s[s.length - 1][1], gap = (last[k] + last[size] - s[0][1][k] - total) / (s.length - 1);
    let at = s[0][1][k]; const out: Record<string, Px> = {};
    for (const [id, r] of s) { out[id] = { ...r, [k]: at }; at += r[size] + gap; }
    return out;
  });
  const grouped = sel.some((k) => draft.groups[k]);
  const group = () => {
    if (sel.length < 2) return;
    remember();
    const used = new Set(Object.values(draft.groups)); let n = 1; while (used.has(`GROUP ${n}`)) n++;
    setDraft({ ...draft, groups: { ...draft.groups, ...Object.fromEntries(sel.map((k) => [k, `GROUP ${n}`])) } }); buzz(10);
  };
  const ungroup = () => { remember(); setDraft({ ...draft, groups: Object.fromEntries(Object.entries(draft.groups).filter(([k]) => !sel.includes(k))) }); buzz(10); };
  const mirror = () => {
    const all = px(), out: Record<string, Px> = {};
    for (const [a, b] of pairs) {
      if (!all[a] || !all[b]) continue;
      const [src, dst] = all[a].x + all[a].w / 2 <= all[b].x + all[b].w / 2 ? [a, b] : [b, a], s = all[src];
      out[dst] = { x: innerWidth - s.x - s.w, y: s.y, w: s.w, h: s.h };
    }
    remember(); commit(out); buzz(10);
  };
  const back = () => { if (!undo.length) return; setDraft(undo[undo.length - 1]); setUndo(undo.slice(0, -1)); setSel([]); };

  // group frames (dashed, named) around each group's boxes
  const frames = [...new Set(Object.values(draft.groups))].map((name) => {
    const p = rects.filter(({ s }) => draft.groups[s.id] === name).map(({ r }) => r);
    if (!p.length) return null;
    const L = Math.min(...p.map((r) => r.x)), T = Math.min(...p.map((r) => r.y)), R = Math.max(...p.map((r) => r.x + r.w)), B = Math.max(...p.map((r) => r.y + r.h));
    return { name, r: { x: L, y: T, w: R - L, h: B - T } };
  }).filter((f) => f !== null);
  const n = sel.length, one = n === 1 ? rects.find((x) => x.s.id === sel[0]) : null, pct = (v: number) => `${Math.round(v * 100)}%`;
  const info = one ? `${one.s.label} · ${pct(one.r.w)} × ${pct(one.r.h)}` : n ? `${n} selected${grouped ? ' · grouped' : ''}` : 'drag = move · corner = resize · + SEL = several';
  const T = (txt: string, title: string, run: () => void, opts: { on?: boolean; off?: boolean; cls?: string } = {}) => (
    <button key={txt} className={`${opts.on ? 'on' : ''} ${opts.cls ?? ''}`} disabled={opts.off} onClick={run} title={title} aria-label={title}>{txt}</button>);

  return (
    <div className={`layout-editor ${grid ? 'grid' : ''}`} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerDown={() => { if (!more) setSel([]); }}>
      {frames.map((f) => <div key={f.name} className="ed-group" style={{ left: `calc(${f.r.x * 100}% - 8px)`, top: `calc(${f.r.y * 100}% - 10px)`,
        width: `calc(${f.r.w * 100}% + 16px)`, height: `calc(${f.r.h * 100}% + 18px)` }}><span>{f.name}</span></div>)}
      {rects.map(({ s, r }) => (
        <div key={s.id} className={`ed-box ${sel.includes(s.id) ? 'sel' : ''}`} style={boxStyle(r)} onPointerDown={(e) => start(e, s.id, 'move')}>
          <span className="ed-label">{s.label}</span>
          {sel.length === 1 && sel[0] === s.id && <span className="ed-size" onPointerDown={(e) => start(e, s.id, 'size')} aria-label={`Resize ${label(s.id)}`} />}
        </div>
      ))}
      {guides.map((g, i) => <i key={i} className={`ed-guide ${g.v ? 'v' : 'h'} ${g.mid ? 'mid' : ''}`} style={g.v ? { left: g.at } : { top: g.at }} />)}
      <div className={`ed-bar ${barDown ? 'down' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
        <span className="ed-info">{info}</span>
        <div className="ed-tools">
          {T('GRID', 'Snap to an 8 px grid', () => setGrid(!grid), { on: grid })}
          {T('+ SEL', 'Select more: tap boxes to add / remove them', () => setMore(!more), { on: more })}
          {T('⇤', 'Align left edges (one box: to the screen)', () => align('left'), { off: !n })}
          {T('⇹', 'Align centres (one box: the screen centre)', () => align('centre'), { off: !n })}
          {T('⇥', 'Align right edges', () => align('right'), { off: !n })}
          {T('⤒', 'Align tops', () => align('top'), { off: !n })}
          {T('↕', 'Align middles', () => align('middle'), { off: !n })}
          {T('⤓', 'Align bottoms', () => align('bottom'), { off: !n })}
          {T('SIZE =', 'Same size (the largest)', sameSize, { off: n < 2 })}
          {T('SPREAD', 'Equal gaps (3 or more)', spread, { off: n < 3 })}
          {grouped ? T('UNGROUP', 'Split the group', ungroup) : T('GROUP', 'Group: they move as one', group, { off: n < 2 })}
          {T('MIRROR', 'Copy the left side onto the right', mirror)}
          {T('UNDO', 'Undo', back, { off: !undo.length })}
          {T('⇅', 'Move this bar out of the way', () => setBarDown(!barDown))}
          {T('STD', 'Back to the race wheel', standard)}
          {T('✕', 'Cancel', cancel)}
          {T('DONE', 'Save this layout', done, { cls: 'primary' })}
        </div>
      </div>
    </div>
  );
}
