/**
 * Convert a CSS-style hex string ("#4ade80" or "4ade80") to a Pixi numeric color.
 * Returns 0xffffff on parse failure.
 */
export function parseHexColor(hex: string): number {
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  return parseInt(cleaned, 16) || 0xffffff;
}

/** Mix `color` toward white by `amount` ∈ [0,1]. */
export function lighten(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return (lr << 16) | (lg << 8) | lb;
}
