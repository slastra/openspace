import { type SchemaType, schema, t } from "@colyseus/schema";

// Each synced type is a `schema({...})` value plus a same-named type alias
// (`SchemaType<typeof X>`), so `new Player()` and `MapSchema<Player>` both
// work. Every field carries an explicit `.default()`, which `schema()`
// applies at construction.
//
// Positions/velocities of moving things are float32: sub-unit precision
// matters for smooth snapshot interpolation. int16 (whole world units) was
// cheaper but quantized slow drift to ±0.5u per snapshot, which read as
// 30 Hz jitter on ships and units holding formation.

export const Player = schema(
  {
    id: t.string().default(""),
    /** Display name — captured at join, sanitized server-side, defaults to "Player <N>". */
    name: t.string().default(""),
    /** Always "player" — explicit discriminator that distinguishes Player from Unit. */
    kind: t.string().default("player"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** Sample-to-sample velocity (Δposition / TICK_DT) sent each snapshot.
     *  Drives client cubic Hermite interpolation; secant-clamped client-side. */
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    rotation: t.number().default(0),
    color: t.string().default("#ffffff"),
    hp: t.uint16().default(0),
    maxHp: t.uint16().default(0),
    /** Defensive layer in front of HP. Damage drains shield first. */
    shield: t.uint16().default(0),
    maxShield: t.uint16().default(0),
    /** Increments on every respawn — clients watch this to fire death+spawn FX. */
    deathCount: t.uint32().default(0),
    lastProcessedInputSeq: t.uint32().default(0),
    /** Resource counter — accrued by mining asteroids with owned miner units. */
    credits: t.uint32().default(0),
    /** Max supply this player can field. Increases with built supply structures. */
    supplyCap: t.uint16().default(0),
    /** Supply currently consumed by living owned units. Decrements on unit death. */
    supplyUsed: t.uint16().default(0),
    /** True while the input being simulated has dash held (2× speed; every
     *  owned unit takes DASH_FLEET_BURN_DPS HP/sec from the engine wash). */
    dashing: t.boolean().default(false),
    /** Server time (ms) until which incoming damage to this ship is fully
     *  ignored. Set on join + respawn to give a fresh / just-respawned
     *  player a window to drop a base / get oriented without being insta-
     *  killed. Zero ⇒ not invulnerable. */
    invulnerableUntil: t.number().default(0),
    /** Optional focus-target id (combatant or asteroid) the player has
     *  click-designated. Owned attack units pursue this target across the
     *  map; owned miners pursue it if it's an asteroid. Empty string ⇒
     *  no focus, units fall back to auto-acquire. Cleared on death and
     *  per-tick when the referenced entity no longer exists. */
    focusTargetId: t.string().default(""),
    /** Live owned-unit count (excludes wreckage orphans). Maintained by
     *  the server alongside `supplyUsed`. The client stamps it onto each
     *  input as the fleet-drag count (see PlayerInput.fleet). */
    ownedUnitCount: t.uint16().default(0),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

/**
 * AI-controlled minion. Behavior, stats, and visuals are dispatched on
 * `kind` (see UNIT_KIND_META, kindBehaviors, createUnitView). `shield` is a
 * universal defensive layer applied before HP for any kind a shielder can
 * target. Color isn't sent: clients derive it from the owner's color.
 */
export const Unit = schema(
  {
    id: t.string().default(""),
    ownerId: t.string().default(""),
    /** Discriminator — see UNIT_KIND_META in shared/kinds.ts. */
    kind: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** Sample-to-sample velocity (Δposition / TICK_DT) for client Hermite interp. */
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    /** Facing angle in radians; derived from target (if any) or velocity. */
    rotation: t.number().default(0),
    hp: t.uint16().default(0),
    maxHp: t.uint16().default(0),
    shield: t.uint16().default(0),
    maxShield: t.uint16().default(0),
    /** Per-tick float cooldown lives in SimContext (not on the wire) to keep
     *  the schema clean of every-tick decrement traffic. Server fires increment
     *  `fireCount` (rolling uint16) so clients detect a fire as "value went up". */
    fireCount: t.uint16().default(0),
    /** Empty when in formation; entity id (unit or player) when chasing/targeting. */
    targetId: t.string().default(""),
    /** Server-only (noSync). Per-owner ordinal: a spawn or claim takes the
     *  owner's lowest free value, and survivors are never renumbered when a
     *  peer dies. Picks which units sleep when over the supply cap, staggers
     *  target re-acquisition, and breaks ties in formation slot assignment. */
    slotIndex: t.number().noSync().default(0),
    /** Set when this unit is orphaned by its owner's death — it orbits the
     *  named wreckage instead of chasing/mining/etc. Cleared when claimed. */
    wreckageId: t.string().default(""),
    /** Set when the owner has insufficient supply cap to support this unit
     *  (computed per-tick from slotIndex priority). Same inert-orbit behavior
     *  as orphans, just anchored to the owner ship. Clears once supply recovers. */
    deactivated: t.boolean().default(false),
  },
  "Unit",
);
export type Unit = SchemaType<typeof Unit>;

/**
 * Mineable static rock. Not a Combatant — has its own hp track and damage
 * path. `lastHitBy` records the ownerId of the most recent miner.
 */
export const Asteroid = schema(
  {
    id: t.string().default(""),
    x: t.int16().default(0),
    y: t.int16().default(0),
    radius: t.uint16().default(0),
    hp: t.uint16().default(0),
    maxHp: t.uint16().default(0),
    resourceValue: t.uint32().default(0),
    lastHitBy: t.string().default(""),
  },
  "Asteroid",
);
export type Asteroid = SchemaType<typeof Asteroid>;

/**
 * Server-stepped projectile fired by a gunner-class unit. Travels along
 * (vx, vy) until it overlaps a non-friendly Combatant, leaves the world,
 * or hits its `expiresAt`. `team` is the firing unit's owner id — used
 * for friendly-fire skip in collision checks.
 */
export const Projectile = schema(
  {
    id: t.string().default(""),
    ownerId: t.string().default(""),
    team: t.string().default(""),
    color: t.string().default("#ffffff"),
    x: t.int16().default(0),
    y: t.int16().default(0),
    vx: t.int16().default(0),
    vy: t.int16().default(0),
    damage: t.uint16().default(0),
    expiresAt: t.number().default(0),
  },
  "Projectile",
);
export type Projectile = SchemaType<typeof Projectile>;

/**
 * Static player-built structure. Grid-snapped, with a fixed collider its
 * owner passes through. Satisfies the Combatant shape so every damage /
 * heal / shield path applies uniformly — laser drones can target it,
 * repair drones can mend it, shielders can buff it.
 */
export const Structure = schema(
  {
    id: t.string().default(""),
    ownerId: t.string().default(""),
    kind: t.string().default(""),
    color: t.string().default("#ffffff"),
    x: t.int16().default(0),
    y: t.int16().default(0),
    hp: t.uint16().default(0),
    maxHp: t.uint16().default(0),
    shield: t.uint16().default(0),
    maxShield: t.uint16().default(0),
    /** Used by `contactRadiusOf` for projectile hit checks. */
    contactRadius: t.uint8().default(0),
    /** Combat structures only: barrel facing in radians, derived from current target. */
    rotation: t.number().default(0),
    /** Per-fire signal — see Unit.fireCount. Internal cooldown lives in
     *  SimContext side maps; only this counter goes on the wire. */
    fireCount: t.uint16().default(0),
    /** Combat structures only: id of currently-acquired target (empty if none). */
    targetId: t.string().default(""),
  },
  "Structure",
);
export type Structure = SchemaType<typeof Structure>;

/**
 * A dead player's loot drop. Holds the credits they had at death and any
 * units they owned (orphan units carry `wreckageId` pointing here, orbit
 * the wreckage in formation, and can be picked off by enemies). First live
 * player to touch it claims everything and the wreckage despawns.
 */
export const Wreckage = schema(
  {
    id: t.string().default(""),
    x: t.int16().default(0),
    y: t.int16().default(0),
    color: t.string().default("#ffffff"),
    ownerName: t.string().default(""),
    credits: t.uint32().default(0),
    /** Visual + claim-hitbox half-extent. Scaled from credits at spawn so a
     *  fat wreck visibly screams "claim me" while a tiny one is a quick grab. */
    halfSize: t.uint8().default(0),
    /** Server time (ms) at which this wreckage despawns if unclaimed. */
    expiresAt: t.number().default(0),
  },
  "Wreckage",
);
export type Wreckage = SchemaType<typeof Wreckage>;

/**
 * Compact per-player roll-up sent to every client (NOT view-filtered) so
 * the leaderboard, kill counts, and minimap legends keep working even
 * when AOI hides the actual unit objects from a far-away client. Server
 * updates this map each tick from authoritative `state.players` /
 * `state.units` walks.
 */
export const LeaderboardEntry = schema(
  {
    id: t.string().default(""),
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    unitCount: t.uint16().default(0),
    deathCount: t.uint32().default(0),
    /** Enemy ships destroyed this session. */
    kills: t.uint16().default(0),
    isDead: t.boolean().default(false),
  },
  "LeaderboardEntry",
);
export type LeaderboardEntry = SchemaType<typeof LeaderboardEntry>;

// .view() marks each entity map as per-client-filtered: the encoder only
// emits patches for entities the client's StateView has .add()-ed.
// recomputeViews() in ArenaRoom decides what's visible each tick using the
// spatial grid + AOI radius + hysteresis. `leaderboard` is intentionally
// NOT view-filtered so distant players still appear on the rank list and
// minimap legend.
export const ArenaState = schema(
  {
    players: t.map(Player).view(),
    units: t.map(Unit).view(),
    asteroids: t.map(Asteroid).view(),
    projectiles: t.map(Projectile).view(),
    structures: t.map(Structure).view(),
    wreckages: t.map(Wreckage).view(),
    /** Always-visible per-player roll-up; survives AOI filtering. */
    leaderboard: t.map(LeaderboardEntry),
    /** Simulation clock (ms): advances exactly TICK_MS per tick. */
    serverTime: t.number().default(0),
  },
  "ArenaState",
);
export type ArenaState = SchemaType<typeof ArenaState>;
