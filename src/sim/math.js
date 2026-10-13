export const wrapA = a => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
