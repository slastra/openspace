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
  /** Sample-to-sample velocity (Δposition / TICK_DT) sent each snapshot.
   *  Drives client cubic Hermite interpolation; secant-clamped client-side. */
  declare vx: number;
  declare vy: number;
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
  /** Server time (ms) until which incoming damage to this ship is fully
   *  ignored. Set on join + respawn to give a fresh / just-respawned
   *  player a window to drop a base / get oriented without being insta-
   *  killed. Zero ⇒ not invulnerable. */
  declare invulnerableUntil: number;
  /** Optional focus-target id (combatant or asteroid) the player has
   *  click-designated. Owned attack units pursue this target across the
   *  map; owned miners pursue it if it's an asteroid. Empty string ⇒
   *  no focus, units fall back to auto-acquire. Cleared on death and
   *  per-tick when the referenced entity no longer exists. */
  declare focusTargetId: string;
  /** Live owned-unit count (excludes wreckage orphans). Maintained by
   *  the server alongside `supplyUsed`. Drives `playerFleetDragFactor`
   *  on both the server and the client predictor — synced so both
   *  sides agree on the current speed multiplier without re-deriving. */
  declare ownedUnitCount: number;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.kind = "player";
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
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
    this.invulnerableUntil = 0;
    this.focusTargetId = "";
    this.ownedUnitCount = 0;
  }
}

// Position/velocity as float32 — sub-unit precision matters for smooth
// snapshot interpolation. int16 (whole-world-unit) was cheaper but
// quantized slow drift to ±0.5u per snapshot, which read as 30Hz jitter
// when remote ships were moving in formation or holding station. The
// extra 8B per ship per snapshot is negligible at 15 players.
defineTypes(Player, {
  id: "string",
  name: "string",
  kind: "string",
  x: "float32",
  y: "float32",
  vx: "float32",
  vy: "float32",
  rotation: "number",
  color: "string",
  hp: "uint16",
  maxHp: "uint16",
  shield: "uint16",
  maxShield: "uint16",
  deathCount: "uint32",
  lastProcessedInputSeq: "uint32",
  credits: "uint32",
  supplyCap: "uint16",
  supplyUsed: "uint16",
  dashing: "boolean",
  invulnerableUntil: "number",
  focusTargetId: "string",
  ownedUnitCount: "uint16",
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
  /** Discriminator — see UNIT_KIND_META in shared/kinds.ts. */
  declare kind: string;
  declare x: number;
  declare y: number;
  /** Sample-to-sample velocity (Δposition / TICK_DT) for client Hermite interp. */
  declare vx: number;
  declare vy: number;
  /** Facing angle in radians; derived from target (if any) or velocity. */
  declare rotation: number;
  declare hp: number;
  declare maxHp: number;
  declare shield: number;
  declare maxShield: number;
  /** Per-tick float cooldown lives in SimContext (not on the wire) to keep
   *  the schema clean of every-tick decrement traffic. Server fires increment
   *  `fireCount` (rolling uint16) so clients detect a fire as "value went up". */
  declare fireCount: number;
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
    this.kind = "";
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.rotation = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.shield = 0;
    this.maxShield = 0;
    this.fireCount = 0;
    this.targetId = "";
    this.slotIndex = 0;
    this.wreckageId = "";
    this.deactivated = false;
  }
}

// Color is dropped from the wire — clients derive unit color from
// players.get(ownerId).color, saving ~7B per unit per snapshot. Cooldown
// is also dropped: replaced by fireCount which only patches on fire,
// not every tick decrement. Position/velocity use float32 so slow
// formation drift doesn't quantize to per-tick integer steps that the
// client renders as visible jitter — see Player's defineTypes note.
defineTypes(Unit, {
  id: "string",
  ownerId: "string",
  kind: "string",
  x: "float32",
  y: "float32",
  vx: "float32",
  vy: "float32",
  rotation: "number",
  hp: "uint16",
  maxHp: "uint16",
  shield: "uint16",
  maxShield: "uint16",
  fireCount: "uint16",
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
  x: "int16",
  y: "int16",
  radius: "uint16",
  hp: "uint16",
  maxHp: "uint16",
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
  x: "int16",
  y: "int16",
  vx: "int16",
  vy: "int16",
  damage: "uint16",
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
  /** Per-fire signal — see Unit.fireCount. Internal cooldown lives in
   *  SimContext side maps; only this counter goes on the wire. */
  declare fireCount: number;
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
    this.fireCount = 0;
    this.targetId = "";
  }
}

defineTypes(Structure, {
  id: "string",
  ownerId: "string",
  kind: "string",
  color: "string",
  x: "int16",
  y: "int16",
  hp: "uint16",
  maxHp: "uint16",
  shield: "uint16",
  maxShield: "uint16",
  contactRadius: "uint8",
  rotation: "number",
  fireCount: "uint16",
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
  x: "int16",
  y: "int16",
  color: "string",
  ownerName: "string",
  credits: "uint32",
  halfSize: "uint8",
  expiresAt: "number",
});

/**
 * Compact per-player roll-up sent to every client (NOT view-filtered) so
 * the leaderboard, kill counts, and minimap legends keep working even
 * when AOI hides the actual unit objects from a far-away client. Server
 * updates this map each tick from authoritative `state.players` /
 * `state.units` walks.
 */
export class LeaderboardEntry extends Schema {
  declare id: string;
  declare name: string;
  declare color: string;
  declare unitCount: number;
  declare deathCount: number;
  declare isDead: boolean;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.color = "#ffffff";
    this.unitCount = 0;
    this.deathCount = 0;
    this.isDead = false;
  }
}

defineTypes(LeaderboardEntry, {
  id: "string",
  name: "string",
  color: "string",
  unitCount: "uint16",
  deathCount: "uint32",
  isDead: "boolean",
});

export class ArenaState extends Schema {
  declare players: MapSchema<Player>;
  declare units: MapSchema<Unit>;
  declare asteroids: MapSchema<Asteroid>;
  declare projectiles: MapSchema<Projectile>;
  declare structures: MapSchema<Structure>;
  declare wreckages: MapSchema<Wreckage>;
  /** Always-visible per-player roll-up; survives AOI filtering. */
  declare leaderboard: MapSchema<LeaderboardEntry>;
  declare serverTime: number;

  constructor() {
    super();
    this.players = new MapSchema<Player>();
    this.units = new MapSchema<Unit>();
    this.asteroids = new MapSchema<Asteroid>();
    this.projectiles = new MapSchema<Projectile>();
    this.structures = new MapSchema<Structure>();
    this.wreckages = new MapSchema<Wreckage>();
    this.leaderboard = new MapSchema<LeaderboardEntry>();
    this.serverTime = 0;
  }
}

// view: true marks each entity map as per-client-filtered. The Colyseus
// encoder only emits patches for entities the client's StateView has
// .add()-ed. Server-side recomputeViews() in ArenaRoom decides what's
// visible each tick using the spatial grid + AOI radius + hysteresis.
// `leaderboard` is intentionally NOT view-filtered so distant players
// still appear on the rank list and minimap legend.
defineTypes(ArenaState, {
  players: { map: Player, view: true },
  units: { map: Unit, view: true },
  asteroids: { map: Asteroid, view: true },
  projectiles: { map: Projectile, view: true },
  structures: { map: Structure, view: true },
  wreckages: { map: Wreckage, view: true },
  leaderboard: { map: LeaderboardEntry },
  serverTime: "number",
});
