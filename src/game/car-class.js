// The car class the player races (car classes: docs/car-classes-plan.md). The menus, the garage, records, ghosts,
// sector bests and the leaderboard's boards ask playerClass(); a race in progress asks the race (race.carClass) or the
// car (c.spec.cls). main.js sets it from the garage (garage-store.js garageClass: the saved `carClass`) and when you pick
// a car (race weekend's CAR step, the time trial page, the garage's Car tab).
import { SIM } from '../sim/index.js';

// a class by its id (saved data); an unknown or missing one = the default
export const classById = id => SIM.classOf(id) ?? SIM.DEFAULT_CLASS;
let current = SIM.DEFAULT_CLASS;
export const playerClass = () => current;
export const setPlayerClass = cls => { current = cls; };

// The classes as the menus show them (2026-11-08, the user's picks C + D on the class-picker canvas). Invented names (no
// real series): `icon` = a 40 × 20 plan view; `facts` = the rows the stats can't give, in words; `ranked` from the class.
export const CLASS_UI = {
  f1: { name: 'GP HYBRID', tag: 'Hybrid single-seater · 2026 rules', icon: 'M2 7L2 13M6 10L30 10M30 6L34 10L30 14M37 3L37 17M8 4L14 4M8 16L14 16M24 4L30 4M24 16L30 16',
    blurb: 'Big downforce, straight mode and overtake, three slick compounds, fuel and pit stops.',
    facts: { power: '750 kW (V6 + 350 kW electric)', tyres: 'Soft · medium · hard slicks, on blankets', energy: 'Fuel, and a battery charged each lap',
      straights: 'Straight mode, overtake boost', pits: 'Tyres, fuel, wing, repairs', pace: 'The reference' } },
  fe: { name: 'GP ELECTRIC', tag: 'Electric single-seater', icon: 'M4 7L4 13M6 10Q16 6 30 9L36 10L30 11Q16 14 6 10M8 4L14 4M8 16L14 16M25 3L31 3M25 17L31 17',
    blurb: 'One battery for the race, the motors brake the rear, attack mode twice with all-wheel drive, all-weather tyres from cold.',
    facts: { power: '300 kW · 350 in attack mode', tyres: 'One all-weather tyre, from cold', energy: 'One battery for the whole race',
      straights: 'Attack mode × 2 through a zone', pits: 'Drive-throughs only (no stops needed)', pace: '20–28 % slower a lap' } },
};
export const classUi = cls => CLASS_UI[cls.id] ?? { name: cls.name.toUpperCase(), tag: '', icon: '', blurb: '', facts: {} };
export const allClasses = () => Object.values(SIM.CLASSES);

// the comparison rows (race weekend's CAR step): [label, value] per class; numbers from the stock car (SIM specStats,
// made once per class: ~10 ms)
const statsOf = new Map();
export function classRows(cls) {
  const s = statsOf.get(cls) || statsOf.set(cls, SIM.specStats(SIM.stockOf(cls))).get(cls), F = classUi(cls).facts, n = (v, d = 0) => v === null ? '–' : v.toFixed(d);
  return [['Power', F.power], ['Top speed', `${n(s.top)} km/h`], ['0–100 km/h', `${n(s.t100, 1)} s${cls.attack ? ' (AWD start)' : ''}`],
    ['Corner, 80 m radius', `${n(s.corner[80])} km/h`], ['Braking to 100 km/h', `${n(s.brake.dist)} m from ${n(s.brake.from)} km/h`],
    ['Weight', `${cls.car.mass} kg`], ['Tyres', F.tyres], ['Energy', F.energy], ['On the straights', F.straights], ['Pit stops', F.pits],
    ['Lap time', F.pace], ['Leaderboard', cls.ranked === false ? 'Not ranked yet' : 'Ranked']];
}
