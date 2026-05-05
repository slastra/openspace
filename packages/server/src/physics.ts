import RAPIER from "@dimforge/rapier2d-compat";
import { LINEAR_DAMPING, TICK_DT } from "@openspace/shared";

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

  const colliderDesc = RAPIER.ColliderDesc.ball(opts.radius)
    .setRestitution(opts.restitution ?? 0)
    .setFriction(0.0)
    .setDensity(opts.density ?? 1)
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
  },
): { body: RAPIER.RigidBody; colliderHandle: number } {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(opts.x, opts.y);
  const body = phys.world.createRigidBody(bodyDesc);
  const shape = opts.shape ?? "ball";
  const colliderDesc =
    shape === "cuboid"
      ? RAPIER.ColliderDesc.cuboid(opts.radius, opts.radius)
      : RAPIER.ColliderDesc.ball(opts.radius);
  colliderDesc
    .setRestitution(0)
    .setFriction(0.0)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const collider = phys.world.createCollider(colliderDesc, body);
  phys.handleMap.set(collider.handle, opts.entityId);
  return { body, colliderHandle: collider.handle };
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
