import {
  ArenaState,
  Asteroid,
  Combatant,
  UNIT_KIND_META,
  Unit,
  UnitKindMeta,
  isNeutral,
  lookupCombatant,
  teamOf,
} from "@openspace/shared";
import {
  TickGrids,
  gridNearestAsteroid,
  gridNearestEnemy,
  gridNearestFriendlyDamaged,
} from "./spatial.js";

export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * Strategy interface for one unit kind. A behavior only describes combat:
 * which target to pick and how to move while engaging it. Holding formation
 * is the default the simulation applies whenever `engage` returns null
 * (see server/src/formation.ts), so kinds never re-implement it.
 */
export interface KindBehavior {
  acquireTarget(
    unit: Unit,
    state: ArenaState,
    meta: UnitKindMeta,
    grids: TickGrids,
  ): Combatant | null;
  /** Velocity while engaging `target`, or null to hold formation. */
  engage(unit: Unit, target: Combatant | null, meta: UnitKindMeta): Velocity | null;
}

/**
 * Owner-designated focus target (combatant). When set, attack-kind
 * `acquireTarget` returns this directly — bypassing release/aggro radii
 * — so a click order pulls the swarm across the map. Returns null when
 * unset, dead, neutral (orphaned wreckage), or on the same team as the
 * unit (defense against self-team focus snuck through validation).
 */
function focusTargetFor(unit: Unit, state: ArenaState): Combatant | null {
  const owner = state.players.get(unit.ownerId);
  if (!owner || !owner.focusTargetId) return null;
  const t = lookupCombatant(state, owner.focusTargetId);
  if (!t || t.hp <= 0 || isNeutral(t)) return null;
  if (teamOf(t) === teamOf(unit)) return null;
  return t;
}

/**
 * Owner-designated focus asteroid (miners only). Same idea as
 * `focusTargetFor` but resolves into the asteroid map instead of the
 * combatant union.
 */
function focusAsteroidFor(unit: Unit, state: ArenaState): Asteroid | null {
  const owner = state.players.get(unit.ownerId);
  if (!owner || !owner.focusTargetId) return null;
  const a = state.asteroids.get(owner.focusTargetId);
  return a && a.hp > 0 ? a : null;
}

/** Sticky nearest-enemy targeting — most attack kinds reuse this. */
export function defaultAcquireTarget(
  unit: Unit,
  state: ArenaState,
  meta: UnitKindMeta,
  grids: TickGrids,
): Combatant | null {
  // Player click-order: explicit focus beats auto-acquire and ignores
  // aggro/release radii. Falls through to sticky-nearest when the
  // owner has no focus or the focus is invalid for this unit's team.
  const focus = focusTargetFor(unit, state);
  if (focus) return focus;

  if (unit.targetId) {
    const t = state.players.get(unit.targetId) ?? state.units.get(unit.targetId);
    // isNeutral guard: when the held target was a unit whose owner died,
    // it becomes a wreckage orphan (neutral). Projectiles pass through
    // neutrals (see stepProjectiles), so without this the shooter would
    // sit there firing at a ghost forever — recall fixed it manually by
    // clearing targetId and forcing re-acquire through the grid (which
    // already excludes neutrals).
    if (
      t &&
      t.hp > 0 &&
      !isNeutral(t) &&
      Math.hypot(t.x - unit.x, t.y - unit.y) <= meta.releaseRadius
    ) {
      return t;
    }
  }
  return gridNearestEnemy(grids.combatants, teamOf(unit), unit.x, unit.y, meta.aggroRadius);
}

/** Rammer: charge enemies at full speed; otherwise hold formation. */
const RAMMER: KindBehavior = {
  acquireTarget: defaultAcquireTarget,
  engage(unit, target, meta) {
    return target ? chaseAtSpeed(unit.x, unit.y, target.x, target.y, meta.attackSpeed) : null;
  },
};

/** Drive flat-out toward the point. Used for chase — overshoot is fine when ramming a moving target. */
function chaseAtSpeed(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  speed: number,
): Velocity {
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { vx: 0, vy: 0 };
  const inv = 1 / dist;
  return { vx: dx * inv * speed, vy: dy * inv * speed };
}

/**
 * Laser — pure defensive turret. Never leaves formation; just zaps any
 * enemy that strays into ability range. Acquisition still uses
 * `defaultAcquireTarget` so `runUnitAbilities` knows what to fire at.
 */
const LASER_DEFENSIVE: KindBehavior = {
  acquireTarget: defaultAcquireTarget,
  engage() {
    return null;
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
  engage(unit, target, meta) {
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
    return null;
  },
};

/**
 * Repair — locks onto the nearest damaged friendly within `repairRange` and
 * tethers a heal beam onto them. Movement: closes if too far, drifts to a
 * trailing position behind the patient if in range. Holds formation when
 * nothing needs healing.
 *
 * The actual HP restore is applied per-tick by `runRepairs` in simulation.ts;
 * this behavior just handles target selection and positioning.
 */
const REPAIR_BEHAVIOR: KindBehavior = {
  acquireTarget(unit, state, meta, grids) {
    const range = meta.repairRange ?? 200;
    if (unit.targetId) {
      // Walks players + units + structures so a damaged friendly wall /
      // supply / base survives the sticky check (otherwise the drone
      // re-acquired every tick and runRepairs failed the same lookup).
      const held = lookupCombatant(state, unit.targetId);
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
  engage(unit, target, meta) {
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
    return null;
  },
};

/**
 * Miner — ignores enemies; flies to the nearest live asteroid and presses
 * against it (Rapier's solver re-issues contact-begin events while the body
 * is held against the static rock, so damage is applied per re-contact in
 * resolveCollisions). When no asteroids are in range, holds formation like
 * a rammer at rest.
 *
 * Targets are stored on `unit.targetId` so the debug overlay can draw a line
 * to the rock being mined; the actual damage application lives in
 * simulation.ts (it's gated on collider contact, not target identity).
 */
const MINER: KindBehavior = {
  acquireTarget(unit, state, meta, grids) {
    const range = meta.miningRange ?? meta.aggroRadius;
    // Player click-order: explicit focus on an asteroid beats nearest-
    // rock pick, with no range cap so miners pursue a far-edge target.
    const focus = focusAsteroidFor(unit, state);
    if (focus) return focus as unknown as Combatant;
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
  engage(unit, target, meta) {
    // Press the rock at full speed — the impact wears the miner down via
    // velocity-scaled asteroid contact damage in `resolveCollisions`,
    // which fits the brute-force mining fantasy.
    return target ? chaseAtSpeed(unit.x, unit.y, target.x, target.y, meta.attackSpeed) : null;
  },
};

/**
 * To add a new kind:
 *   1. Add an entry to UNIT_KIND_META in shared/kinds.ts
 *   2. Add a behavior here (usually defaultAcquireTarget plus an `engage`
 *      that returns null whenever the unit should hold formation)
 *   3. Add a render fn in client/src/render/units.ts
 */
// Shielders share the laser's pure-formation behavior — they hold formation
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
