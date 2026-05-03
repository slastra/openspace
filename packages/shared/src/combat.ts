import { PLAYER_CONTACT_RADIUS } from "./constants.js";
import { UNIT_KIND_META } from "./kinds.js";
import { isKnownStructureKind } from "./structures.js";
import type { ArenaState, Asteroid, Player, Structure, Unit } from "./schema.js";

/**
 * Anything in the world that has a position and HP. The simulation iterates
 * Combatants for collision and target acquisition without caring whether each
 * is a Player (human-controlled), a Unit (AI-controlled), or a Structure
 * (player-built static).
 */
export type Combatant = Player | Unit | Structure;

/** Reserved `kind` value identifying a Player. Distinct from any unit kind. */
export const PLAYER_KIND = "player";

export function isPlayer(c: Combatant): c is Player {
  return c.kind === PLAYER_KIND;
}

export function isStructure(c: Combatant): c is Structure {
  return isKnownStructureKind(c.kind);
}

/**
 * Positive type guard for AI Units (excludes Players AND Structures). Used
 * by attribution paths that should only credit player-controlled targets.
 */
export function isUnit(c: Combatant): c is Unit {
  return !isPlayer(c) && !isStructure(c);
}

/**
 * Orphan units (their owner died, awaiting wreckage claim) are inert —
 * they don't fight back, don't get targeted by enemies, and shouldn't take
 * stray projectile / AOE damage. Effectively floating loot until claimed.
 */
export function isNeutral(c: Combatant): boolean {
  return isUnit(c) && c.wreckageId !== "";
}

/** All Combatants are tagged with a "team" — same team = friendly. */
export function teamOf(c: Combatant): string {
  return isPlayer(c) ? c.id : (c as Unit | Structure).ownerId;
}

export function contactRadiusOf(c: Combatant): number {
  if (isPlayer(c)) return PLAYER_CONTACT_RADIUS;
  if (isStructure(c)) return c.contactRadius;
  return UNIT_KIND_META[c.kind]?.contactRadius ?? 9;
}

/**
 * Apply damage to a combatant. Shield drains first; remaining damage hits HP.
 * Mutates `c`. Returns the amount actually absorbed (always equals `amount`
 * if positive, since HP is allowed to go below 0).
 */
export function applyDamage(c: Combatant, amount: number): number {
  if (amount <= 0) return 0;
  let remaining = amount;
  if (c.shield > 0) {
    const absorbed = Math.min(c.shield, remaining);
    c.shield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    c.hp = Math.max(0, c.hp - remaining);
  }
  return amount;
}

/**
 * Iterate every combatant in the world (players, AI units, structures).
 * Generator-style — every caller is `for ... of`, so we never allocate the
 * intermediate array. Hot path: called several times per server tick.
 */
export function* allCombatants(state: ArenaState): Generator<Combatant> {
  for (const p of state.players.values()) yield p;
  for (const u of state.units.values()) yield u;
  for (const s of state.structures.values()) yield s;
}

export function lookupCombatant(state: ArenaState, id: string): Combatant | null {
  return (
    state.players.get(id) ??
    state.units.get(id) ??
    state.structures.get(id) ??
    null
  );
}

/**
 * Find the nearest live asteroid within `radius` of (x, y). Used by miner
 * AI for target acquisition. Returns null if the field is empty within range.
 */
export function nearestAsteroid(
  state: ArenaState,
  x: number,
  y: number,
  radius: number,
): Asteroid | null {
  let best: Asteroid | null = null;
  let bestDist = radius;
  for (const a of state.asteroids.values()) {
    if (a.hp <= 0) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

/**
 * Find the nearest friendly combatant with hp < maxHp within `radius` of
 * (x, y). Used by repair drones for target acquisition. Skips the seeker
 * itself by id so a healer can't lock onto its own (full or partial) HP.
 */
export function nearestFriendlyDamaged(
  state: ArenaState,
  team: string,
  selfId: string,
  x: number,
  y: number,
  radius: number,
): Combatant | null {
  let best: Combatant | null = null;
  let bestDist = radius;
  for (const c of allCombatants(state)) {
    if (c.hp <= 0) continue;
    if (c.hp >= c.maxHp) continue;
    if (teamOf(c) !== team) continue;
    if (c.id === selfId) continue;
    if (isNeutral(c)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Find the nearest enemy combatant within `radius` of (x, y). Returns null
 * if nothing in range. Callers pass the seeker's `team` so they're skipped.
 */
export function nearestEnemy(
  state: ArenaState,
  team: string,
  x: number,
  y: number,
  radius: number,
): Combatant | null {
  let best: Combatant | null = null;
  let bestDist = radius;
  for (const c of allCombatants(state)) {
    if (c.hp <= 0 || teamOf(c) === team) continue;
    if (isNeutral(c)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
