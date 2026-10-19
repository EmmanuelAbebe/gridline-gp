// The simulation's main object types, for the type check (tsconfig.json, `npm run typecheck`). No runtime code.
// Each type is whatever its factory returns, so declaring a field there is what makes it exist: a field written
// anywhere else, or a misspelt one, is a type error.
/** @typedef {ReturnType<typeof import('./car.js').createCar>} Car */
/** @typedef {ReturnType<typeof import('./race.js').createRace>} Race */
/** @typedef {ReturnType<typeof import('./track.js').buildTrack>} Track */
export {};
