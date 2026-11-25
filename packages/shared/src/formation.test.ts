import { describe, expect, it } from "vitest";
import {
  FORMATION_INNER_RADIUS,
  FORMATION_SLOT_SPACING,
  formationRadius,
  formationSlotOffset,
} from "./formation.js";
import { MAX_UNITS_PER_PLAYER } from "./constants.js";

describe("formation layout", () => {
  const slots = Array.from({ length: MAX_UNITS_PER_PLAYER }, (_, i) => formationSlotOffset(i));

  it("keeps every pair of slots at least ~one spacing apart", () => {
    let min = Infinity;
    for (let i = 0; i < slots.length; i++) {
      for (let j = 0; j < i; j++) {
        min = Math.min(min, Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.y - slots[j]!.y));
      }
    }
    expect(min).toBeGreaterThanOrEqual(0.9 * FORMATION_SLOT_SPACING);
  });

  it("keeps every slot clear of the anchor's inner radius", () => {
    for (const s of slots) {
      expect(Math.hypot(s.x, s.y)).toBeGreaterThanOrEqual(FORMATION_INNER_RADIUS - 1e-9);
    }
  });

  it("grows outward monotonically, one slot at the rim at a time", () => {
    for (let i = 1; i < slots.length; i++) {
      expect(formationRadius(i)).toBeGreaterThan(formationRadius(i - 1));
    }
  });

  it("rotates rigidly with the angle", () => {
    const a = formationSlotOffset(17, 0);
    const b = formationSlotOffset(17, Math.PI / 2);
    expect(b.x).toBeCloseTo(-a.y, 9);
    expect(b.y).toBeCloseTo(a.x, 9);
  });
});
