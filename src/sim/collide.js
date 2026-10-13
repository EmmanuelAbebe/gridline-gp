// Car-to-car contact.
import { TUNING, EV } from './tuning.js';
import { progress } from './race.js';
import { afterMove } from './motion.js';

// Push overlapping cars apart; scrub speed only when contact is mostly nose-to-tail.
// EV.CONTACT fires once when a car starts touching another, with `impact` = closing speed (m/s).
export function collide(race) {
  const cars = race.cars, R = TUNING.CAR_RADIUS;
  for (const c of cars) { c.wasTouching = c.touching; c.touching = false; }
  for (let i = 0; i < cars.length; i++) for (let j = i+1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    let dx = b.x - a.x, dz = b.z - a.z; const d2 = dx*dx + dz*dz;
    if (d2 > R*R || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), push = (R - d) / 2; dx /= d; dz /= d;
    const closing = Math.max(0, (a.v*Math.cos(a.h) - b.v*Math.cos(b.h)) * dx + (a.v*Math.sin(a.h) - b.v*Math.sin(b.h)) * dz);
    for (const c of [a, b]) { if (!c.wasTouching && !c.touching) { c.impact = closing; c.events.push(EV.CONTACT); } c.touching = true; }
    a.x -= dx*push; a.z -= dz*push; b.x += dx*push; b.z += dz*push;
    const [rear, front] = progress(race, a) < progress(race, b) ? [a, b] : [b, a];
    const along = Math.abs(dx*Math.cos(front.h) + dz*Math.sin(front.h));
    if (along > 0.6 && rear.v > front.v) { const avg = (rear.v + front.v)/2; rear.v = avg*0.97; front.v = Math.max(front.v, avg*0.99); }
    afterMove(race, a); afterMove(race, b);
  }
}
