import { MapSchema, Schema, defineTypes } from "@colyseus/schema";

// We avoid class-field initializers and set values in the constructor
// instead, so the prototype getter/setters that `defineTypes()` installs
// aren't shadowed by [[Define]]-style class fields under esbuild/tsx.
export class Player extends Schema {
  declare id: string;
  /** Display name — captured at join, sanitized server-side, defaults to "Player <N>". */
  declare name: string;
  /** Always "player" — explicit discriminator that distinguishes Player from Unit. */
  declare kind: string;
  declare x: number;
  declare y: number;
  declare rotation: number;
  declare color: string;
  declare hp: number;
  declare maxHp: number;
  /** Defensive layer in front of HP. Damage drains shield first. */
  declare shield: number;
  declare maxShield: number;
  /** Increments on every respawn — clients watch this to fire death+spawn FX. */
  declare deathCount: number;
  declare lastProcessedInputSeq: number;
  /** Resource counter — accrued by mining asteroids with owned miner units. */
  declare credits: number;
  /** Max supply this player can field. Increases with built supply structures. */
  declare supplyCap: number;
  /** Supply currently consumed by living owned units. Decrements on unit death. */
  declare supplyUsed: number;
  /** True while the player is holding the dash key. Held = 2× speed but
   *  every owned unit takes DASH_FLEET_BURN_DPS HP/sec from the engine wash. */
  declare dashing: boolean;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.kind = "player";
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.color = "#ffffff";
    this.hp = 0;
    this.maxHp = 0;
    this.shield = 0;
    this.maxShield = 0;
    this.deathCount = 0;
    this.lastProcessedInputSeq = 0;
    this.credits = 0;
    this.supplyCap = 0;
    this.supplyUsed = 0;
    this.dashing = false;
  }
}

defineTypes(Player, {
  id: "string",
  name: "string",
  kind: "string",
  x: "number",
  y: "number",
  rotation: "number",
  color: "string",
  hp: "number",
  maxHp: "number",
  shield: "number",
  maxShield: "number",
  deathCount: "uint32",
  lastProcessedInputSeq: "uint32",
  credits: "uint32",
  supplyCap: "uint16",
  supplyUsed: "uint16",
  dashing: "boolean",
});

/**
 * AI-controlled minion. Behavior, stats, and visuals are dispatched on
 * `kind` (see UNIT_KIND_META, kindBehaviors, createUnitView). Generic
 * `cooldown` is a free-form timer each kind interprets for its own ability
 * (e.g. laser refire, heal pulse). `shield` is a universal defensive layer
 * applied before HP for any kind a shielder can target.
 */
export class Unit extends Schema {
  declare id: string;
  declare ownerId: string;
  declare color: string;
  /** Discriminator — see UNIT_KIND_META in shared/kinds.ts. */
  declare kind: string;
  declare x: number;
  declare y: number;
  /** Facing angle in radians; derived from target (if any) or velocity. */
  declare rotation: number;
  declare hp: number;
  declare maxHp: number;
  declare shield: number;
  declare maxShield: number;
  declare cooldown: number;
  /** Empty when in formation; entity id (unit or player) when chasing/targeting. */
  declare targetId: string;
  /** Stable per-owner slot index assigned on spawn. Drives formation position
   *  via `stationOffset`; doesn't compress when peers die, so survivors don't
   *  reshuffle to new stations. */
  declare slotIndex: number;
  /** Set when this unit is orphaned by its owner's death — it orbits the
   *  named wreckage instead of chasing/mining/etc. Cleared when claimed. */
  declare wreckageId: string;
  /** Set when the owner has insufficient supply cap to support this unit
   *  (computed per-tick from slotIndex priority). Same inert-orbit behavior
   *  as orphans, just anchored to the owner ship. Clears once supply recovers. */
  declare deactivated: boolean;

  constructor() {
    super();
    this.id = "";
    this.ownerId = "";
    this.color = "#ffffff";
    this.kind = "";
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.shield = 0;
    this.maxShield = 0;
    this.cooldown = 0;
    this.targetId = "";
    this.slotIndex = 0;
    this.wreckageId = "";
    this.deactivated = false;
  }
}

defineTypes(Unit, {
  id: "string",
  ownerId: "string",
  color: "string",
  kind: "string",
  x: "number",
  y: "number",
  rotation: "number",
  hp: "number",
  maxHp: "number",
  shield: "number",
  maxShield: "number",
  cooldown: "number",
  targetId: "string",
  slotIndex: "uint8",
  wreckageId: "string",
  deactivated: "boolean",
});

/**
 * Mineable static rock. Not a Combatant — has its own hp track and damage
 * path (only miner-vs-asteroid contacts deal damage). `lastHitBy` records
 * the ownerId of the most recent miner so credits go to the right player
 * when the asteroid is destroyed.
 */
export class Asteroid extends Schema {
  declare id: string;
  declare x: number;
  declare y: number;
  declare radius: number;
  declare hp: number;
  declare maxHp: number;
  declare resourceValue: number;
  declare lastHitBy: string;

  constructor() {
    super();
    this.id = "";
    this.x = 0;
    this.y = 0;
    this.radius = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.resourceValue = 0;
    this.lastHitBy = "";
  }
}

