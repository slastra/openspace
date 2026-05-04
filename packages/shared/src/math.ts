/** Clamp `v` to the inclusive range [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp `v` to [0, 1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear interpolate `a → b` by `t` ∈ [0,1] (no clamping). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Linear interpolate between two angles taking the shortest arc, so an
 * interpolation across the ±π wrap doesn't spin the long way around.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Shortest signed angular delta from `from` → `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  const TAU = Math.PI * 2;
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}
