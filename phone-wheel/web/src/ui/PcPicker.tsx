// The phone-wheel app: which PC to drive (engine/pairing.ts). The PCs running Gridline GP's phone link on this network
// (their beacon), the ones paired before, a typed address, or the game's QR code. A PC paired before connects at once;
// a new one asks for the pairing code from the game's Settings → Controller.
import { useEffect, useState } from 'react';
import { RiQrScan2Line } from 'react-icons/ri';
import { choosePc, codeLooksRight, currentPc, forgetPc, normalizeCode, onPcs, pairedPcs, parseAddress, seenPcs, type Pc } from '../engine/pairing.ts';
import { QrScan } from './QrScan.tsx';
import './PcPicker.css';

type Asking = { id: string; name: string; host: string; wsPort: number } | null;

export function PcPicker({ note, picked, close }: { note?: string; picked: () => void; close?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const off = onPcs(() => tick((n) => n + 1)); const t = setInterval(() => tick((n) => n + 1), 1000); return () => { off(); clearInterval(t); }; }, []);
  const [asking, setAsking] = useState<Asking>(null);
  const [code, setCode] = useState('');
  const [typing, setTyping] = useState(false);
  const [address, setAddress] = useState('');
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');

  const seen = seenPcs(), paired = pairedPcs(), now = currentPc();
  const pairedById = new Map(paired.map((p) => [p.id, p]));
  const use = (pc: Pc) => { choosePc(pc); setErr(''); picked(); };
  function pick(p: { id: string; name: string; host: string; wsPort: number }) {
    const known = pairedById.get(p.id);
    if (known && !(note && now?.id === p.id)) use({ ...known, host: p.host, wsPort: p.wsPort, name: p.name });   // (refused: ask again)
    else { setAsking(p); setCode(''); setErr(''); }
  }
  function submitCode() {
    const c = normalizeCode(code);
    if (!asking || !codeLooksRight(c)) { setErr('The code is 8 letters and digits, as Settings → Controller shows it on the PC (ABCD-EFGH).'); return; }
    use({ ...asking, code: c });
  }
  function submitAddress() {
    const a = parseAddress(address);
    if (!a) { setErr('That isn\'t an address: type the PC\'s IP address, as 192.168.1.20 (its port after a colon if not 8444).'); return; }
    setTyping(false);
    const known = paired.find((p) => p.host === a.host && p.wsPort === a.wsPort);
    setAsking(known ?? { id: `addr-${a.host.replace(/[^\w-]/g, '-')}`, name: a.host, ...a });
    setCode(''); setErr('');
  }

  if (scanning) return <QrScan cancel={() => setScanning(false)} found={(pc) => { setScanning(false); use(pc); }} />;
  const offline = paired.filter((p) => !seen.some((s) => s.id === p.id));
  return (
    <div className="overlay pcs">
      <h1>{asking ? asking.name : 'Pick your PC'}</h1>
      {note && <div className="warn">{note}</div>}
      {asking ? <>
        <p>Enter the pairing code from Gridline GP on that PC: Settings → Controller → Connect phone.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); submitCode(); }}>
          <input className="code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={64} aria-label="Pairing code" />
          <button className="primary big" type="submit">CONNECT</button>
        </form>
        <div className="row">
          <button onClick={() => { setAsking(null); setErr(''); }}>Back</button>
          <button onClick={() => setScanning(true)}><RiQrScan2Line /> Scan its QR code instead</button>
        </div>
      </> : typing ? <>
        <p>The PC's address on this network (Settings → Controller shows it under the QR code).</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); submitAddress(); }}>
          <input className="code" autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20"
            inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={120} aria-label="PC address" />
          <button className="primary big" type="submit">NEXT</button>
        </form>
        <div className="row"><button onClick={() => { setTyping(false); setErr(''); }}>Back</button></div>
      </> : <>
        <p>On the PC: Gridline GP → Settings → Controller → Connect phone (Wi-Fi). Phone and PC on the same network.</p>
        <ul className="pc-list">
          {seen.map((p) => (
            <li key={p.id}><button className={now?.id === p.id ? 'on' : ''} onClick={() => pick(p)}>
              <b>{p.name}</b><span>{p.host}</span>{pairedById.has(p.id) && <em>PAIRED</em>}</button></li>
          ))}
          {!seen.length && <li className="searching">Looking for Gridline GP on this network…</li>}
          {offline.map((p) => (
            <li key={p.id} className="offline"><button onClick={() => use(p)}><b>{p.name}</b><span>{p.host} · not heard</span><em>PAIRED</em></button>
              <button className="forget" onClick={() => forgetPc(p.id)} aria-label={`Forget ${p.name}`}>✕</button></li>
          ))}
        </ul>
        <div className="row">
          <button onClick={() => setScanning(true)}><RiQrScan2Line /> Scan the QR code</button>
          <button onClick={() => { setTyping(true); setErr(''); }}>Type the address</button>
          {close && <button className="primary" onClick={close}>Done</button>}
        </div>
      </>}
      {err && <div className="warn">{err}</div>}
    </div>
  );
}
