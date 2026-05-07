import RAPIER from "@dimforge/rapier2d-compat";
import { LINEAR_DAMPING, MAX_PLAYERS_PER_ROOM, TICK_DT } from "@openspace/shared";

// Rapier's InteractionGroups packs memberships+filter into a u32 (16 bits
// each). We dedicate one bit per player slot for the wall passthrough
// filter, so MAX_PLAYERS_PER_ROOM must stay ≤ 16. Throwing at module load
// makes a future bump fail loudly instead of silently corrupting filters
// (1 << ≥32 wraps to 1 in JS bitwise ops).
if (MAX_PLAYERS_PER_ROOM > 16) {
  throw new Error(
    `MAX_PLAYERS_PER_ROOM=${MAX_PLAYERS_PER_ROOM} exceeds Rapier's 16-bit ` +
      `InteractionGroups membership space — owner-passthrough collision ` +
      `groups would silently overflow.`,
  );
}
/** Mask covering every legal owner-bit (bits 0..MAX_PLAYERS_PER_ROOM-1).
 *  Used everywhere we'd otherwise hardcode 0xFFFF, so the bit math stays
 *  honest if the player cap ever changes. */
const PLAYER_BITS_MASK = (1 << MAX_PLAYERS_PER_ROOM) - 1;

let initPromise: Promise<void> | null = null;

/**
 * Idempotent. Awaits the WASM/JS interop wiring exactly once per process; all
 * subsequent calls share the same promise. Must complete before any World/
 * RigidBody operations.
 */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

/**
 * Maps Rapier collider handles back to schema entity ids. Owned per-world
 * (per-room). Used by collision-event drainage to convert {handle1, handle2}
 * into {entityId1, entityId2} for damage application. Perimeter walls share
 * a single sentinel id (`WALL_ENTITY_ID`) so wall hits are recognizable.
 */
export type EntityHandleMap = Map<number, string>;

/** Sentinel handleMap id for the static perimeter walls. */
export const WALL_ENTITY_ID = "__wall__";

export interface PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly handleMap: EntityHandleMap;
}

/** Build a fresh physics world with zero gravity (top-down) and our tick dt. */
export function createPhysicsWorld(): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = TICK_DT;
  // event queue with auto-update of contact pairs
  const eventQueue = new RAPIER.EventQueue(true);
  return { world, eventQueue, handleMap: new Map() };
}

/** Free the WASM-allocated world. Call from `Room.onDispose`. */
export function disposePhysicsWorld(phys: PhysicsWorld) {
  phys.world.free();
  phys.handleMap.clear();
}

export interface BodyOptions {
  entityId: string;
  x: number;
  y: number;
  radius: number;
  /** Linear damping; defaults to LINEAR_DAMPING from constants. */
  damping?: number;
  /** Restitution (bounciness). Default 0 — no bounce. */
  restitution?: number;
  /** Collider density. Default 1. Bumping this for the player ship makes
   *  contacts with light units mostly shove the unit aside instead of
   *  stalling the ship — important for dash flow through your own swarm. */
  density?: number;
  /** Owner slot bit (0..14) used by Rapier collision groups so the
   *  body's owner walls (which exclude this bit from their filter) let
   *  the body pass through them. Omit for owner-less bodies — they get
   *  the default "collide with everything" group. */
  ownerBit?: number;
  /** When set with `ownerBit`, also exclude same-owner pairs from
   *  collision. Used for AI units so a dense swarm doesn't thrash the
   *  solver. The body still collides with cross-team units, walls of
   *  other owners, asteroids, and other-owner structures. */
  passSameOwner?: boolean;
}

/**
 * Build a Rapier `InteractionGroups` u32 (`(memberships << 16) | filter`).
 * Two colliders A and B collide iff
 *   `(A.memberships & B.filter) != 0 && (B.memberships & A.filter) != 0`.
 *
 * Owner-passthrough plan: every player gets one of bits 0..14 as their
 * "owner bit." Walls owned by player X have a filter that EXCLUDES X's
 * bit, so any dynamic body whose membership equals X's bit (X's own
 * units / ship) doesn't collide. Enemy bodies have different bits and
 * still collide normally.
 */
