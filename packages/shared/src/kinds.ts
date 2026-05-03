/**
 * Per-kind stats for AI-controlled units. Adding a new kind means:
 *   1. Add an entry here.
 *   2. Add a behavior in `server/src/behaviors.ts` (movement + AI).
 *   3. Add a render fn in `client/src/render/units.ts` (visual shape).
 *   4. (Optional) Add new schema fields if the ability needs persistent state
 *      beyond the generic `cooldown` and `shield` slots already on Unit.
 *
 * No code change to the simulation tick or render loop should be required.
 */
export interface UnitKindMeta {
  /** Mineral cost charged to the owner on spawn. Server rejects if unaffordable. */
  cost: number;
  /** Supply slots this unit consumes from its owner's supply cap. Defaults to 1. */
  supplyCost: number;
  maxHp: number;
  /** Initial shield capacity (0 = no shield by default). */
  maxShield: number;
  /** Used for collision and visual sizing. */
  contactRadius: number;
  /** Top speed when chasing a target. */
  attackSpeed: number;
  /** Speed when returning to / maintaining formation. */
  formationSpeed: number;
  /** Distance at which a target is acquired. */
  aggroRadius: number;
  /** Distance at which a held target is released. */
  releaseRadius: number;
  /** Optional ability range, e.g. laser firing distance. Unused by rammer. */
  abilityRange?: number;
  /** Optional ability cooldown in seconds. Unused by rammer. */
  abilityCooldownSeconds?: number;
  /** Damage applied per ability shot. Used by ranged kinds (laser, gunner). */
  abilityDamage?: number;
  /** If set, ability fires a projectile at this speed instead of dealing instant (hitscan) damage. */
  projectileSpeed?: number;
  /** AOE radius applied to enemies on death. Drives chain reactions. */
  explodeRadius?: number;
  /** Damage dealt to each enemy combatant within `explodeRadius` on death. */
  explodeDamage?: number;
  /** Aura radius for a shield-projector kind. */
  shieldRange?: number;
  /** maxShield cap that this shielder raises friendlies up to. */
  shieldGrant?: number;
  /** Shield HP regen per second applied to friendlies in aura range. */
  shieldRegenPerSec?: number;
  /** Asteroid HP drained per second while in mining range. Only set on mining kinds. */
  miningDps?: number;
  /** Search radius for asteroids. Only set on mining kinds. */
  miningRange?: number;
  /** Extra distance beyond (unit + asteroid) radii at which mining still ticks. */
  miningReach?: number;
  /** HP/sec restored to a friendly target while in repair range. Only set on healer kinds. */
  repairHps?: number;
  /** How far this unit can reach a friendly target to heal it. */
  repairRange?: number;
}

export const RAMMER: UnitKindMeta = {
  cost: 3,
  supplyCost: 1,
  maxHp: 30,
  maxShield: 0,
  contactRadius: 9,
  attackSpeed: 400,
  formationSpeed: 600,
  aggroRadius: 220,
  releaseRadius: 280,
  // Rammers carry a payload — going boom is the whole point. Big AOE
  // means a stack of enemies eats catastrophic chain damage.
  explodeRadius: 75,
  explodeDamage: 22,
};

/**
 * Mining drone — ignores enemies, hunts asteroids. Slower and beefier than
 * a rammer (it spends time pressed against asteroids and can't fight back).
 * Mining is applied per tick in `simulation.mineAsteroids`: while a miner is
 * within `miningReach` of its target asteroid, it drains `miningDps * dt` HP.
 * One miner alone can clear a rock; concurrent miners stack linearly.
 */
export const MINER: UnitKindMeta = {
  cost: 5,
  supplyCost: 1,
  maxHp: 50,
  maxShield: 0,
  contactRadius: 10,
  attackSpeed: 320,
  formationSpeed: 500,
  aggroRadius: 600,
  releaseRadius: 900,
  miningDps: 20,
  miningRange: 600,
  miningReach: 6,
  // Industrial fuel tank — small pop, mostly cosmetic.
  explodeRadius: 32,
  explodeDamage: 4,
};

