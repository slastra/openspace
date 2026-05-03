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
 */
export const TURRET: StructureKindMeta = {
  cost: 18,
  hp: 60,
  halfExtent: 28,
  supplyContribution: 0,
  abilityRange: 380,
  abilityDamage: 10,
  abilityCooldownSeconds: 0.6,
};

export const STRUCTURE_KIND_META: Record<string, StructureKindMeta> = {
  supply: SUPPLY,
  turret: TURRET,
};

export type StructureKindName = keyof typeof STRUCTURE_KIND_META;

export function isKnownStructureKind(kind: string): kind is StructureKindName {
  return Object.prototype.hasOwnProperty.call(STRUCTURE_KIND_META, kind);
}

/** Snap an arbitrary world coordinate onto the structure-placement grid. */
export function snapToGrid(v: number): number {
  return Math.round(v / STRUCTURE_GRID_SNAP) * STRUCTURE_GRID_SNAP;
}
