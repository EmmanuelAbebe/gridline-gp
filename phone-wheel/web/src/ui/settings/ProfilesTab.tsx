// Profiles: switch, save the current settings as a new one, reset, and share as text (export / import).
import { useState } from 'react';
import { clone, DEFAULTS, sanitize, type Store } from '../../settings/settings.ts';
import { Field } from './controls.tsx';

export function ProfilesTab({ store, setStore }: { store: Store; setStore: React.Dispatch<React.SetStateAction<Store>> }) {
  const [name, setName] = useState(''), [io, setIo] = useState(''), [msg, setMsg] = useState(''), [confirmReset, setConfirmReset] = useState(false);
  const names = Object.keys(store.profiles);
  const change = (fn: (s: Store) => void) => setStore((s) => { const next = clone(s); fn(next); return next; });
  const unique = (base: string) => { let n = base, i = 2; while (store.profiles[n]) n = `${base} ${i++}`; return n; };

  const saveAs = () => {
    const n = unique(name.trim() || 'Profile');
    change((s) => { s.profiles[n] = clone(s.profiles[s.active]); s.active = n; });
    setName(''); setMsg(`Saved as "${n}".`);
  };
  const remove = (n: string) => change((s) => { delete s.profiles[n]; if (s.active === n) s.active = Object.keys(s.profiles)[0]; });
  const reset = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    change((s) => { s.profiles[s.active] = sanitize(clone(DEFAULTS)); });
    setConfirmReset(false); setMsg('Profile reset to defaults.');
  };
  const exportJson = async () => {
    const text = JSON.stringify({ name: store.active, settings: store.profiles[store.active] });
    setIo(text);
    try { await navigator.clipboard.writeText(text); setMsg('Copied to clipboard.'); } catch { setMsg('Copy the text below.'); }
  };
  const importJson = () => {
    try {
      const data = JSON.parse(io);
      const n = unique(typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported');
      change((s) => { s.profiles[n] = sanitize(data.settings || data); s.active = n; });
      setMsg(`Imported as "${n}".`);
    } catch { setMsg("That text isn't a valid profile."); }
  };

  return <>
    <h2>Profiles</h2>
    <div className="profiles">
      {names.map((n) => (
        <div key={n} className={`profile ${n === store.active ? 'on' : ''}`}>
          <button className="pick" onClick={() => change((s) => { s.active = n; })}>{n === store.active ? '● ' : ''}{n}</button>
          {names.length > 1 && <button className="danger" onClick={() => remove(n)} aria-label={`Delete ${n}`}>✕</button>}
        </div>
      ))}
    </div>
    <Field label="Save as new" hint="copy the current settings into a new profile">
      <input className="text" placeholder="Name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={saveAs}>Save</button>
    </Field>
    <Field label="Reset" hint={`put "${store.active}" back to defaults`}>
      <button className={confirmReset ? 'danger' : ''} onClick={reset}>{confirmReset ? 'Tap again to reset' : 'Reset'}</button>
    </Field>
    <Field label="Share" hint="export to text, or paste text and import">
      <div className="seg"><button onClick={exportJson}>Export</button><button onClick={importJson}>Import</button></div>
    </Field>
    <textarea className="text io" placeholder="Profile text appears here, or paste one to import" value={io} onChange={(e) => setIo(e.target.value)} />
    {msg && <p className="note">{msg}</p>}
  </>;
}