function makeGroups(memberships: number, filter: number): number {
  return ((memberships & 0xffff) << 16) | (filter & 0xffff);
}

/** Default — collide with everything (and be collided by everything). */
const GROUPS_DEFAULT = makeGroups(PLAYER_BITS_MASK, PLAYER_BITS_MASK);

/** Memberships = single owner bit, filter = all player bits. */
function ownerMemberGroups(ownerBit: number): number {
  return makeGroups(1 << ownerBit, PLAYER_BITS_MASK);
}

/** Same as `ownerMemberGroups` but the filter ALSO excludes the body's
 *  own owner bit, so two bodies built with this share-no-collision when
 *  they belong to the same player. Used for AI units so dense same-team
 *  swarms don't fight the solver — boid `applySeparation` handles
 *  visible spacing instead. Cross-team unit pairs (different owner bits)
 *  still collide. The owner ship keeps the standard `ownerMemberGroups`,
 *  meaning it also stops bumping its own units — a side benefit
 *  (gliding through own swarm) since the solver fights are the cause
 *  of perceptible jitter when many rammers cluster. */
function unitOwnerGroups(ownerBit: number): number {
  return makeGroups(1 << ownerBit, PLAYER_BITS_MASK & ~(1 << ownerBit));
}

/** Wall filter excludes its owner's bit so the owner's units / ship pass
 *  through. Non-owner dynamic bodies have other membership bits and are
 *  still blocked. */
function wallOwnerFilterGroups(ownerBit: number): number {
  return makeGroups(PLAYER_BITS_MASK, PLAYER_BITS_MASK & ~(1 << ownerBit));
}

/**
 * Create a dynamic body + ball collider for a combatant. Returns the body
 * and the collider's handle (for the handleMap). The collider has
 * COLLISION_EVENTS active so it shows up in the room's drain pass.
 */
export function addCombatantBody(
  phys: PhysicsWorld,
  opts: BodyOptions,
): { body: RAPIER.RigidBody; colliderHandle: number } {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(opts.x, opts.y)
    .setLinearDamping(opts.damping ?? LINEAR_DAMPING)
    .lockRotations(); // Top-down ships don't spin under physics; rotation is a render-only concept.
  const body = phys.world.createRigidBody(bodyDesc);

  const groups =
    opts.ownerBit !== undefined
      ? opts.passSameOwner
        ? unitOwnerGroups(opts.ownerBit)
        : ownerMemberGroups(opts.ownerBit)
      : GROUPS_DEFAULT;
  const colliderDesc = RAPIER.ColliderDesc.ball(opts.radius)
    .setRestitution(opts.restitution ?? 0)
    .setFriction(0.0)
    .setDensity(opts.density ?? 1)
    .setCollisionGroups(groups)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const collider = phys.world.createCollider(colliderDesc, body);

  const handle = collider.handle;
  phys.handleMap.set(handle, opts.entityId);
  return { body, colliderHandle: handle };
}

/**
 * Static collider for a player-built structure. Default ball shape matches
 * the asteroid model — ball-vs-ball contacts produce smoother solver
 * behavior than ball-vs-cuboid (no normal flip at corners) and keep the
 * local-player predictor in lockstep with the server. Wall structures opt
 * into "cuboid" so adjacent placements form a continuous barrier (ball
 * walls on the 100u grid leave diagonal gaps a unit can slip through).
 *
 * `radius` is the structure's `halfExtent` — for a ball it's the radius,
 * for a cuboid it's the (square) half-edge length.
 */
