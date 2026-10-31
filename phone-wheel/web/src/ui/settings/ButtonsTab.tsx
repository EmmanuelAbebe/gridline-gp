import { BUTTONS, KEYBOARD_KEYS, MAP_BUTTON, MAX_BUTTONS, type ButtonCfg, type ButtonId } from '../../settings/settings.ts';
import type { TabProps } from './Settings.tsx';

export function ButtonsTab({ cfg, update }: TabProps) {
  const list = cfg.buttons;
  const edit = (i: number, patch: Partial<ButtonCfg>) => update((c) => { c.buttons[i] = { ...c.buttons[i], ...patch }; });
  const remove = (i: number) => update((c) => { c.buttons.splice(i, 1); });
  const add = () => update((c) => {
    const used = new Set(c.buttons.map((b) => b.bind)), free = BUTTONS.find(([id]) => !used.has(id)) ?? BUTTONS[0];
    const pits = c.buttons.filter((b) => b.side === 'pit').length;
    c.buttons.push({ label: String(c.buttons.length + 1), bind: free[0], toggle: false, side: pits <= c.buttons.length - pits ? 'pit' : 'race' });
  });
  const addMap = () => update((c) => { c.buttons.push({ ...MAP_BUTTON }); });
  return <>
    <h2>Buttons</h2>
    <p className="note">Each on-screen button presses a controller button and sits on the PIT side (left of the screen) or the RACE side
      (right). In Gridline GP: X boxes, D-pad down is your pit limiter and D-pad up straight mode (both when set to BUTTON in the game's
      Settings → Driving), RS looks back, View is overtake mode, Guide (MAP) steps round the ECU maps; A / B shift down / up, Y changes
      camera. The game's Settings → Buttons can change any of them. In keyboard mode (server.py) A…RS press the keys {KEYBOARD_KEYS.split('').join(' ')}.</p>
    {list.map((b, i) => (
      <div className="btnrow" key={i}>
        <input className="text" maxLength={4} value={b.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label="Label" />
        <select value={b.bind} onChange={(e) => edit(i, { bind: e.target.value as ButtonId })}>
          {BUTTONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button className={`switch ${b.toggle ? 'on' : ''}`} onClick={() => edit(i, { toggle: !b.toggle })}>{b.toggle ? 'Toggle' : 'Hold'}</button>
        <button className="switch" onClick={() => edit(i, { side: b.side === 'pit' ? 'race' : 'pit' })} title="Which side of the screen it sits on">{b.side === 'pit' ? 'PIT ◧' : 'RACE ◨'}</button>
        <button className="danger" onClick={() => remove(i)} aria-label="Remove">✕</button>
      </div>
    ))}
    {list.length < MAX_BUTTONS && <button onClick={add}>+ Add button</button>}
    {list.length < MAX_BUTTONS && !list.some((b) => b.bind === 'GUIDE') && <button onClick={addMap}>+ MAP button (ECU map)</button>}
  </>;
}
