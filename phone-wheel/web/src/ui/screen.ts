// The phone's screen: full screen + landscape lock (Android only allows the lock while in full screen), keeping the
// screen awake while driving, and vibration.
export const isFullscreen = () => !!document.fullscreenElement;

export async function enterFullscreen() {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* refused */ }
  await lockLandscape();
}
export async function exitFullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* not in full screen */ }
}
export const toggleFullscreen = () => (isFullscreen() ? exitFullscreen() : enterFullscreen());

// true when the screen is now locked sideways
export async function lockLandscape() {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try { if (o?.lock) { await o.lock('landscape'); return true; } } catch { /* needs full screen, or not supported */ }
  return false;
}

let wakeLock: WakeLockSentinel | null = null, wantAwake = false;
export async function keepAwake() {
  wantAwake = true;
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* refused */ }
}
// the lock is dropped whenever the page is hidden: take it again on return
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake && (!wakeLock || wakeLock.released)) keepAwake(); });

let haptics = true;
export const setHaptics = (on: boolean) => { haptics = on; };
export const buzz = (ms: number | number[]) => { if (haptics && navigator.vibrate) navigator.vibrate(ms); };