export function addStructureBody(
  phys: PhysicsWorld,
  opts: {
    entityId: string;
    x: number;
    y: number;
    radius: number;
    shape?: "ball" | "cuboid";
    /** Owner slot bit. Only meaningful for walls (cuboid + owner-passthrough);
     *  ignored for structures with no owner-bit semantics. */
    ownerBit?: number;
  },
): { body: RAPIER.RigidBody; colliderHandle: number } {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(opts.x, opts.y);
  const body = phys.world.createRigidBody(bodyDesc);
  const shape = opts.shape ?? "ball";
  const colliderDesc =
    shape === "cuboid"
      ? RAPIER.ColliderDesc.cuboid(opts.radius, opts.radius)
      : RAPIER.ColliderDesc.ball(opts.radius);
  // Only walls (cuboid) get the owner-pass-through filter today. Other
  // structures keep the default "collide with everything" group so
  // supplies/turrets/bases still bump same-team units like always.
  const groups =
    shape === "cuboid" && opts.ownerBit !== undefined
      ? wallOwnerFilterGroups(opts.ownerBit)
      : GROUPS_DEFAULT;
  colliderDesc
    .setRestitution(0)
    .setFriction(0.0)
    .setCollisionGroups(groups)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const collider = phys.world.createCollider(colliderDesc, body);
  phys.handleMap.set(collider.handle, opts.entityId);
  return { body, colliderHandle: collider.handle };
}

/**
 * Live-update a unit collider's owner bit. Called from `claimWreckages`
 * when a transferred unit needs to start passing through its new
 * owner's walls AND share same-team passthrough with the new owner's
 * other units. Always applies the unit-variant groups (filter excludes
 * own owner bit) — only units use this entry point; ship colliders
 * are created once at join and never re-bound. No-op if the collider
 * was destroyed between the lookup and the update.
 */
export function setColliderOwnerBit(
  phys: PhysicsWorld,
  colliderHandle: number,
  ownerBit: number,
) {
  const collider = phys.world.getCollider(colliderHandle);
  if (!collider) return;
  collider.setCollisionGroups(unitOwnerGroups(ownerBit));
}

/**
 * Create a static (fixed) ball collider for an asteroid. Solid — bodies
 * collide with it but it never moves. Registered in handleMap so contact
 * events resolve back to the asteroid id.
 */
export function addAsteroidBody(
  phys: PhysicsWorld,
  opts: { entityId: string; x: number; y: number; radius: number },
): { body: RAPIER.RigidBody; colliderHandle: number } {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(opts.x, opts.y);
  const body = phys.world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.ball(opts.radius)
    .setRestitution(0)
    .setFriction(0.0)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const collider = phys.world.createCollider(colliderDesc, body);
  phys.handleMap.set(collider.handle, opts.entityId);
  return { body, colliderHandle: collider.handle };
}

/** Remove a body and its collider; clean up the handleMap entry. */
export function removeCombatantBody(
  phys: PhysicsWorld,
  body: RAPIER.RigidBody,
  colliderHandle: number,
) {
  phys.handleMap.delete(colliderHandle);
  phys.world.removeRigidBody(body);
}

export function setBodyVelocity(body: RAPIER.RigidBody, vx: number, vy: number) {
  body.setLinvel({ x: vx, y: vy }, true);
}

export function bodyPosition(body: RAPIER.RigidBody): { x: number; y: number } {
  const t = body.translation();
  return { x: t.x, y: t.y };
}

export function bodyVelocity(body: RAPIER.RigidBody): { x: number; y: number } {
  const v = body.linvel();
  return { x: v.x, y: v.y };
}

/** Step the world by one tick and drain collision events. */
export function stepWorld(phys: PhysicsWorld) {
  phys.world.step(phys.eventQueue);
}

/**
 * Drain collision events from this tick. Resolves both collider handles to
 * their entity ids via the handleMap. `started` is true on contact begin,
 * false on contact end; we usually only care about the begin event for
 * damage application.
 */
export function drainContacts(
  phys: PhysicsWorld,
  cb: (idA: string, idB: string, started: boolean) => void,
) {
  phys.eventQueue.drainCollisionEvents((h1, h2, started) => {
    const a = phys.handleMap.get(h1);
    const b = phys.handleMap.get(h2);
    if (!a || !b) return;
    cb(a, b, started);
  });
}

export type { RigidBody } from "@dimforge/rapier2d-compat";
