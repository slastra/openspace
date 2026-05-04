import {
  ArenaState,
  Combatant,
  Player,
  SlotInfo,
  UNIT_KIND_META,
  Unit,
  UnitKindMeta,
  stationTarget,
  teamOf,
} from "@openspace/shared";
import {
  TickGrids,
  gridNearestAsteroid,
  gridNearestEnemy,
  gridNearestFriendlyDamaged,
} from "./spatial.js";

export type { SlotInfo };

/**
 * Strategy interface for one unit kind. Behaviors return a desired velocity
 * (the simulation writes it into the body via `setLinvel`) — the physics
 * solver handles collision/separation.
 *
 * `slot` lets formation-style kinds give each unit its own target position
 * around the owner, so units aren't all chasing the same point.
 */
export interface KindBehavior {
  acquireTarget(
    unit: Unit,
    state: ArenaState,
    meta: UnitKindMeta,
    grids: TickGrids,
  ): Combatant | null;
  desiredVelocity(
    unit: Unit,
    target: Combatant | null,
    owner: Player | null,
    meta: UnitKindMeta,
    slot: SlotInfo,
    timeSeconds: number,
  ): { vx: number; vy: number };
}

/** Sticky nearest-enemy targeting — most attack kinds reuse this. */
export function defaultAcquireTarget(
  unit: Unit,
  state: ArenaState,
  meta: UnitKindMeta,
  grids: TickGrids,
): Combatant | null {
  if (unit.targetId) {
    const t = state.players.get(unit.targetId) ?? state.units.get(unit.targetId);
    if (t && t.hp > 0 && Math.hypot(t.x - unit.x, t.y - unit.y) <= meta.releaseRadius) {
      return t;
    }
  }
  return gridNearestEnemy(grids.combatants, teamOf(unit), unit.x, unit.y, meta.aggroRadius);
}

/**
 * Rammer: charge enemies at full speed; otherwise settle into the unit's
 * assigned station on the formation ring. Slot angles are evenly spaced
 * and the ring radius scales with the swarm size, so each unit has its
 * own target point and they never compete for the same spot.
 */
const RAMMER: KindBehavior = {
  acquireTarget: defaultAcquireTarget,
  desiredVelocity(unit, target, owner, meta, slot, timeSeconds) {
    if (target) {
      return chaseAtSpeed(unit.x, unit.y, target.x, target.y, meta.attackSpeed);
    }
    if (owner) {
      const station = stationTarget(owner.x, owner.y, slot, meta.contactRadius, timeSeconds);
      return arriveAtStation(
        unit.x,
        unit.y,
        station.x,
        station.y,
        meta.formationSpeed,
      );
    }
    return { vx: 0, vy: 0 };
  },
};

/** Drive flat-out toward the point. Used for chase — overshoot is fine when ramming a moving target. */
function chaseAtSpeed(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  speed: number,
): { vx: number; vy: number } {
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { vx: 0, vy: 0 };
  const inv = 1 / dist;
  return { vx: dx * inv * speed, vy: dy * inv * speed };
}

/**
 * Arrival steering: full speed at distance, linear taper through the
 * "arrival zone" so the unit decelerates into its station and settles
 * instead of overshooting and oscillating. STOP_RANGE is a small dead-band
 * so floating-point jitter doesn't keep the body twitching forever.
 *
 * ARRIVAL_RANGE must exceed `formationSpeed * TICK_DT` (max travel per tick)
 * or units will still overshoot before the taper kicks in.
 */
const ARRIVAL_RANGE = 50;
// Bumped from 2 → 5: with the orbital formation moving the station ~15 u/s
// on the inner ring, the wider deadband stops idle units from twitching
// every tick as the station nudges in and out of a tight 2-unit window.
const STOP_RANGE = 5;

