// Close passes: a car going past the player within a few metres to the side, at a real speed difference (either
// one overtaking, or the player stopped or slow). Gives one event per pass, at the moment the cars are level:
// { side: -1 left / +1 right, strength 0..1 } (closer and faster = stronger). Feeds the whoosh and the camera shake.
import { SOUND } from './audio/audio-config.js';
import { poseOf } from './pose.js';

export function createProximity() {
  const last = new Map();   // car code → its position along the player's heading last frame
  return {
    update(race, player) {
      const P = SOUND.passBy, events = [], me = poseOf(player), fx = Math.cos(me.h), fz = Math.sin(me.h);
      const pvx = fx * player.v, pvz = fz * player.v;
      for (const c of race.cars) {
        if (c === player) continue;
        const p = poseOf(c), dx = p.x - me.x, dz = p.z - me.z, along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;   // lat + = right
        const prev = last.get(c.code); last.set(c.code, along);
        if (prev === undefined || Math.sign(prev) === Math.sign(along) || Math.abs(along - prev) > 20) continue;
        const rel = Math.hypot(Math.cos(p.h) * c.v - pvx, Math.sin(p.h) * c.v - pvz);
        if (Math.abs(lat) > P.maxLat || rel < P.minRel) continue;
        const near = Math.min(1, Math.max(0, 1 - (Math.abs(lat) - 2.2) / (P.maxLat - 2.2)));
        events.push({ side: Math.sign(lat) || 1, strength: Math.min(1, rel / 45) * (0.35 + 0.65 * near) });
      }
      return events;
    },
    reset() { last.clear(); },
  };
}
