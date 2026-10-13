// Display-only gearbox: picks a gear and rev fraction from speed (the sim has no drivetrain).
export const GEAR_TOP_SPEEDS = [0, 15, 25, 35, 45, 55, 65, 76, 92.5];
export function gearOf(v) {
  if (v < 0.3) return { gear: v < -0.3 ? 'R' : 'N', rpm: 0.15 };
  let g = 1; while (g < GEAR_TOP_SPEEDS.length - 1 && v > GEAR_TOP_SPEEDS[g]) g++;
  const lo = GEAR_TOP_SPEEDS[g-1], hi = GEAR_TOP_SPEEDS[g], f = (v - lo) / (hi - lo);
  return { gear: String(g), rpm: g === 1 ? 0.2 + 0.8*f : 0.55 + 0.45*f };
}
