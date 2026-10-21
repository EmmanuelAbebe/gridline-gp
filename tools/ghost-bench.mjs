// Ghost lap file sizes: one clean lap recorded on every circuit (the fastest AI driver at LEGEND pace, recorded the way
// the game records yours), saved in each format, with encode / decode times and the round-trip error.
// Usage: npm run ghost-bench
import { gzipSync } from 'node:zlib';
import { SIM } from '../src/sim/index.js';
import { createRecorder, ghostFile, packGhost, unpackGhost } from '../src/game/ghost.js';

const kb = n => (n / 1024).toFixed(1).padStart(6) + ' KB';
function lapOn(id) {
  const track = SIM.buildTrack({ ...SIM.CIRCUITS[id], id });
  const r = SIM.createRace({ type: 'unlimited' }, { track, drivers: [SIM.DRIVERS[0]], seed: 3 }), c = r.cars[0], rec = createRecorder();
  rec.start(0);
  for (let s = 0; s < 120 * 400; s++) {
    r.t += 1 / 120; SIM.driveAI(r, c, 1 / 120); rec.sample(c, r.t);
    for (const e of c.events) if (e.type === SIM.EV.LAP) {
      const g = rec.lap(e.time, { circuit: id, modified: false, driver: 'You', date: Date.now(), livery: { color: '#ffc21a', accent: '#111111' } });
      rec.start(c.lapStart);
      if (c.lap > 2 && !e.invalid && g) return g;
    }
    c.events.length = 0;
  }
}

console.log('circuit     lap      old JSON   old gzip    compact    compact+gzip   ratio   pack / unpack ms   pose err   split err');
let tot = [0, 0, 0, 0];
for (const id of Object.keys(SIM.CIRCUITS)) {
  const g = lapOn(id);
  const old = JSON.stringify({ gridlineGhost: 1, ...g }), oldGz = gzipSync(old).length, small = ghostFile(g), bytes = await packGhost(g);
  const t0 = performance.now(); for (let i = 0; i < 20; i++) await packGhost(g); const tp = (performance.now() - t0) / 20;
  const t1 = performance.now(); let back; for (let i = 0; i < 20; i++) back = await unpackGhost(bytes, SIM.CIRCUITS); const tu = (performance.now() - t1) / 20;
  let pe = 0, se = 0;
  back.frames.forEach((v, i) => { pe = Math.max(pe, Math.abs(v - g.frames[i])); });
  back.splits.forEach((v, i) => { se = Math.max(se, Math.abs(v - g.splits[i])); });
  tot = [tot[0] + old.length, tot[1] + oldGz, tot[2] + small.length, tot[3] + bytes.length];
  console.log(`${id.padEnd(10)} ${g.time.toFixed(2).padStart(6)} s ${kb(old.length)}  ${kb(oldGz)}  ${kb(small.length)}   ${kb(bytes.length)}      ${(old.length / bytes.length).toFixed(1).padStart(4)}×   ${tp.toFixed(2).padStart(5)} / ${tu.toFixed(2)}         ${pe.toExponential(0)}      ${(se * 1000).toFixed(2)} ms`);
}
console.log(`${'all five'.padEnd(19)} ${kb(tot[0])}  ${kb(tot[1])}  ${kb(tot[2])}   ${kb(tot[3])}      ${(tot[0] / tot[3]).toFixed(1).padStart(4)}×`);
