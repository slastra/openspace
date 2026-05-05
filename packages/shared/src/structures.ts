import { STRUCTURE_GRID_SNAP } from "./constants.js";

/**
 * Per-kind stats for player-built structures. Mirrors the unit-kind pattern
 * (`UNIT_KIND_META`): adding a new structure kind means dropping an entry
 * here, then teaching the server how to behave (if the structure does
 * anything beyond standing there) and the client how to draw it.
 */
export interface StructureKindMeta {
  /** Mineral cost charged on placement. */
  cost: number;
  /** Starting HP. Damage flows through the standard `applyDamage` path. */
  hp: number;
  /** Square footprint half-extent. Doubles as collision ball radius (server
   *  uses `addStructureBody(radius=halfExtent)` so client predictor agrees). */
  halfExtent: number;
  /** Supply slots this structure contributes to its owner's cap. */
  supplyContribution: number;
  /** Firing range in world units (combat structures only). */
  abilityRange?: number;
  /** Damage per shot (combat structures only). */
  abilityDamage?: number;
  /** Cooldown between shots in seconds (combat structures only). */
  abilityCooldownSeconds?: number;
  /** Physics collider shape. Defaults to "ball" — existing structures keep
   *  their circular hitbox. "cuboid" gives a full square footprint, which
   *  is what walls need so adjacent placements form a continuous barrier
   *  (ball colliders on the 100u grid leave diagonal gaps a unit can slip
   *  through). */
  colliderShape?: "ball" | "cuboid";
  /** Per-player placement cap for this kind. Omitted = no per-kind limit
   *  (only the global MAX_STRUCTURES_PER_PLAYER applies). Used by strategic
   *  structures that should remain singular (e.g. the base — there's
   *  exactly one home, multiples would let one player dominate too much
   *  map via the claim radius and make spawn-at-base ambiguous). */
  maxPerPlayer?: number;
  /** HP/sec restored to every friendly Combatant in `healRange`. Only set
   *  on healing structures (e.g. medbay). Stacks with repair-drone heals
   *  on the same target up to maxHp. */
  healHps?: number;
  /** Aura radius (world units) over which `healHps` is applied. */
  healRange?: number;
}

export const SUPPLY: StructureKindMeta = {
  cost: 12,
  hp: 80,
  halfExtent: 35,
  supplyContribution: 5,
};

/**
 * Turret — stationary defensive structure. Acquires the nearest enemy
 * combatant within `abilityRange` and pumps a hitscan laser on cooldown.
 * Same beam visual as the LASER unit; rotates its barrel to face the target.
 *
 * 96 DPS now (24 dmg × 4 shots/sec). Comfortably handles 4–5 gunners on
 * its own and remains the anchor of a wall-ringed defensive position.
 */
export const TURRET: StructureKindMeta = {
  cost: 18,
  hp: 80,
  halfExtent: 28,
  supplyContribution: 0,
  abilityRange: 440,
  abilityDamage: 24,
  abilityCooldownSeconds: 0.25,
};

/**
 * Wall — pure defensive obstacle. No firing, no supply, no shield projection
 * of its own (the existing SHIELDER unit auto-buffs it like any other
 * Combatant). Cuboid collider fully fills its 100u grid cell so adjacent
 * walls touch face-to-face and form a continuous barrier. Tough enough
 * to take ~13 rammer pops to break a single section, so a wall ring is
 * a real investment of enemy effort to crack.
 */
export const WALL: StructureKindMeta = {
  cost: 6,
  hp: 280,
  halfExtent: 50,
  supplyContribution: 0,
  colliderShape: "cuboid",
};

/**
 * Base — every player's home command structure. Three roles:
 *  1. Production gate. Without a live owned base, the player cannot spawn
 *     any units. Unit costs only apply on top of having a base.
 *  2. Spawn anchor. Units spawn at the base; the player respawns there on
 *     death (with a small jitter) so the base is your literal home.
 *  3. Territorial claim — enemies can't place any new structure within
 *     `BASE_CLAIM_RADIUS_U` of your base.
 *
 * Free + capped to 1 per player. The cost isn't credits, it's the
 * placement decision: where you drop your base defines your home and
 * everything else (walls, turrets, supplies) clusters around it.
 */
export const BASE: StructureKindMeta = {
  cost: 0,
  hp: 100,
  halfExtent: 32,
  supplyContribution: 0,
  maxPerPlayer: 1,
};

/**
 * Medbay — passive healing aura. Restores `healHps` per second to every
 * friendly Combatant (units, ships, AND structures including walls)
 * within `healRange`, capped at each target's maxHp. Per-target rate is
 * fixed; total throughput scales with how many things in the aura need
 * healing. Two per player, so a sprawling base can be covered by two
 * overlapping zones.
 *
 * Doesn't outpace dedicated DPS (96 turret DPS vs 25 heal/sec is a
 * losing trade on any single target) but meaningfully sustains a wall
 * ring and a unit swarm together — enough that throwing a few rammers
 * at a defended base no longer chips through unchallenged.
 */
export const MEDBAY: StructureKindMeta = {
  cost: 16,
  hp: 80,
  halfExtent: 30,
  supplyContribution: 0,
  maxPerPlayer: 2,
  healHps: 25,
  healRange: 320,
};

export const STRUCTURE_KIND_META: Record<string, StructureKindMeta> = {
  base: BASE,
  supply: SUPPLY,
  turret: TURRET,
  wall: WALL,
  medbay: MEDBAY,
};

export type StructureKindName = keyof typeof STRUCTURE_KIND_META;

export function isKnownStructureKind(kind: string): kind is StructureKindName {
  return Object.prototype.hasOwnProperty.call(STRUCTURE_KIND_META, kind);
}

/** Snap an arbitrary world coordinate onto the structure-placement grid. */
export function snapToGrid(v: number): number {
  return Math.round(v / STRUCTURE_GRID_SNAP) * STRUCTURE_GRID_SNAP;
}

/** Maximum fraction of cost refunded when recycling a structure at full HP.
 *  Scales linearly down to 0% at 0 HP. */
export const STRUCTURE_RECYCLE_MAX_REFUND = 0.75;

/** Credits returned when recycling a structure of `kind` at the given HP
 *  fraction (hp / maxHp). Floored to keep the schema integral. */
export function structureRecycleRefund(cost: number, hpFraction: number): number {
  const f = hpFraction < 0 ? 0 : hpFraction > 1 ? 1 : hpFraction;
  return Math.floor(cost * STRUCTURE_RECYCLE_MAX_REFUND * f);
}
