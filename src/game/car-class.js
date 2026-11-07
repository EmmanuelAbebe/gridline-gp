// The car class the player races (car classes: docs/car-classes-plan.md). The menus, the garage and the race setup's
// notes ask playerClass(); a race in progress asks the race (race.carClass) or the car (c.spec.cls). One class for now,
// the 2026 F1 (its models: car.glb, or the classic car); a class picker comes with the second class.
import { SIM } from '../sim/index.js';

// a class by its id (saved data); an unknown or missing one = the default
export const classById = id => SIM.classOf(id) ?? SIM.DEFAULT_CLASS;
export const playerClass = () => SIM.DEFAULT_CLASS;
