/**
 * Formation layout: a sunflower (golden-angle) annulus around the anchor.
 *
 * Slot i sits at radius `sqrt(R0² + i·A/π)` and angle `i·φ` (φ = the golden
 * angle), so every slot owns the same area A = SLOT_SPACING² and the disc
 * has uniform density at any size. Slot i depends only on i, never on the
 * swarm size: adding a unit appends one slot at the rim and nothing else
 * moves. The whole disc rotates rigidly by `angle`, so slots never cross.
 *
 * Which unit takes which slot is the server's job (server/src/formation.ts).
 */

/** Inner radius of the disc: clear space around the anchor's hull. */
export const FORMATION_INNER_RADIUS = 150;
/** Spacing between neighboring slots; each slot owns SPACING² of area. */
export const FORMATION_SLOT_SPACING = 45;

const SLOT_AREA = FORMATION_SLOT_SPACING * FORMATION_SLOT_SPACING;
const INNER_R2 = FORMATION_INNER_RADIUS * FORMATION_INNER_RADIUS;
/** π(3 − √5): the angle that never lines successive slots up into spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Offset of slot `index` from the anchor, with the disc rotated by `angle`. */
export function formationSlotOffset(index: number, angle: number = 0): { x: number; y: number } {
  const r = formationRadius(index);
  const theta = index * GOLDEN_ANGLE + angle;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

/** Radius of slot `index`; equivalently, the rim radius of an `index`-slot disc. */
export function formationRadius(index: number): number {
  return Math.sqrt(INNER_R2 + (Math.max(0, index) * SLOT_AREA) / Math.PI);
}
