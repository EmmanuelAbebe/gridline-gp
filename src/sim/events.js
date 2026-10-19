// Things that happen to a car during a step: { type: EV.*, ...details } objects pushed into car.events, so each one
// carries what the game needs to show it (impact speed, damaged part, pit service...). The game drains the queue.
/** @typedef {import('./types.js').Car} Car */
/** @param {Car} c */
export const emit = (c, type, details) => { c.events.push(details ? { type, ...details } : { type }); };
