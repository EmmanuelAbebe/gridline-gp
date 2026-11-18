// The phone-wheel app: scan the QR code Gridline GP shows (Settings → Controller) with the phone's back camera. jsQR reads
// each frame; the link in it (https://<address>:<port>/?t=<token>&w=<app port>&i=<PC id>) → a PC (pairing.ts parseQr).
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseQr, type Pc } from '../engine/pairing.ts';
import './PcPicker.css';

export function QrScan({ found, cancel }: { found: (pc: Pc) => void; cancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const onFound = useRef(found); onFound.current = found;      // (the camera starts once, whatever re-renders the picker)
  useEffect(() => {
    let stream: MediaStream | null = null, frame = 0, done = false;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scan = () => {
      const v = video.current;
      if (done || !v || !ctx) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));     // small frames: quick enough every frame
        canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (qr?.data) {
          const pc = parseQr(qr.data);
          if (pc) { done = true; onFound.current(pc); return; }
          setErr('That QR code isn\'t Gridline GP\'s phone link.');
        }
      }
      frame = requestAnimationFrame(scan);
    };
    const camera = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }) : Promise.reject(new Error('no camera'));
    camera.then((s) => {
        stream = s;
        if (done) { s.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
        frame = requestAnimationFrame(scan);
      })
      .catch(() => setErr('No camera: allow phone-wheel to use the camera (Android Settings → Apps → phone-wheel → Permissions), or type the address instead.'));
    return () => { done = true; cancelAnimationFrame(frame); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="overlay pcs scan">
      <video ref={video} playsInline muted />
      <div className="scan-bar">
        <span>Point the camera at the QR code in Gridline GP's Settings → Controller.</span>
        <button onClick={cancel}>Cancel</button>
      </div>
      {err && <div className="warn">{err}</div>}
    </div>
  );
}
