// The website's circuit maps (public/tracks.json): every circuit's centre line (every 4th track sample, to 0.1 m), its
// length, and where the three sectors start (index into the points). `npm run tracks` in leaderboard/ after a circuit
// changes (tests/leaderboard.test.js checks it is current).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIM } from '../src/sim/index.js';

export const STEP = 4;
export function tracksJson() {
  const out = {};
  for (const [id, c] of Object.entries(SIM.CIRCUITS)) {
    const T = SIM.buildTrack(c), L = SIM.buildSectors(T), pts = [];
    for (let i = 0; i < T.N; i += STEP) pts.push(Math.round(T.PX[i] * 10) / 10, Math.round(T.PZ[i] * 10) / 10);
    out[id] = { name: c.name, length: Math.round(T.N * T.ds), ds: T.ds, step: STEP, points: pts, sectors: L.sectors.map(s => Math.floor(s.from / STEP)) };
  }
  return JSON.stringify({ physics: SIM.TUNING.PHYSICS, circuits: out });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(new URL('./public/tracks.json', import.meta.url), tracksJson());
  console.log('public/tracks.json');
}
