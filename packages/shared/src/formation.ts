import { WORLD_HEIGHT, WORLD_WIDTH } from "./constants.js";
import { clamp } from "./math.js";

/**
 * A unit's place in its owner's swarm. `index` is the unit's slot among
 * peers (sorted stably by id); `total` is the count including itself.
 */
export interface SlotInfo {
  index: number;
  total: number;
}

/** Radius of the innermost (ring 0) formation ring. Sized to leave a clear
 *  gap around the player ship so owned units don't crowd the hull and
 *  trigger collision damage on every nudge. */
const STATION_BASE_RADIUS = 150;
/** Distance between consecutive rings. Tuned so each ring is clearly distinct. */
const STATION_RING_SPACING = 32;
/** Arc length (in world units) reserved per slot — sets minimum ring density.
 *  Must exceed the boid separation radius (currently `contactRadius * 3.5`
 *  in simulation.applySeparation) by a comfortable margin, otherwise slot
 *  positions sit inside each other's repulsion zone and the orbit fights
 *  itself. 5× contactRadius leaves ~1.5× margin over the boid radius. */
const STATION_ARC_PER_SLOT_FACTOR = 5;
/** Hard floor on slots per ring so a half-empty inner ring still spreads out. */
const STATION_MIN_SLOTS_PER_RING = 6;
/** Inner ring angular velocity in radians/sec (~17°/sec — subtle, not dizzying). */
const STATION_ORBIT_OMEGA = 0.3;
/** Outer rings slow down by this factor per ring step (Kepler-ish feel). */
const STATION_ORBIT_FALLOFF = 0.55;

/**
 * Stable per-slot polar offset around the owner. Slots are packed onto
 * concentric rings: ring 0 is the innermost halo, with new rings added
 * outward as the swarm grows. Each ring's slot count scales with its
 * circumference so adjacent stations stay roughly `contactRadius * 4`
 * apart regardless of which ring they're on. Alternating rings are
 * rotated by half a slot so units don't visually line up radially, and
 * spin slowly in opposite directions (inner faster) for a subtle orbit.
 *
 * `timeSeconds` drives the orbit; pass 0 for a static formation.
 */
export function stationOffset(
  slot: SlotInfo,
  contactRadius: number,
  timeSeconds: number = 0,
): { x: number; y: number } {
  const arcPerSlot = contactRadius * STATION_ARC_PER_SLOT_FACTOR;
  const idx = Math.max(0, slot.index);

  let ringIndex = 0;
  let consumed = 0;
  let ringRadius = STATION_BASE_RADIUS;
  let ringCapacity = ringSlotCount(ringRadius, arcPerSlot);
  while (idx >= consumed + ringCapacity) {
    consumed += ringCapacity;
    ringIndex++;
    ringRadius = STATION_BASE_RADIUS + ringIndex * STATION_RING_SPACING;
    ringCapacity = ringSlotCount(ringRadius, arcPerSlot);
  }

  const slotInRing = idx - consumed;
  // Half-slot rotation on every other ring keeps units from forming radial spokes.
  const phase = ringIndex % 2 === 0 ? 0 : 0.5;
  // Inner rings spin faster; alternating rings spin opposite directions.
  const omega =
    STATION_ORBIT_OMEGA *
    Math.pow(STATION_ORBIT_FALLOFF, ringIndex) *
    (ringIndex % 2 === 0 ? 1 : -1);
  const baseAngle = ((slotInRing + phase) / ringCapacity) * Math.PI * 2;
  const angle = baseAngle + omega * timeSeconds;
  return { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
}

function ringSlotCount(radius: number, arcPerSlot: number): number {
  const fromCircumference = Math.floor((2 * Math.PI * radius) / arcPerSlot);
  return Math.max(STATION_MIN_SLOTS_PER_RING, fromCircumference);
}

/**
 * The world-space position the unit *wants* to occupy. Same logic on server
 * and client so the visual halo agrees with authoritative positions.
 *
 * Clamped to a safe inset from world bounds so units near the edge don't
 * try to drive their target into a wall and pin themselves there (where
 * border damage would chew through them).
 */
export function stationTarget(
  ownerX: number,
  ownerY: number,
  slot: SlotInfo,
  contactRadius: number,
  timeSeconds: number = 0,
): { x: number; y: number } {
  const off = stationOffset(slot, contactRadius, timeSeconds);
  const margin = contactRadius + 14;
  return {
    x: clamp(ownerX + off.x, margin, WORLD_WIDTH - margin),
    y: clamp(ownerY + off.y, margin, WORLD_HEIGHT - margin),
  };
}

