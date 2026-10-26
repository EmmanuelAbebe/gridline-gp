// Layout → Move and resize (2026-10-26, user: "manipulate the UI as I want … simple relocation and resizing of
// elements"): over the driving screen, every element is a box: drag it to move it, drag its corner to resize it
// (snapped to half a percent of the screen). Nothing is sent to the game meanwhile (App pauses the engine). Done saves
// the boxes as the profile's own layout (layout.free); Standard goes back to the built-in grid.
import { useRef, useState } from 'react';
import { clampRect, MIN_BOX, type FreeLayout, type Rect } from '../settings/settings.ts';
import { boxStyle, fallbackRect, type Slot } from './Drive.tsx';
import { buzz } from './screen.ts';
import './LayoutEditor.css';

const SNAP = 0.005;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

// where every element is now on the screen (the standard grid, or your own layout), as shares of the screen
export function measureLayout(): FreeLayout {
  const out: FreeLayout = {}, W = innerWidth, H = innerHeight;
  document.querySelectorAll<HTMLElement>('.drive [data-slot]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out[el.dataset.slot!] = clampRect({ x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H });
  });
  return out;
}

export function LayoutEditor({ slots, draft, setDraft, done, cancel, standard }: {
  slots: Slot[]; draft: FreeLayout; setDraft: (d: FreeLayout) => void; done: () => void; cancel: () => void; standard: () => void;
}) {
  const [sel, setSel] = useState<string | null>(null), [barDown, setBarDown] = useState(false);
  const drag = useRef<{ id: string; mode: 'move' | 'size'; x: number; y: number; r: Rect; pid: number } | null>(null);
  let missing = 0;
  const rects = slots.map((s) => ({ s, r: draft[s.id] ?? fallbackRect(missing++) }));

  const start = (e: React.PointerEvent, id: string, r: Rect, mode: 'move' | 'size') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, mode, x: e.clientX, y: e.clientY, r, pid: e.pointerId };
    setSel(id); buzz(10);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    const dx = (e.clientX - d.x) / innerWidth, dy = (e.clientY - d.y) / innerHeight, r = d.r;
    const next = d.mode === 'move'
      ? { ...r, x: snap(r.x + dx), y: snap(r.y + dy) }
      : { ...r, w: Math.max(MIN_BOX, snap(r.w + dx)), h: Math.max(MIN_BOX, snap(r.h + dy)) };
    setDraft({ ...draft, [d.id]: clampRect(next) });
  };
  const end = (e: React.PointerEvent) => { if (drag.current?.pid === e.pointerId) drag.current = null; };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const cur = sel ? rects.find((x) => x.s.id === sel) : null;

  return (
    <div className="layout-editor" onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerDown={() => setSel(null)}>
      {rects.map(({ s, r }) => (
        <div key={s.id} className={`ed-box ${sel === s.id ? 'sel' : ''}`} style={boxStyle(r)} onPointerDown={(e) => start(e, s.id, r, 'move')}>
          <span className="ed-label">{s.label}</span>
          <span className="ed-size" onPointerDown={(e) => start(e, s.id, r, 'size')} aria-label={`Resize ${s.label}`} />
        </div>
      ))}
      <div className={`ed-bar ${barDown ? 'down' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
        <span className="ed-info">{cur ? `${cur.s.label} · ${pct(cur.r.w)} × ${pct(cur.r.h)}` : 'drag to move · corner to resize'}</span>
        <button onClick={() => setBarDown(!barDown)} title="Move this bar out of the way" aria-label="Move this bar">⇅</button>
        <button onClick={standard} title="Back to the built-in layout">Standard</button>
        <button onClick={cancel}>Cancel</button>
        <button className="primary" onClick={done}>Done</button>
      </div>
    </div>
  );
}
