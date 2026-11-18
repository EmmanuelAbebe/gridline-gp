// The phone-wheel app (phone-wheel/app: this page inside an Android app, Capacitor) vs a browser tab. Inside the app the
// page talks to its own native plugin (phone-wheel/app/android/.../PhoneWheelPlugin.java) for what a WebView can't do:
// vibration patterns and the PC's UDP beacon. In a browser everything here falls back to the web APIs (or nothing).
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { BEACON_PORT } from './pairing.ts';

interface PhoneWheelPlugin {
  vibrate(o: { pattern: number[] }): Promise<void>;
  startBeacon(o: { port: number }): Promise<void>;
  stopBeacon(): Promise<void>;
  addListener(e: 'beacon', fn: (ev: { data: string; ip: string }) => void): Promise<PluginListenerHandle>;
}
const plugin = registerPlugin<PhoneWheelPlugin>('PhoneWheel');

// true inside the app (the WebView), false in a browser and in Node (the tests)
export const isApp = () => Capacitor.isNativePlatform();

// navigator.vibrate's arguments: ms or [on, off, on, ...]; 0 / [] stops the motor
export function vibrate(p: number | number[]) {
  const pattern = Array.isArray(p) ? p : p > 0 ? [p] : [];
  if (isApp()) { plugin.vibrate({ pattern }).catch(() => { /* no motor */ }); return; }
  try { navigator.vibrate?.(pattern.length ? pattern : 0); } catch { /* not allowed yet */ }
}

// the PC's beacon (desktop/phone-beacon.cjs): every packet heard → fn(its text, the sender's address); returns stop()
export function listenForPcs(fn: (data: string, ip: string) => void): () => void {
  if (!isApp()) return () => {};
  let handle: PluginListenerHandle | null = null, stopped = false;
  plugin.addListener('beacon', (ev) => fn(ev.data, ev.ip)).then((h) => { if (stopped) h.remove(); else handle = h; });
  plugin.startBeacon({ port: BEACON_PORT }).catch(() => { /* port busy: typed addresses and the QR still work */ });
  return () => { stopped = true; handle?.remove(); plugin.stopBeacon().catch(() => {}); };
}