defineTypes(Asteroid, {
  id: "string",
  x: "number",
  y: "number",
  radius: "number",
  hp: "number",
  maxHp: "number",
  resourceValue: "uint32",
  lastHitBy: "string",
});

/**
 * Server-stepped projectile fired by a gunner-class unit. Travels along
 * (vx, vy) until it overlaps a non-friendly Combatant, leaves the world,
 * or hits its `expiresAt`. `team` is the firing unit's owner id — used
 * for friendly-fire skip in collision checks.
 */
export class Projectile extends Schema {
  declare id: string;
  declare ownerId: string;
  declare team: string;
  declare color: string;
  declare x: number;
  declare y: number;
  declare vx: number;
  declare vy: number;
  declare damage: number;
  declare expiresAt: number;

  constructor() {
    super();
    this.id = "";
    this.ownerId = "";
    this.team = "";
    this.color = "#ffffff";
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.damage = 0;
    this.expiresAt = 0;
  }
}

defineTypes(Projectile, {
  id: "string",
  ownerId: "string",
  team: "string",
  color: "string",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  damage: "number",
  expiresAt: "number",
});

/**
 * Static player-built structure. Grid-snapped, has a fixed cuboid collider
 * (so anyone can bump and rammers can damage it via velocity-impact).
 * Satisfies the Combatant shape so every existing damage / heal / shield
 * path applies uniformly — laser drones can target it, repair drones can
 * mend it, shielders can buff it. `kind` is the structure type ("supply"
 * for now); future kinds (turret, refinery, ...) reuse the same shape.
 */
export class Structure extends Schema {
  declare id: string;
  declare ownerId: string;
  declare kind: string;
  declare color: string;
  declare x: number;
  declare y: number;
  declare hp: number;
  declare maxHp: number;
  declare shield: number;
  declare maxShield: number;
  /** Used by `contactRadiusOf` for projectile hit checks. */
  declare contactRadius: number;
  /** Combat structures only: barrel facing in radians, derived from current target. */
  declare rotation: number;
  /** Combat structures only: countdown to next shot. */
  declare cooldown: number;
  /** Combat structures only: id of currently-acquired target (empty if none). */
  declare targetId: string;

  constructor() {
    super();
    this.id = "";
    this.ownerId = "";
    this.kind = "";
    this.color = "#ffffff";
    this.x = 0;
    this.y = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.shield = 0;
    this.maxShield = 0;
    this.contactRadius = 0;
    this.rotation = 0;
    this.cooldown = 0;
    this.targetId = "";
  }
}

defineTypes(Structure, {
  id: "string",
  ownerId: "string",
  kind: "string",
  color: "string",
  x: "number",
  y: "number",
  hp: "number",
  maxHp: "number",
  shield: "number",
  maxShield: "number",
  contactRadius: "number",
  rotation: "number",
  cooldown: "number",
  targetId: "string",
});

/**
 * A dead player's loot drop. Holds the credits they had at death and any
 * units they owned (orphan units carry `wreckageId` pointing here, orbit
 * the wreckage in formation, and can be picked off by enemies). First live
 * player to touch it claims everything and the wreckage despawns.
 */
export class Wreckage extends Schema {
  declare id: string;
  declare x: number;
  declare y: number;
  declare color: string;
  declare ownerName: string;
  declare credits: number;
  /** Visual + claim-hitbox half-extent. Scaled from credits at spawn so a
   *  fat wreck visibly screams "claim me" while a tiny one is a quick grab. */
  declare halfSize: number;
  /** Server time (ms) at which this wreckage despawns if unclaimed. */
  declare expiresAt: number;

  constructor() {
    super();
    this.id = "";
    this.x = 0;
    this.y = 0;
    this.color = "#ffffff";
    this.ownerName = "";
    this.credits = 0;
    this.halfSize = 0;
    this.expiresAt = 0;
  }
}

defineTypes(Wreckage, {
  id: "string",
  x: "number",
  y: "number",
  color: "string",
  ownerName: "string",
  credits: "uint32",
  halfSize: "number",
  expiresAt: "number",
});

export class ArenaState extends Schema {
  declare players: MapSchema<Player>;
  declare units: MapSchema<Unit>;
  declare asteroids: MapSchema<Asteroid>;
  declare projectiles: MapSchema<Projectile>;
  declare structures: MapSchema<Structure>;
  declare wreckages: MapSchema<Wreckage>;
  declare serverTime: number;

  constructor() {
    super();
    this.players = new MapSchema<Player>();
    this.units = new MapSchema<Unit>();
    this.asteroids = new MapSchema<Asteroid>();
    this.projectiles = new MapSchema<Projectile>();
    this.structures = new MapSchema<Structure>();
    this.wreckages = new MapSchema<Wreckage>();
    this.serverTime = 0;
  }
}

defineTypes(ArenaState, {
  players: { map: Player },
  units: { map: Unit },
  asteroids: { map: Asteroid },
  projectiles: { map: Projectile },
  structures: { map: Structure },
  wreckages: { map: Wreckage },
  serverTime: "number",
});