export function arriveAtStation(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  speed: number,
): { vx: number; vy: number } {
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.hypot(dx, dy);
  if (dist < STOP_RANGE) return { vx: 0, vy: 0 };
  const scale =
    dist >= ARRIVAL_RANGE
      ? 1
      : (dist - STOP_RANGE) / (ARRIVAL_RANGE - STOP_RANGE);
  const inv = 1 / dist;
  return { vx: dx * inv * speed * scale, vy: dy * inv * speed * scale };
}

/**
 * Laser — pure defensive turret. Never leaves the formation orbit; just
 * zaps any enemy that strays into ability range. Acquisition still uses
 * `defaultAcquireTarget` so `runUnitAbilities` knows what to fire at, but
 * movement is always toward the assigned station.
 */
const LASER_DEFENSIVE: KindBehavior = {
  acquireTarget: defaultAcquireTarget,
  desiredVelocity(unit, _target, owner, meta, slot, timeSeconds) {
    if (!owner) return { vx: 0, vy: 0 };
    const station = stationTarget(owner.x, owner.y, slot, meta.contactRadius, timeSeconds);
    return arriveAtStation(unit.x, unit.y, station.x, station.y, meta.formationSpeed);
  },
};

/**
 * Kite-and-shoot — used by the gunner. Stands off at ~75% of firing range,
 * strafes perpendicular when in the sweet band, closes if too far, backs
 * off if too close. Falls back to formation when no target is in range.
 *
 * Damage is applied by `runUnitAbilities` in simulation.ts (not here);
 * this behavior is purely positioning.
 */
const KITE_RANGED: KindBehavior = {
  acquireTarget: defaultAcquireTarget,
  desiredVelocity(unit, target, owner, meta, slot, timeSeconds) {
    if (target) {
      const range = meta.abilityRange ?? meta.aggroRadius;
      const dx = unit.x - target.x;
      const dy = unit.y - target.y;
      const dist = Math.hypot(dx, dy) || 1;
      const inv = 1 / dist;
      // Stand-off band centered at 75% of firing range so even the outer
      // edge of the strafe band (~88% of range) stays comfortably inside
      // the fire check.
      const kiteCenter = range * 0.75;
      const sweetMin = kiteCenter * 0.85;
      const sweetMax = kiteCenter * 1.15;
      if (dist < sweetMin) {
        return { vx: dx * inv * meta.attackSpeed, vy: dy * inv * meta.attackSpeed };
      }
      if (dist > sweetMax) {
        return { vx: -dx * inv * meta.attackSpeed, vy: -dy * inv * meta.attackSpeed };
      }
      const strafe = meta.attackSpeed * 0.4;
      return { vx: -dy * inv * strafe, vy: dx * inv * strafe };
    }
    if (owner) {
      const station = stationTarget(owner.x, owner.y, slot, meta.contactRadius, timeSeconds);
      return arriveAtStation(unit.x, unit.y, station.x, station.y, meta.formationSpeed);
    }
    return { vx: 0, vy: 0 };
  },
};

/**
 * Repair — locks onto the nearest damaged friendly within `repairRange` and
 * tethers a heal beam onto them. Movement: closes if too far, drifts to a
 * trailing position behind the patient if in range. Falls back to formation
 * orbit when nothing needs healing.
 *
 * The actual HP restore is applied per-tick by `runRepairs` in simulation.ts;
 * this behavior just handles target selection and positioning.
 */
