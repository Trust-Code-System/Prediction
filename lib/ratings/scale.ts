/**
 * Shared normalisation math for the ratings layer. Kept in one place so team and
 * player ratings use the same scale, and so the absolute 0-100 bounds are easy to
 * audit and tune. Pure, no imports, safe on the server or the client.
 */

export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Linear map of `value` from the range [min, max] onto 0-100, clamped at both
 * ends. `min` maps to 0 and `max` maps to 100. Guards a zero-width range.
 */
export function scale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}
