import { BUTTONS, buttonsOf, CAR_NAMES, KEYBOARD_KEYS, MAP_BUTTON, MAX_BUTTONS, type ButtonCfg, type ButtonId } from '../../settings/settings.ts';
import type { TabProps } from './Settings.tsx';

// (the car you drive: each car has its own list, settings.ts buttonsOf; cfg is already that car's)
export function ButtonsTab({ cfg, update, car = 'hybrid' }: TabProps) {
  const list = cfg.buttons, mine = (c: Parameters<Parameters<typeof update>[0]>[0]) => buttonsOf(c, car);
  const edit = (i: number, patch: Partial<ButtonCfg>) => update((c) => { const b = mine(c); b[i] = { ...b[i], ...patch }; });
  const remove = (i: number) => update((c) => { mine(c).splice(i, 1); });
  const add = () => update((c) => {
    const bs = mine(c), used = new Set(bs.map((b) => b.bind)), free = BUTTONS.find(([id]) => !used.has(id)) ?? BUTTONS[0];
    const pits = bs.filter((b) => b.side === 'pit').length;
    bs.push({ label: String(bs.length + 1), bind: free[0], toggle: false, side: pits <= bs.length - pits ? 'pit' : 'race' });
  });
  const addMap = () => update((c) => { mine(c).push({ ...MAP_BUTTON }); });
  return <>
    <h2>Buttons · {CAR_NAMES[car]}</h2>
    {car !== 'hybrid' && <p className="note">These are the buttons for the {CAR_NAMES[car]}: the game told the phone you drive it. Each car keeps its own
      buttons and your own layout for it.{car === 'electric' ? ' View (ATK) arms attack mode: it shows the activations left, ARMED, then its time.' : ''}</p>}
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
    {car === 'hybrid' && list.length < MAX_BUTTONS && !list.some((b) => b.bind === 'GUIDE') && <button onClick={addMap}>+ MAP button (ECU map)</button>}
  </>;
}