const REPAIR_BEHAVIOR: KindBehavior = {
  acquireTarget(unit, state, meta, grids) {
    const range = meta.repairRange ?? 200;
    if (unit.targetId) {
      const held =
        state.players.get(unit.targetId) ?? state.units.get(unit.targetId);
      if (
        held &&
        held.hp > 0 &&
        held.hp < held.maxHp &&
        teamOf(held) === teamOf(unit) &&
        Math.hypot(held.x - unit.x, held.y - unit.y) <= range * 1.2
      ) {
        return held;
      }
    }
    return gridNearestFriendlyDamaged(
      grids.combatants,
      teamOf(unit),
      unit.id,
      unit.x,
      unit.y,
      range,
    );
  },
  desiredVelocity(unit, target, owner, meta, slot, timeSeconds) {
    if (target) {
      const range = meta.repairRange ?? 200;
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Hold at ~70% of range — close enough to heal reliably, far enough
      // to stay out of the brawl.
      const preferred = range * 0.7;
      if (dist > preferred * 1.1) {
        const inv = 1 / dist;
        return { vx: dx * inv * meta.attackSpeed, vy: dy * inv * meta.attackSpeed };
      }
      if (dist < preferred * 0.7) {
        const inv = 1 / dist;
        return { vx: -dx * inv * meta.attackSpeed * 0.5, vy: -dy * inv * meta.attackSpeed * 0.5 };
      }
      return { vx: 0, vy: 0 };
    }
    if (owner) {
      const station = stationTarget(owner.x, owner.y, slot, meta.contactRadius, timeSeconds);
      return arriveAtStation(unit.x, unit.y, station.x, station.y, meta.formationSpeed);
    }
    return { vx: 0, vy: 0 };
  },
};

/**
 * Miner — ignores enemies; flies to the nearest live asteroid and presses
 * against it (Rapier's solver re-issues contact-begin events while the body
 * is held against the static rock, so damage is applied per re-contact in
 * resolveCollisions). When no asteroids are in range, drifts to its formation
 * station like a rammer at rest.
 *
 * Targets are stored on `unit.targetId` so the debug overlay can draw a line
 * to the rock being mined; the actual damage application lives in
 * simulation.ts (it's gated on collider contact, not target identity).
 */
const MINER: KindBehavior = {
  acquireTarget(unit, state, meta, grids) {
    const range = meta.miningRange ?? meta.aggroRadius;
    if (unit.targetId) {
      const held = state.asteroids.get(unit.targetId);
      if (held && held.hp > 0 && Math.hypot(held.x - unit.x, held.y - unit.y) <= range) {
        // Adapt to the Combatant return shape — the simulator only reads .id
        // off the result to assign targetId. nearestAsteroid + Asteroid both
        // have `id`, so reuse the same channel without widening the union.
        return held as unknown as Combatant;
      }
    }
    const found = gridNearestAsteroid(grids.asteroids, unit.x, unit.y, range);
    return (found as unknown as Combatant) ?? null;
  },
  desiredVelocity(unit, target, owner, meta, slot, timeSeconds) {
    if (target) {
      // Press the rock at full speed — the impact wears the miner down via
      // velocity-scaled asteroid contact damage in `resolveCollisions`,
      // which fits the brute-force mining fantasy.
      return chaseAtSpeed(unit.x, unit.y, target.x, target.y, meta.attackSpeed);
    }
    if (owner) {
      const station = stationTarget(owner.x, owner.y, slot, meta.contactRadius, timeSeconds);
      return arriveAtStation(
        unit.x,
        unit.y,
        station.x,
        station.y,
        meta.formationSpeed,
      );
    }
    return { vx: 0, vy: 0 };
  },
};

/**
 * To add a new kind:
 *   1. Add an entry to UNIT_KIND_META in shared/kinds.ts
 *   2. Add a behavior here (often just spread defaultAcquireTarget and a
 *      kind-specific desiredVelocity)
 *   3. Add a render fn in client/src/render/units.ts
 */
// Shielders share the laser's pure-formation behavior — they hold station
// and let `runShieldAuras` (in simulation.ts) project the aura per tick.
export const kindBehaviors: Record<string, KindBehavior> = {
  rammer: RAMMER,
  miner: MINER,
  laser: LASER_DEFENSIVE,
  repair: REPAIR_BEHAVIOR,
  gunner: KITE_RANGED,
  shielder: LASER_DEFENSIVE,
};

/** Resolve behavior + meta together. Returns null if the kind is unknown. */
export function lookupKind(
  kind: string,
): { behavior: KindBehavior; meta: UnitKindMeta } | null {
  const behavior = kindBehaviors[kind];
  const meta = UNIT_KIND_META[kind];
  if (!behavior || !meta) return null;
  return { behavior, meta };
}
