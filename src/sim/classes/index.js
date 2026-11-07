// The car classes (docs/car-classes-plan.md): one physics, each car type a class of its own numbers. Saved data and
// replays name a class by its id; anything from before car classes is the F1's ('f1').
import { F1_2026 } from './f1-2026.js';
import { FE_GEN3_EVO } from './fe-gen3evo.js';

export const CLASSES = Object.freeze({ [F1_2026.id]: F1_2026, [FE_GEN3_EVO.id]: FE_GEN3_EVO });
export const DEFAULT_CLASS = F1_2026;
// the class with that id, or null (an unknown id: from a newer game, or damaged)
export const classOf = id => Object.hasOwn(CLASSES, id) ? CLASSES[id] : null;