/**
 * Laser drone — expensive glass cannon. Stands off at `abilityRange` and
 * fires a beam every `abilityCooldownSeconds` for `abilityDamage`. Fragile
 * up close (low HP, slow). The fire-event signal is the unit's `cooldown`
 * field jumping from ~0 back to `abilityCooldownSeconds`; the client
 * watches for that rising edge to render the beam visual.
 */
export const LASER: UnitKindMeta = {
  cost: 12,
  supplyCost: 2,
  maxHp: 40,
  maxShield: 0,
  contactRadius: 9,
  attackSpeed: 280,
  formationSpeed: 500,
  // Acquisition radius matches firing range — laser only locks on what it
  // can actually shoot from its formation orbit (it never breaks station).
  aggroRadius: 560,
  releaseRadius: 600,
  abilityRange: 560,
  abilityCooldownSeconds: 1.6,
  abilityDamage: 12,
  // Capacitor blowout — modest pop.
  explodeRadius: 35,
  explodeDamage: 6,
};

/**
 * Gunner — fires real projectiles (with travel time) at the nearest enemy.
 * Trade-off vs the laser: shorter range and slightly lower DPS, but the
 * shots can be juked at long range. Cheaper too.
 */
export const GUNNER: UnitKindMeta = {
  cost: 10,
  supplyCost: 2,
  maxHp: 35,
  maxShield: 0,
  contactRadius: 9,
  attackSpeed: 300,
  formationSpeed: 500,
  aggroRadius: 360,
  releaseRadius: 440,
  abilityRange: 280,
  abilityCooldownSeconds: 0.55,
  abilityDamage: 8,
  projectileSpeed: 700,
  // Ammo cookoff.
  explodeRadius: 40,
  explodeDamage: 8,
};

/**
 * Repair drone — support kind that tethers a continuous heal beam onto the
 * nearest damaged friendly combatant within `repairRange`. No direct combat
 * ability; gets escorted into a fight rather than starting one. Mid-cost
 * because keeping a swarm alive is strong, but fragile (low HP) so it can
 * be picked off if left exposed.
 */
export const REPAIR: UnitKindMeta = {
  cost: 8,
  supplyCost: 1,
  maxHp: 35,
  maxShield: 0,
  contactRadius: 9,
  attackSpeed: 320,
  formationSpeed: 500,
  aggroRadius: 240,
  releaseRadius: 320,
  repairHps: 18,
  repairRange: 200,
  // Medbay quietly fizzles — barely a pop.
  explodeRadius: 28,
  explodeDamage: 3,
};

/**
 * Shielder — defensive support drone that broadcasts a shield aura. Raises
 * the `maxShield` cap on every friendly combatant in range to `shieldGrant`
 * and regenerates their shield up to that cap. Damage flows through shield
 * first (see `applyDamage`), so shielded allies effectively soak the first
 * `shieldGrant` HP of incoming fire — direct counter to ranged kinds.
 *
 * Once raised, `maxShield` stays — your units harden permanently the first
 * time a shielder visits them. The shield value only refills while they're
 * still in aura range.
 */
export const SHIELDER: UnitKindMeta = {
  cost: 9,
  supplyCost: 2,
  maxHp: 45,
  maxShield: 0,
  contactRadius: 9,
  attackSpeed: 320,
  formationSpeed: 500,
  aggroRadius: 0,
  releaseRadius: 0,
  shieldRange: 220,
  shieldGrant: 30,
  shieldRegenPerSec: 12,
  explodeRadius: 30,
  explodeDamage: 4,
};

/**
 * Registry of all known unit kinds. The `kind` string on a Unit is a key
 * into this map. Unknown kinds in inbound state are ignored at sim time
 * and rendered with a fallback shape on the client.
 */
export const UNIT_KIND_META: Record<string, UnitKindMeta> = {
  rammer: RAMMER,
  miner: MINER,
  laser: LASER,
  repair: REPAIR,
  gunner: GUNNER,
  shielder: SHIELDER,
};

/** Type alias of known kind names — extend as kinds are added. */
export type UnitKindName = keyof typeof UNIT_KIND_META;

export function isKnownKind(kind: string): kind is UnitKindName {
  return Object.prototype.hasOwnProperty.call(UNIT_KIND_META, kind);
}
