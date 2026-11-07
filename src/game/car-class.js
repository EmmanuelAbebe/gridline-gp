// The car class the player races (car classes: docs/car-classes-plan.md). The menus, the garage, records, ghosts,
// sector bests and the leaderboard's boards ask playerClass(); a race in progress asks the race (race.carClass) or the
// car (c.spec.cls). main.js sets it from the garage (garage-store.js garageClass: the saved `carClass`). One class for
// now, the 2026 F1 (its models: car.glb, or the classic car); a class picker comes with the second class.
import { SIM } from '../sim/index.js';

// a class by its id (saved data); an unknown or missing one = the default
export const classById = id => SIM.classOf(id) ?? SIM.DEFAULT_CLASS;
let current = SIM.DEFAULT_CLASS;
export const playerClass = () => current;
export const setPlayerClass = cls => { current = cls; };
