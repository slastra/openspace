import {
  ArenaState,
  COLLISION_DAMAGE_MAX,
  COLLISION_DAMAGE_MIN,
  COLLISION_DAMAGE_PER_SPEED,
  CREDITS_PER_ASTEROID_HP,
  MAX_PROJECTILES_PER_ROOM,
  PLAYER_CONTACT_RADIUS,
  PLAYER_MAX_HP,
  PLAYER_MINING_DPS,
  PLAYER_MINING_REACH,
  PROJECTILE_LIFETIME_GRACE_MS,
  PROJECTILE_RADIUS,
  PlayerInput,
  Projectile,
  STARTING_CREDITS,
  TICK_DT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  WRECKAGE_LIFETIME_MS,
  Wreckage,
  wreckageHalfSize,
  DASH_FLEET_BURN_DPS,
  DASH_SPEED_MULTIPLIER,
  STRUCTURE_KIND_META,
  Combatant,
  allCombatants,
  applyDamage,
  clamp,
  contactRadiusOf,
  isNeutral,
  isPlayer,
  isStructure,
  isUnit,
  lookupCombatant,
  playerDesiredVelocity,
  shortestAngleDelta,
  stationTarget,
  teamOf,
  UNIT_KIND_META,
} from "@openspace/shared";
import { WALL_ENTITY_ID } from "./physics.js";
import {
  bodyPosition,
  bodyVelocity,
  drainContacts,
  PhysicsWorld,
  removeCombatantBody,
  RigidBody,
  setBodyVelocity,
  stepWorld,
} from "./physics.js";
import { arriveAtStation, lookupKind } from "./behaviors.js";
import {
  TickGrids,
  gridNearestEnemy,
  rebuildTickGrids,
} from "./spatial.js";
import type { Player, SlotInfo, Unit, UnitKindMeta } from "@openspace/shared";

/**
 * Side-table of physics references for an entity. Schema entities can't hold
 * the live RigidBody (not serializable); ArenaRoom owns this map and passes
 * it into the simulation each tick.
 */
export interface BodyRef {
  body: RigidBody;
  colliderHandle: number;
}

/**
 * Result of one server tick. Surfaces asteroid IDs culled this tick so
 * the room can schedule replacements; ArenaRoom owns the respawn queue.
 */
export interface TickResult {
  culledAsteroidIds: string[];
}

/** Owner ship speed below which formation orbit runs at full rate. */
const FORMATION_FREEZE_LO_SPEED = 30;
/** Owner ship speed at and above which formation orbit is fully frozen. */
const FORMATION_FREEZE_HI_SPEED = 100;

/**
 * One server tick.
 *   1. Apply each player's most-recent queued input as a velocity to their body.
 *   2. Run unit AI: dispatch by kind to compute desired velocity; write it.
 *   3. Step the physics world (queues collision events).
 *   4. Drain collision events; cross-team starts apply damage to both sides;
 *      miner-vs-asteroid contacts chip asteroid HP.
 *   5. Read body positions back into the schema; derive rotation from velocity.
 *   6. Cull dead units + asteroids; respawn dead players (and clear their owned units).
 */
/**
 * Mutable side tables the room owns and threads through the tick. Bundled
 * so adding new per-tick context (kill streaks, last-fire times, ...) is
 * a one-field change instead of a parameter cascade.
 */
export interface SimContext {
  /** Per-player fractional credit accumulator. Mining drips into this and
   *  the room flushes integer parts into player.credits each tick. */
  creditAccrual: Map<string, number>;
  /** victim sessionId → sessionId of the player credited with most recent
   *  damage. Used to award bounty on death. Wall instakills clear the entry. */
  lastAttackerByVictim: Map<string, string>;
  /** Allocates a unique projectile id. Owned by the room (counter). */
  allocProjectileId: () => string;
  /** Allocates a unique wreckage id. Owned by the room (counter). */
  allocWreckageId: () => string;
  /** Session ids that asked to respawn this tick — `cullAndRespawn` consumes
   *  the set and teleports + heals each one. Players stay dead until they
   *  appear here, so dying never auto-respawns. */
  pendingRespawnSet: Set<string>;
  /** Per-owner formation orbit phase (radians-of-time). Advances at full
   *  rate while the owner is stationary and freezes while they're moving,
   *  so units don't have to chase a slot that's both translating with the
   *  ship and rotating around it — that compounding was visible as jitter
   *  on snapshot-interpolated unit motion. */
  formationPhaseByOwner: Map<string, number>;
  /** Per-entity previous-tick (x, y) for computing sample-to-sample velocity
   *  written to schema.vx/vy. Used by client Hermite interpolation; secant
   *  computed from positions matches what the client interpolates between
   *  (vs raw bodyVelocity which can disagree after collisions). */
  lastEntityPos: Map<string, { x: number; y: number }>;
  /** Per-tick spatial indexes — replaces O(N) walks in target acquisition
   *  and unit separation with cell-local scans. Rebuilt at the top of
   *  every `simulateTick`. */
  grids: TickGrids;
  /** Monotonically increasing tick counter. Used to stagger heavy AI
   *  passes (e.g. target re-acquisition) across ticks so we don't pay the
   *  full cost every frame. */
  tickIndex: number;
  /** Per-unit fire-cooldown clock (seconds). Lives off-schema so the
   *  every-tick decrement doesn't dirty the network state — only
   *  `Unit.fireCount` goes on the wire, and only when it actually fires. */
  unitCooldownById: Map<string, number>;
  /** Per-structure fire-cooldown clock (seconds). Same role as above. */
  structureCooldownById: Map<string, number>;
}

export function simulateTick(
  state: ArenaState,
  inputQueues: Map<string, PlayerInput[]>,
  bodyRefs: Map<string, BodyRef>,
  phys: PhysicsWorld,
  ctx: SimContext,
): TickResult {
  ctx.tickIndex = (ctx.tickIndex + 1) | 0;
  applyPlayerInputs(state, inputQueues, bodyRefs);
  applySupplyDeactivation(state);
  rebuildTickGrids(ctx.grids, state);
  runUnitAI(state, bodyRefs, ctx);
  stepWorld(phys);
  resolveCollisions(state, phys, bodyRefs, ctx.lastAttackerByVictim);
  readBackPlayers(state, bodyRefs, ctx);
  readBackUnits(state, bodyRefs, ctx);
  mineAsteroids(state, ctx.creditAccrual);
  runUnitAbilities(state, ctx);
  runStructureAbilities(state, ctx);
  runRepairs(state);
  runShieldAuras(state);
  stepProjectiles(state, ctx);
  burnFleetWhileDashing(state);
  runExplosions(state, ctx);
  claimWreckages(state, bodyRefs, phys);
  return cullAndRespawn(state, bodyRefs, phys, ctx);
}

function applyPlayerInputs(
  state: ArenaState,
  queues: Map<string, PlayerInput[]>,
  bodyRefs: Map<string, BodyRef>,
) {
  for (const [sessionId, player] of state.players) {
    const queue = queues.get(sessionId);
    const ref = bodyRefs.get(sessionId);
    if (!ref) continue;

    if (player.hp <= 0) {
      if (queue) {
        for (const input of queue) player.lastProcessedInputSeq = input.seq;
        queue.length = 0;
      }
      setBodyVelocity(ref.body, 0, 0);
      continue;
    }

    if (!queue || queue.length === 0) continue;

    // Use the latest queued input. Older queued inputs are still acked so
    // the client buffer drains, but only the latest target affects velocity.
    const latest = queue[queue.length - 1]!;
    for (const input of queue) player.lastProcessedInputSeq = input.seq;
    queue.length = 0;

    const speedMultiplier = player.dashing ? DASH_SPEED_MULTIPLIER : 1;
    const desired = playerDesiredVelocity(
      player.x,
      player.y,
      latest.targetX,
      latest.targetY,
      speedMultiplier,
    );
    setBodyVelocity(ref.body, desired.vx, desired.vy);
    // Face the cursor (desired direction), not the actual velocity. When
    // the ship is pressed against an obstacle Rapier wiggles it tangentially
    // which would make atan2(vel) jitter; using the input direction matches
    // the client predictor (stepPlayer) and stays steady on contact.
    if (desired.speed > 0) {
      player.rotation = Math.atan2(desired.vy, desired.vx);
    }
  }
}


/**
 * Deactivate units when their owner is over supply cap. Sorts each owner's
 * units by `slotIndex` desc and flips the highest-slot ones to deactivated
 * until the active total fits under `supplyCap`. Stable per-unit (slotIndex
 * doesn't reshuffle on death), so the same units stay deactivated across
 * ticks until the cap recovers — no flicker.
 *
 * Orphan units (wreckageId set) are skipped — they're not on the cap.
 */
function applySupplyDeactivation(state: ArenaState) {
  const byOwner = new Map<string, Unit[]>();
  for (const u of state.units.values()) {
    if (u.wreckageId) {
      u.deactivated = false;
      continue;
    }
    let list = byOwner.get(u.ownerId);
    if (!list) {
      list = [];
      byOwner.set(u.ownerId, list);
    }
    list.push(u);
  }

  for (const [ownerId, units] of byOwner) {
    const player = state.players.get(ownerId);
    if (!player) {
      for (const u of units) u.deactivated = false;
      continue;
    }
    let totalSupply = 0;
    for (const u of units) {
      totalSupply += UNIT_KIND_META[u.kind]?.supplyCost ?? 1;
    }
    if (totalSupply <= player.supplyCap) {
      for (const u of units) u.deactivated = false;
      continue;
    }
    // Over cap: walk highest slotIndex → lowest, deactivating until the
    // remaining active set fits the cap.
    units.sort((a, b) => b.slotIndex - a.slotIndex);
    let overflow = totalSupply - player.supplyCap;
    for (const u of units) {
      const cost = UNIT_KIND_META[u.kind]?.supplyCost ?? 1;
      if (overflow > 0) {
        u.deactivated = true;
        overflow -= cost;
      } else {
        u.deactivated = false;
      }
    }
  }
}

function runUnitAI(state: ArenaState, bodyRefs: Map<string, BodyRef>, ctx: SimContext) {
  // Slot assignment: each owner's units get stations on concentric rings,
  // sorted stably by id so slots don't reshuffle every tick.
  const slotInfo = computeSlots(state);
  // Server clock seconds — fallback phase for non-owner anchors (wreckages
  // are stationary, so their orbit can run at full rate from global time).
  const timeSeconds = state.serverTime / 1000;
  // Per-owner motion state. `orbitScale` is 1 when the ship is at rest and
  // ramps to 0 at FORMATION_FREEZE_HI_SPEED — used both to freeze the orbit
  // phase (so units don't chase a rotating slot) and to blend between the
  // orbital station velocity and a flock-with-the-ship velocity.
  const ownerMotion = new Map<
    string,
    { vx: number; vy: number; phase: number; orbitScale: number }
  >();
  for (const ownerId of state.players.keys()) {
    const ref = bodyRefs.get(ownerId);
    let vx = 0;
    let vy = 0;
    if (ref) {
      const v = bodyVelocity(ref.body);
      vx = v.x;
      vy = v.y;
    }
    const speed = Math.hypot(vx, vy);
    const orbitScale = clamp(
      1 - (speed - FORMATION_FREEZE_LO_SPEED) /
        (FORMATION_FREEZE_HI_SPEED - FORMATION_FREEZE_LO_SPEED),
      0,
      1,
    );
    const prev = ctx.formationPhaseByOwner.get(ownerId) ?? timeSeconds;
    const phase = prev + TICK_DT * orbitScale;
    ctx.formationPhaseByOwner.set(ownerId, phase);
    ownerMotion.set(ownerId, { vx, vy, phase, orbitScale });
  }
  const phaseFor = (ownerId: string | null): number =>
    (ownerId !== null ? ownerMotion.get(ownerId)?.phase : undefined) ?? timeSeconds;

  for (const [unitId, unit] of state.units) {
    const ref = bodyRefs.get(unitId);
    if (!ref) continue;
    if (unit.hp <= 0) {
      setBodyVelocity(ref.body, 0, 0);
      continue;
    }
    const resolved = lookupKind(unit.kind);
    if (!resolved) continue;
    const { behavior, meta } = resolved;
    const owner = state.players.get(unit.ownerId) ?? null;
    const slot = slotInfo.get(unitId) ?? { index: 0, total: 1 };

    // Inert orbit: orphan units anchor to their wreckage; deactivated
    // (over-supply) units anchor to the live owner. Both drop targets
    // and orbit at formation speed via arrive-at-station + boid.
    if (unit.wreckageId) {
      const w = state.wreckages.get(unit.wreckageId);
      if (!w) {
        setBodyVelocity(ref.body, 0, 0);
        continue;
      }
      orbitAnchor(unit, ref, w.x, w.y, slot, meta, ctx, timeSeconds);
      continue;
    }
    if (unit.deactivated && owner) {
      orbitAnchor(unit, ref, owner.x, owner.y, slot, meta, ctx, phaseFor(owner.id));
      continue;
    }

    // Dash override: while the owner is holding thrust, every unit drops
    // its current task and rushes to its formation slot at full attackSpeed
    // (no kind-specific kiting / arrival decel). Lets the swarm trail
    // behind the dashing ship instead of getting left behind in formation.
    if (owner?.dashing) {
      unit.targetId = "";
      const station = stationTarget(owner.x, owner.y, slot, meta.contactRadius, phaseFor(owner.id));
      const dx = station.x - unit.x;
      const dy = station.y - unit.y;
      const dist = Math.hypot(dx, dy);
      let vx = 0;
      let vy = 0;
      if (dist >= 1) {
        vx = (dx / dist) * meta.attackSpeed;
        vy = (dy / dist) * meta.attackSpeed;
      }
      const adjusted = applySeparation(unit, { vx, vy }, ctx, meta);
      setBodyVelocity(ref.body, adjusted.vx, adjusted.vy);
      continue;
    }

    // Stagger target re-acquisition to ~10Hz. The slot index + tick index
    // mod 3 spreads the heavy passes evenly across frames so we never get a
    // "whole world re-acquires this tick" CPU spike. A unit without a held
    // target re-acquires immediately so newly-spawned units engage on tick 1
    // rather than waiting up to two ticks (~67ms).
    let target: Combatant | null;
    const reacquire =
      !unit.targetId || ((ctx.tickIndex + unit.slotIndex) % 3) === 0;
    if (reacquire) {
      target = behavior.acquireTarget(unit, state, meta, ctx.grids);
    } else {
      target =
        lookupCombatant(state, unit.targetId) ??
        ((state.asteroids.get(unit.targetId) as unknown as Combatant) || null);
      if (!target || target.hp <= 0) {
        target = behavior.acquireTarget(unit, state, meta, ctx.grids);
      }
    }
    unit.targetId = target ? target.id : "";

    const desired = behavior.desiredVelocity(
      unit,
      target,
      owner,
      meta,
      slot,
      phaseFor(owner?.id ?? null),
    );
    // Leader drift: when the unit isn't pursuing an enemy, add the owner's
    // velocity as a baseline so the unit cruises with the ship by default.
    // The behavior's velocity stays as the *relative* correction toward its
    // slot (zero when on station, signed when ahead/behind). Replaces the
    // earlier flock blend, which scaled both station and ownerVel together
    // and produced a chronic speed mismatch — units would always run a bit
    // slower than the ship and oscillate via cohesion overshoot.
    if (!target && owner) {
      const m = ownerMotion.get(owner.id);
      if (m) {
        desired.vx += m.vx;
        desired.vy += m.vy;
      }
    }
    const adjusted = applySeparation(unit, desired, ctx, meta);
    // Acceleration cap: clamp the per-tick velocity *change* so sharp AI
    // intent flips (formation→chase, target switch, asteroid death) don't
    // produce single-tick discontinuities that 20Hz snapshot interp renders
    // as a visible kink. Standard Reynolds steering practice — limits dv/dt
    // regardless of what the AI wants. The AI is still authoritative on
    // intent; the body just ramps to that intent over a few ticks.
    const cur = bodyVelocity(ref.body);
    const limited = limitAcceleration(cur.x, cur.y, adjusted.vx, adjusted.vy);
    setBodyVelocity(ref.body, limited.vx, limited.vy);
  }
}

/** Per-tick velocity-change cap, in world units. At 30Hz with MAX_ACCEL =
 *  4000 u/s², that's 133 u/tick — roughly 75ms to change from 0 to ship
 *  speed (300), 150ms from 0 to rammer attack speed (600). Snappy enough to
 *  feel responsive, smooth enough to hide single-tick AI flips. */
const MAX_VELOCITY_CHANGE_PER_TICK = 4000 * TICK_DT;

function limitAcceleration(
  curVx: number,
  curVy: number,
  wantVx: number,
  wantVy: number,
): { vx: number; vy: number } {
  const dx = wantVx - curVx;
  const dy = wantVy - curVy;
  const mag = Math.hypot(dx, dy);
  if (mag <= MAX_VELOCITY_CHANGE_PER_TICK) return { vx: wantVx, vy: wantVy };
  const scale = MAX_VELOCITY_CHANGE_PER_TICK / mag;
  return { vx: curVx + dx * scale, vy: curVy + dy * scale };
}

/**
 * Boid-style separation: nudge a unit's desired velocity away from any
 * friendly unit pressing within `SEPARATION_RADIUS` (≈ 3.5× contact radius).
 * Repulsion strength scales linearly with overlap depth so distant neighbors
 * barely register and near-touching ones get a strong push.
 *
 * Without this, multiple chasers/miners targeting the same point converge
 * into a buzzing cluster — the AI re-aims them at the same spot every tick
 * and the solver bounces them around. Separation breaks the symmetry so
 * they spread out around the target instead.
 */
/**
 * Park a unit in formation around an arbitrary anchor point. Used by the
 * inert-orbit branches in `runUnitAI` (wreckage orphans, supply-deactivated
 * sleepers) — clears the unit's target, computes its formation slot relative
 * to the anchor, applies arrival-style steering, and runs the same boid
 * separation as live units so the orbit doesn't collapse into a clump.
 */
function orbitAnchor(
  unit: Unit,
  ref: BodyRef,
  anchorX: number,
  anchorY: number,
  slot: SlotInfo,
  meta: UnitKindMeta,
  ctx: SimContext,
  timeSeconds: number,
) {
  unit.targetId = "";
  const station = stationTarget(anchorX, anchorY, slot, meta.contactRadius, timeSeconds);
  const desired = arriveAtStation(
    unit.x,
    unit.y,
    station.x,
    station.y,
    meta.formationSpeed,
  );
  const adjusted = applySeparation(unit, desired, ctx, meta);
  setBodyVelocity(ref.body, adjusted.vx, adjusted.vy);
}

function applySeparation(
  unit: Unit,
  desired: { vx: number; vy: number },
  ctx: SimContext,
  meta: UnitKindMeta,
): { vx: number; vy: number } {
  const radius = meta.contactRadius * 3.5;
  const radSq = radius * radius;
  const team = teamOf(unit);
  let sx = 0;
  let sy = 0;
  ctx.grids.units.forEachInRadius(unit.x, unit.y, radius, (other) => {
    if (other.id === unit.id) return;
    if (teamOf(other) !== team) return;
    const dx = unit.x - other.x;
    const dy = unit.y - other.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > radSq || d2 < 1e-4) return;
    const d = Math.sqrt(d2);
    const strength = 1 - d / radius;
    sx += (dx / d) * strength;
    sy += (dy / d) * strength;
  });
  if (sx === 0 && sy === 0) return desired;
  const blend = meta.attackSpeed * 0.6;
  return { vx: desired.vx + sx * blend, vy: desired.vy + sy * blend };
}

function computeSlots(state: ArenaState): Map<string, SlotInfo> {
  // Formation positions are sorted by (kind.formationTier, slotIndex) per
  // owner: support kinds (repair/shield, tier 0) hug the player on the
  // inner ring, front-liners (rammers, tier 4) push to the outside. Within
  // a tier, the original spawn-order slotIndex is the stable tiebreaker so
  // same-kind units don't reshuffle when a peer dies — only cross-tier
  // spawns trigger a one-time visible shift outward for lower-priority
  // kinds, which is the desired behavior.
  const out = new Map<string, SlotInfo>();
  const byOwner = new Map<string, Unit[]>();
  for (const u of state.units.values()) {
    let list = byOwner.get(u.ownerId);
    if (!list) {
      list = [];
      byOwner.set(u.ownerId, list);
    }
    list.push(u);
  }
  for (const [, units] of byOwner) {
    units.sort((a, b) => {
      const ta = UNIT_KIND_META[a.kind]?.formationTier ?? 999;
      const tb = UNIT_KIND_META[b.kind]?.formationTier ?? 999;
      if (ta !== tb) return ta - tb;
      return a.slotIndex - b.slotIndex;
    });
    for (let i = 0; i < units.length; i++) {
      out.set(units[i]!.id, { index: i, total: units.length });
    }
  }
  return out;
}

/** Sample-to-sample velocity (Δposition / TICK_DT) — what the client needs
 *  for cubic Hermite snapshot interp. Computed from positions (not raw
 *  bodyVelocity) so the secant matches what the client actually
 *  interpolates between, even after collision-induced position corrections. */
function sampleVelocity(
  ctx: SimContext,
  id: string,
  prevX: number,
  prevY: number,
  newX: number,
  newY: number,
  entity: { vx: number; vy: number },
) {
  const last = ctx.lastEntityPos.get(id);
  if (last) {
    // Round to int — vx/vy are int16 on the wire; pre-rounding here means
    // float jitter under ±0.5 u/s never dirties the schema field.
    entity.vx = Math.round((newX - last.x) / TICK_DT);
    entity.vy = Math.round((newY - last.y) / TICK_DT);
  } else {
    entity.vx = 0;
    entity.vy = 0;
  }
  // Cache the *new* position for next tick's secant. We could use prevX
  // (this tick's pre-step position) but newX gives us a one-tick window
  // that exactly matches what the client lerps between snapshots.
  ctx.lastEntityPos.set(id, { x: newX, y: newY });
  void prevX;
  void prevY;
}

function readBackPlayers(
  state: ArenaState,
  bodyRefs: Map<string, BodyRef>,
  ctx: SimContext,
) {
  for (const [sessionId, player] of state.players) {
    const ref = bodyRefs.get(sessionId);
    if (!ref) continue;
    const pos = bodyPosition(ref.body);
    const newX = clamp(pos.x, 0, WORLD_WIDTH);
    const newY = clamp(pos.y, 0, WORLD_HEIGHT);
    sampleVelocity(ctx, sessionId, player.x, player.y, newX, newY, player);
    // Round to int — x/y are int16 on the wire; rounding here keeps idle
    // ships from dirtying every tick on Rapier's sub-unit float jitter.
    player.x = Math.round(newX);
    player.y = Math.round(newY);
    // Rotation is set in applyPlayerInputs from the desired (cursor) direction
    // — see the comment there for why we don't use actual velocity here.
  }
}

function readBackUnits(
  state: ArenaState,
  bodyRefs: Map<string, BodyRef>,
  ctx: SimContext,
) {
  for (const [unitId, unit] of state.units) {
    const ref = bodyRefs.get(unitId);
    if (!ref) continue;
    const pos = bodyPosition(ref.body);
    const newX = clamp(pos.x, 0, WORLD_WIDTH);
    const newY = clamp(pos.y, 0, WORLD_HEIGHT);
    sampleVelocity(ctx, unitId, unit.x, unit.y, newX, newY, unit);
    unit.x = Math.round(newX);
    unit.y = Math.round(newY);

    // Facing: aim at target if we have one (resolved across players, units,
    // and asteroids — miners face their rock). Else fall back to velocity
    // direction. Else preserve last rotation so a parked unit doesn't snap
    // to 0 every tick.
    let aimX: number | null = null;
    let aimY: number | null = null;
    if (unit.targetId) {
      const t =
        state.players.get(unit.targetId) ??
        state.units.get(unit.targetId) ??
        state.asteroids.get(unit.targetId);
      if (t) {
        aimX = t.x - pos.x;
        aimY = t.y - pos.y;
      }
    }
    if (aimX === null || (aimX === 0 && aimY === 0)) {
      const vel = bodyVelocity(ref.body);
      if (Math.hypot(vel.x, vel.y) > 5) {
        aimX = vel.x;
        aimY = vel.y;
      }
    }
    if (aimX !== null && aimY !== null && (aimX !== 0 || aimY !== 0)) {
      const desired = Math.atan2(aimY, aimX);
      const meta = UNIT_KIND_META[unit.kind];
      const rate = meta?.rotationRateRadPerSec;
      if (rate !== undefined) {
        // Turret-style: rotate toward desired at capped angular speed.
        const delta = shortestAngleDelta(unit.rotation, desired);
        const maxStep = rate * TICK_DT;
        unit.rotation += clamp(delta, -maxStep, maxStep);
      } else {
        unit.rotation = desired;
      }
    }
  }
}

/**
 * Drain Rapier's contact events from the just-stepped world. We only care
 * about `started` (contact begin):
 *   - Wall contact → instakill the combatant (drain shield, zero HP).
 *   - Asteroid contact → static rock takes nothing; the moving combatant
 *     eats damage scaled to its impact speed.
 *   - Cross-team combatant contact → both sides take damage scaled by
 *     their RELATIVE speed (head-on collisions hurt more than glancing taps).
 *
 * Mining is handled per-tick by `mineAsteroids` (proximity-based) — asteroid
 * contact events are purely for impact damage now.
 *
 * Rapier's solver pushes overlapping bodies apart, so sustained pressure
 * produces repeated begin events as they re-contact, throttling damage.
 */
function resolveCollisions(
  state: ArenaState,
  phys: PhysicsWorld,
  bodyRefs: Map<string, BodyRef>,
  lastAttackerByVictim: Map<string, string>,
) {
  drainContacts(phys, (idA, idB, started) => {
    if (!started) return;
    const aIsWall = idA === WALL_ENTITY_ID;
    const bIsWall = idB === WALL_ENTITY_ID;
    if (aIsWall && bIsWall) return;
    if (aIsWall || bIsWall) {
      const victim = lookupCombatant(state, aIsWall ? idB : idA);
      // Structures are static and may live next to walls — skip wall instakill
      // for them. Players & units (mobile) still get insta-popped on impact.
      if (victim && victim.hp > 0 && !isStructure(victim)) {
        victim.shield = 0;
        victim.hp = 0;
        // Wall is environmental — clear attribution so the death yields
        // no bounty (the wall didn't earn it).
        if (isPlayer(victim)) lastAttackerByVictim.delete(victim.id);
      }
      return;
    }

    // Asteroid contact: rock takes no damage, but the moving combatant
    // does, scaled by its own impact speed.
    const aIsAsteroid = state.asteroids.has(idA);
    const bIsAsteroid = state.asteroids.has(idB);
    if (aIsAsteroid && bIsAsteroid) return;
    if (aIsAsteroid || bIsAsteroid) {
      const victim = lookupCombatant(state, aIsAsteroid ? idB : idA);
      if (!victim || victim.hp <= 0) return;
      const ref = bodyRefs.get(victim.id);
      if (!ref) return;
      const v = bodyVelocity(ref.body);
      const speed = Math.hypot(v.x, v.y);
      applyDamage(victim, impactDamage(speed));
      return;
    }

    const a = lookupCombatant(state, idA);
    const b = lookupCombatant(state, idB);
    if (!a || !b) return;
    if (teamOf(a) === teamOf(b)) return;
    if (a.hp <= 0 || b.hp <= 0) return;
    // Orphans (wreckage swarm) are inert — bodies still bump physically
    // (Rapier already resolved separation), but no damage is exchanged.
    if (isNeutral(a) || isNeutral(b)) return;
    const refA = bodyRefs.get(a.id);
    const refB = bodyRefs.get(b.id);
    if (!refA || !refB) return;
    const va = bodyVelocity(refA.body);
    const vb = bodyVelocity(refB.body);
    const relSpeed = Math.hypot(va.x - vb.x, va.y - vb.y);
    const dmg = impactDamage(relSpeed);
    applyDamage(a, dmg);
    applyDamage(b, dmg);
    // Rammers carry a payload — any cross-team contact detonates them. The
    // existing `runExplosions` pass picks up the dead rammer this same tick
    // and applies its `explodeRadius`/`explodeDamage` AOE (with chain
    // reactions). The client visual auto-fires from the death event.
    if (isUnit(a) && a.kind === "rammer") {
      a.shield = 0;
      a.hp = 0;
    }
    if (isUnit(b) && b.kind === "rammer") {
      b.shield = 0;
      b.hp = 0;
    }
    // Cross-team contact: each combatant's attacker is the other side's team.
    if (isPlayer(a)) lastAttackerByVictim.set(a.id, teamOf(b));
    if (isPlayer(b)) lastAttackerByVictim.set(b.id, teamOf(a));
  });
}

/**
 * Apply damage and credit the kill: any player victim records `attackerId`
 * as their most-recent attacker so cullAndRespawn can pay the bounty.
 * Non-player victims (units, structures) skip attribution since they
 * don't pay bounties.
 */
function damage(
  victim: Combatant,
  amount: number,
  attackerId: string | undefined,
  ctx: SimContext,
) {
  applyDamage(victim, amount);
  if (attackerId && isPlayer(victim)) {
    ctx.lastAttackerByVictim.set(victim.id, attackerId);
  }
}

/** Map an impact speed to HP damage, clamped between MIN and MAX. */
function impactDamage(speed: number): number {
  const raw = speed * COLLISION_DAMAGE_PER_SPEED;
  if (raw < COLLISION_DAMAGE_MIN) return COLLISION_DAMAGE_MIN;
  if (raw > COLLISION_DAMAGE_MAX) return COLLISION_DAMAGE_MAX;
  return raw;
}

/**
 * Per-tick mining pass. Each live miner whose target asteroid is within
 * mining reach drains `miningDps * TICK_DT` from that asteroid's HP and
 * tags `lastHitBy` with its owner. Contributions from concurrent miners
 * add linearly (each one applies its own slice every tick); the player
 * whose miner lands the killing tick takes the reward.
 *
 * "Reach" is the sum of the unit's contactRadius, the asteroid's radius,
 * and the kind's `miningReach` slack — so a drone parked just outside its
 * physical contact still chips the rock without needing to bounce.
 */
/**
 * Per-tick ranged-ability pass. Decrements every unit's `cooldown` clock;
 * for kinds with `abilityRange + abilityDamage` configured, fires once the
 * cooldown is ready and a live target is in range. Damage is applied via
 * `applyDamage` (drains shield first), and the cooldown jumps back to
 * `abilityCooldownSeconds` — the client treats that rising edge as a fire
 * event and renders a beam visual.
 */
function runUnitAbilities(state: ArenaState, ctx: SimContext) {
  for (const unit of state.units.values()) {
    let cooldown = ctx.unitCooldownById.get(unit.id) ?? 0;
    if (cooldown > 0) {
      cooldown = Math.max(0, cooldown - TICK_DT);
      ctx.unitCooldownById.set(unit.id, cooldown);
    }
    if (unit.hp <= 0) continue;
    if (unit.wreckageId || unit.deactivated) continue; // orphans + sleeping units don't fire
    const meta = UNIT_KIND_META[unit.kind];
    if (!meta) continue;
    const dmg = meta.abilityDamage ?? 0;
    const range = meta.abilityRange ?? 0;
    const cd = meta.abilityCooldownSeconds ?? 0;
    if (dmg <= 0 || range <= 0 || cd <= 0) continue;
    if (cooldown > 0) continue;
    if (!unit.targetId) continue;
    const target = lookupCombatant(state, unit.targetId);
    if (!target || target.hp <= 0) continue;
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    if (dx * dx + dy * dy > range * range) continue;

    if (meta.projectileSpeed && meta.projectileSpeed > 0) {
      const ownerColor = state.players.get(unit.ownerId)?.color ?? "#ffffff";
      spawnProjectile(
        state,
        ctx,
        { x: unit.x, y: unit.y, ownerId: unit.ownerId, color: ownerColor },
        target.x,
        target.y,
        meta.projectileSpeed,
        dmg,
        range,
      );
    } else {
      // Hitscan kinds with a turret-style aim delay can only fire when their
      // current rotation lines up with the target — otherwise the visual beam
      // would emerge from the side of the body. Cooldown stays at 0 so the
      // shot fires the instant the barrel finishes swinging into position.
      if (meta.rotationRateRadPerSec !== undefined) {
        const aimAngle = Math.atan2(dy, dx);
        if (Math.abs(shortestAngleDelta(unit.rotation, aimAngle)) > FIRE_ALIGNMENT_TOLERANCE) {
          continue;
        }
      }
      damage(target, dmg, unit.ownerId, ctx);
    }
    ctx.unitCooldownById.set(unit.id, cd);
    // Wrap to keep uint16 range; client only watches for "value increased"
    // so the rollover boundary doesn't matter.
    unit.fireCount = (unit.fireCount + 1) & 0xffff;
  }
}

/** Hitscan kinds with `rotationRateRadPerSec` only fire when their facing is
 *  within this many radians (~8.6°) of the target direction. */
const FIRE_ALIGNMENT_TOLERANCE = 0.15;

/**
 * Per-tick combat-structure pass. Each structure with `abilityRange +
 * abilityDamage + abilityCooldownSeconds` set acquires the nearest enemy
 * combatant in range (sticky to a small over-range so it doesn't twitch
 * between targets), faces it, and fires when the cooldown clears. Same
 * cooldown-rising-edge wire signal as units — the client renders a beam
 * from the structure's position to the target.
 */
function runStructureAbilities(state: ArenaState, ctx: SimContext) {
  for (const s of state.structures.values()) {
    let cooldown = ctx.structureCooldownById.get(s.id) ?? 0;
    if (cooldown > 0) {
      cooldown = Math.max(0, cooldown - TICK_DT);
      ctx.structureCooldownById.set(s.id, cooldown);
    }
    if (s.hp <= 0) continue;
    const meta = STRUCTURE_KIND_META[s.kind];
    if (!meta) continue;
    const dmg = meta.abilityDamage ?? 0;
    const range = meta.abilityRange ?? 0;
    const cd = meta.abilityCooldownSeconds ?? 0;
    if (dmg <= 0 || range <= 0 || cd <= 0) continue;

    let target: Combatant | null = null;
    if (s.targetId) {
      const held = lookupCombatant(state, s.targetId);
      if (
        held &&
        held.hp > 0 &&
        teamOf(held) !== s.ownerId &&
        Math.hypot(held.x - s.x, held.y - s.y) <= range * 1.1
      ) {
        target = held;
      }
    }
    if (!target) {
      target = gridNearestEnemy(ctx.grids.combatants, s.ownerId, s.x, s.y, range);
    }
    s.targetId = target ? target.id : "";

    if (target) {
      s.rotation = Math.atan2(target.y - s.y, target.x - s.x);
    }

    if (cooldown > 0) continue;
    if (!target) continue;
    const dx = target.x - s.x;
    const dy = target.y - s.y;
    if (dx * dx + dy * dy > range * range) continue;
    damage(target, dmg, s.ownerId, ctx);
    ctx.structureCooldownById.set(s.id, cd);
    s.fireCount = (s.fireCount + 1) & 0xffff;
  }
}

/** Build a projectile aimed from the unit's current position toward (tx, ty). */
function spawnProjectile(
  state: ArenaState,
  ctx: SimContext,
  unit: { x: number; y: number; ownerId: string; color: string },
  tx: number,
  ty: number,
  speed: number,
  damage: number,
  range: number,
) {
  // Hard cap on simultaneous projectiles. Drops the shot under sustained
  // gunner spam so the snapshot stream doesn't blow out — the firing unit's
  // cooldown still resets in the caller, so the next attempt fires once a
  // slot frees up.
  if (state.projectiles.size >= MAX_PROJECTILES_PER_ROOM) return;
  const dx = tx - unit.x;
  const dy = ty - unit.y;
  const dist = Math.hypot(dx, dy) || 1;
  const inv = 1 / dist;
  const p = new Projectile();
  p.id = ctx.allocProjectileId();
  p.ownerId = unit.ownerId;
  p.team = unit.ownerId;
  p.color = unit.color;
  p.x = Math.round(unit.x);
  p.y = Math.round(unit.y);
  p.vx = Math.round(dx * inv * speed);
  p.vy = Math.round(dy * inv * speed);
  p.damage = damage;
  // Lifetime = travel time at max range, plus a small grace so a shot fired
  // exactly at max range still has time to land before expiring mid-flight.
  p.expiresAt = state.serverTime + (range / speed) * 1000 + PROJECTILE_LIFETIME_GRACE_MS;
  state.projectiles.set(p.id, p);
}

/**
 * Per-tick fleet burn — every owned unit of a player who's currently
 * dashing eats `DASH_FLEET_BURN_DPS * TICK_DT` HP. Engine wash also burns
 * the player ship itself so sustained thrust eventually kills the captain
 * (~8s on a fresh 100 HP ship).
 *
 * Damage flows through `applyDamage` so shielders + repair drones can
 * actively offset the burn. Friendly AOE explosions on death don't
 * chain back into the player's own units (cross-team only) so a fleet
 * collapse doesn't cascade-wipe.
 */
function burnFleetWhileDashing(state: ArenaState) {
  const burning = new Set<string>();
  const dmg = DASH_FLEET_BURN_DPS * TICK_DT;
  for (const [id, p] of state.players) {
    if (!p.dashing || p.hp <= 0) continue;
    burning.add(id);
    applyDamage(p, dmg);
  }
  if (burning.size === 0) return;
  for (const u of state.units.values()) {
    if (u.hp <= 0) continue;
    if (!burning.has(u.ownerId)) continue;
    applyDamage(u, dmg);
  }
}

/**
 * Detonate any unit that hit 0 HP this tick, dealing AOE damage to enemies
 * within `meta.explodeRadius`. Chains: a kill from this pass that produces
 * a fresh dead unit triggers another sweep, so a stack of rammers can
 * cascade. Bounded by the unit count (each unit explodes at most once per
 * tick — tracked by an `exploded` set) so the loop always terminates.
 *
 * Friendly units are skipped — your own swarm doesn't kill itself when
 * one of your rammers pops.
 */
function runExplosions(state: ArenaState, ctx: SimContext) {
  const exploded = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const unit of state.units.values()) {
      if (unit.hp > 0) continue;
      if (exploded.has(unit.id)) continue;
      exploded.add(unit.id);
      const meta = UNIT_KIND_META[unit.kind];
      const radius = meta?.explodeRadius ?? 0;
      const dmg = meta?.explodeDamage ?? 0;
      if (radius <= 0 || dmg <= 0) continue;
      const radSq = radius * radius;
      const team = teamOf(unit);
      for (const c of allCombatants(state)) {
        if (c.id === unit.id) continue;
        if (c.hp <= 0) continue;
        if (teamOf(c) === team) continue;
        if (isNeutral(c)) continue;
        const dx = c.x - unit.x;
        const dy = c.y - unit.y;
        if (dx * dx + dy * dy > radSq) continue;
        damage(c, dmg, unit.ownerId, ctx);
      }
      progressed = true;
    }
  }
}

/**
 * Per-tick projectile pass. Advance by velocity, check overlap with any
 * non-friendly Combatant, and remove on hit / expiry / out-of-bounds.
 * Damage attribution flows through `lastAttackerByVictim` so a projectile
 * kill awards bounty to the firing unit's owner.
 */
function stepProjectiles(state: ArenaState, ctx: SimContext) {
  if (state.projectiles.size === 0) return;
  const now = state.serverTime;
  const removed: string[] = [];
  for (const [id, p] of state.projectiles) {
    if (now >= p.expiresAt) {
      removed.push(id);
      continue;
    }
    // Schema-bound x,y are int16 — round on update so projectiles only
    // dirty the schema field when their position visibly moves (every tick
    // for fast bullets, but no spurious sub-unit oscillation).
    p.x = Math.round(p.x + p.vx * TICK_DT);
    p.y = Math.round(p.y + p.vy * TICK_DT);
    if (p.x < 0 || p.x > WORLD_WIDTH || p.y < 0 || p.y > WORLD_HEIGHT) {
      removed.push(id);
      continue;
    }
    let hit = false;
    for (const c of allCombatants(state)) {
      if (c.hp <= 0) continue;
      if (teamOf(c) === p.team) continue;
      if (isNeutral(c)) continue;
      const r = contactRadiusOf(c) + PROJECTILE_RADIUS;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (dx * dx + dy * dy > r * r) continue;
      damage(c, p.damage, p.ownerId, ctx);
      hit = true;
      break;
    }
    if (hit) removed.push(id);
  }
  for (const id of removed) state.projectiles.delete(id);
}

/**
 * Per-tick shield aura pass. Each shielder (any unit kind with
 * `shieldGrant + shieldRegenPerSec + shieldRange` set) raises every friendly
 * combatant in range up to its `shieldGrant` cap, then refills shield by
 * `shieldRegenPerSec * TICK_DT`. The maxShield bump is sticky — once a
 * shielder visits, the ally retains the higher cap; only the active refill
 * stops when they're out of range. Multiple shielders raise the cap to the
 * highest grant present (not additive) but stack their regen rates.
 */
function runShieldAuras(state: ArenaState) {
  for (const shielder of state.units.values()) {
    if (shielder.hp <= 0) continue;
    if (shielder.wreckageId || shielder.deactivated) continue; // orphans + sleeping don't project
    const meta = UNIT_KIND_META[shielder.kind];
    const range = meta?.shieldRange ?? 0;
    const grant = meta?.shieldGrant ?? 0;
    const regen = meta?.shieldRegenPerSec ?? 0;
    if (range <= 0 || grant <= 0 || regen <= 0) continue;
    const radSq = range * range;
    const team = teamOf(shielder);
    for (const c of allCombatants(state)) {
      if (c.hp <= 0) continue;
      if (teamOf(c) !== team) continue;
      const dx = c.x - shielder.x;
      const dy = c.y - shielder.y;
      if (dx * dx + dy * dy > radSq) continue;
      if (c.maxShield < grant) c.maxShield = grant;
      if (c.shield < c.maxShield) {
        c.shield = Math.min(c.maxShield, c.shield + regen * TICK_DT);
      }
    }
  }
}

/**
 * Per-tick repair pass. For every unit with `repairHps + repairRange` set
 * and a friendly target in range, restore `repairHps * TICK_DT` HP capped
 * at maxHp. Multiple repair drones on one target stack linearly.
 */
function runRepairs(state: ArenaState) {
  for (const unit of state.units.values()) {
    if (unit.hp <= 0) continue;
    if (unit.wreckageId || unit.deactivated) continue; // orphans + sleeping don't heal
    if (!unit.targetId) continue;
    const meta = UNIT_KIND_META[unit.kind];
    const hps = meta?.repairHps ?? 0;
    const range = meta?.repairRange ?? 0;
    if (hps <= 0 || range <= 0) continue;
    const target =
      state.players.get(unit.targetId) ?? state.units.get(unit.targetId);
    if (!target) continue;
    if (target.hp <= 0 || target.hp >= target.maxHp) continue;
    if (teamOf(target) !== teamOf(unit)) continue;
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    if (dx * dx + dy * dy > range * range) continue;
    target.hp = Math.min(target.maxHp, target.hp + hps * TICK_DT);
  }
}

/**
 * Per-tick mining + income drip. Each miner attached to its target asteroid
 * (within reach) drains `dps * TICK_DT` HP and accrues
 * `damage * CREDITS_PER_ASTEROID_HP` fractional credits to the owner. The
 * room flushes integer parts of `creditAccrual` into player.credits each
 * tick — income is smooth and continuous, not gated on rock destruction.
 * Player ships also mine (weaker DPS) so a starting player without miners
 * can bootstrap an economy by parking on a rock.
 */
function mineAsteroids(state: ArenaState, creditAccrual: Map<string, number>) {
  for (const unit of state.units.values()) {
    if (unit.hp <= 0) continue;
    if (unit.wreckageId || unit.deactivated) continue; // orphans + sleeping don't extract
    if (!unit.targetId) continue;
    const meta = UNIT_KIND_META[unit.kind];
    const dps = meta?.miningDps ?? 0;
    if (dps <= 0) continue;
    const asteroid = state.asteroids.get(unit.targetId);
    if (!asteroid || asteroid.hp <= 0) continue;
    const reach = meta!.contactRadius + asteroid.radius + (meta!.miningReach ?? 0);
    const dx = asteroid.x - unit.x;
    const dy = asteroid.y - unit.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    const damage = Math.min(asteroid.hp, dps * TICK_DT);
    asteroid.hp = Math.max(0, asteroid.hp - damage);
    asteroid.lastHitBy = unit.ownerId;
    if (unit.ownerId) {
      const prev = creditAccrual.get(unit.ownerId) ?? 0;
      creditAccrual.set(unit.ownerId, prev + damage * CREDITS_PER_ASTEROID_HP);
    }
  }

  if (PLAYER_MINING_DPS <= 0) return;
  for (const [sessionId, player] of state.players) {
    if (player.hp <= 0) continue;
    for (const asteroid of state.asteroids.values()) {
      if (asteroid.hp <= 0) continue;
      const reach = PLAYER_CONTACT_RADIUS + asteroid.radius + PLAYER_MINING_REACH;
      const dx = asteroid.x - player.x;
      const dy = asteroid.y - player.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      const damage = Math.min(asteroid.hp, PLAYER_MINING_DPS * TICK_DT);
      asteroid.hp = Math.max(0, asteroid.hp - damage);
      asteroid.lastHitBy = sessionId;
      const prev = creditAccrual.get(sessionId) ?? 0;
      creditAccrual.set(sessionId, prev + damage * CREDITS_PER_ASTEROID_HP);
    }
  }
}

/**
 * Remove dead units + asteroids (and their bodies). Asteroid kills award
 * `resourceValue` credits to the lastHitBy player. Respawn dead players:
 * teleport their body to a fresh spawn, reset HP/shield, increment
 * deathCount (so clients fire FX), and drop all of their owned units.
 *
 * Returns the IDs of asteroids culled this tick so the room can schedule
 * replacements.
 */
/**
 * Per-tick wreckage claim + expiry. Any live player whose ship overlaps a
 * wreckage instantly inherits everything: credits added, every orphan unit
 * (i.e. unit.wreckageId === wid) ownership transfers and AI resumes
 * normally. Past `expiresAt`, an unclaimed wreckage despawns and its
 * orphan units are removed (with their bodies).
 */
function claimWreckages(
  state: ArenaState,
  bodyRefs: Map<string, BodyRef>,
  phys: PhysicsWorld,
) {
  if (state.wreckages.size === 0) return;
  const now = state.serverTime;
  const removed: string[] = [];

  for (const [wid, w] of state.wreckages) {
    if (now >= w.expiresAt) {
      for (const [uid, u] of state.units) {
        if (u.wreckageId !== wid) continue;
        const ref = bodyRefs.get(uid);
        if (ref) removeCombatantBody(phys, ref.body, ref.colliderHandle);
        bodyRefs.delete(uid);
        state.units.delete(uid);
      }
      removed.push(wid);
      continue;
    }

    let claimerId = "";
    let claimer: Player | null = null;
    const reach = PLAYER_CONTACT_RADIUS + w.halfSize;
    const reachSq = reach * reach;
    for (const [pid, p] of state.players) {
      if (p.hp <= 0) continue;
      const dx = p.x - w.x;
      const dy = p.y - w.y;
      if (dx * dx + dy * dy <= reachSq) {
        claimer = p;
        claimerId = pid;
        break;
      }
    }
    if (!claimer) continue;

    claimer.credits += w.credits;
    for (const u of state.units.values()) {
      if (u.wreckageId !== wid) continue;
      u.ownerId = claimerId;
      u.wreckageId = "";
      const meta = UNIT_KIND_META[u.kind];
      if (meta) claimer.supplyUsed += meta.supplyCost;
    }
    removed.push(wid);
  }

  for (const wid of removed) state.wreckages.delete(wid);
}

function cullAndRespawn(
  state: ArenaState,
  bodyRefs: Map<string, BodyRef>,
  phys: PhysicsWorld,
  ctx: SimContext,
): TickResult {
  const { lastAttackerByVictim, pendingRespawnSet } = ctx;
  const deadUnitIds: string[] = [];
  for (const [id, unit] of state.units) {
    if (unit.hp <= 0) deadUnitIds.push(id);
  }
  for (const id of deadUnitIds) {
    const unit = state.units.get(id)!;
    const owner = state.players.get(unit.ownerId);
    const cost = UNIT_KIND_META[unit.kind]?.supplyCost ?? 0;
    if (owner && cost > 0) {
      owner.supplyUsed = Math.max(0, owner.supplyUsed - cost);
    }
    const ref = bodyRefs.get(id);
    if (ref) removeCombatantBody(phys, ref.body, ref.colliderHandle);
    bodyRefs.delete(id);
    state.units.delete(id);
    ctx.unitCooldownById.delete(id);
  }

  // Destroyed structures → remove body + state, drop owner's supply cap by
  // the structure's contribution. Cap floor is 0; we don't compress below
  // the player's currently-used supply (existing units survive the cap loss
  // but new spawns gate on the lowered cap until units die).
  const deadStructures: string[] = [];
  for (const [id, s] of state.structures) {
    if (s.hp <= 0) deadStructures.push(id);
  }
  for (const id of deadStructures) {
    const s = state.structures.get(id)!;
    const meta = STRUCTURE_KIND_META[s.kind];
    if (meta && meta.supplyContribution > 0) {
      const owner = state.players.get(s.ownerId);
      if (owner) {
        owner.supplyCap = Math.max(0, owner.supplyCap - meta.supplyContribution);
      }
    }
    const ref = bodyRefs.get(id);
    if (ref) removeCombatantBody(phys, ref.body, ref.colliderHandle);
    bodyRefs.delete(id);
    state.structures.delete(id);
    ctx.structureCooldownById.delete(id);
  }

  // Mined-out asteroids → removed. Credit reward already streamed during
  // mining (see mineAsteroids); destruction itself awards nothing extra.
  const culledAsteroidIds: string[] = [];
  for (const [id, asteroid] of state.asteroids) {
    if (asteroid.hp > 0) continue;
    culledAsteroidIds.push(id);
    const ref = bodyRefs.get(id);
    if (ref) removeCombatantBody(phys, ref.body, ref.colliderHandle);
    bodyRefs.delete(id);
    state.asteroids.delete(id);
  }

  // Dead players: on the first dead-tick (signaled by hp<=0 + still having
  // owned units), spawn a wreckage holding the player's credits and orphan
  // every owned unit (they orbit the wreckage in formation, see runUnitAI).
  // Anyone touching the wreckage claims everything (see claimWreckages).
  // Until respawn requested via `"respawn"`, the player stays dead and the
  // client shows the RESPAWN button.
  for (const [id, player] of state.players) {
    if (player.hp > 0) continue;
    const ref = bodyRefs.get(id);
    if (!ref) continue;

    let needsWreckage = player.credits > 0;
    if (!needsWreckage) {
      for (const u of state.units.values()) {
        if (u.ownerId === id && !u.wreckageId) {
          needsWreckage = true;
          break;
        }
      }
    }
    if (needsWreckage) {
      const wid = ctx.allocWreckageId();
      const w = new Wreckage();
      w.id = wid;
      w.x = player.x;
      w.y = player.y;
      w.color = player.color;
      w.ownerName = player.name;
      w.credits = player.credits;
      w.halfSize = wreckageHalfSize(player.credits);
      w.expiresAt = state.serverTime + WRECKAGE_LIFETIME_MS;
      state.wreckages.set(wid, w);
      player.credits = 0;
      for (const u of state.units.values()) {
        if (u.ownerId === id && !u.wreckageId) {
          u.wreckageId = wid;
          u.targetId = "";
        }
      }
      lastAttackerByVictim.delete(id);
      player.supplyUsed = 0;
      player.dashing = false;
    }

    if (!pendingRespawnSet.has(id)) continue;
    pendingRespawnSet.delete(id);

    // Respawn at owned base if the player still has one — base is the
    // player's literal home. Falls back to world center when the base
    // has been lost (or first-spawn before any base is built).
    let baseAnchor: { x: number; y: number } | null = null;
    for (const s of state.structures.values()) {
      if (s.kind !== "base") continue;
      if (s.ownerId !== id) continue;
      if (s.hp <= 0) continue;
      baseAnchor = { x: s.x, y: s.y };
      break;
    }
    const baseX = baseAnchor?.x ?? WORLD_WIDTH / 2;
    const baseY = baseAnchor?.y ?? WORLD_HEIGHT / 2;
    const jitter = baseAnchor ? 100 : 600;
    const sx = baseX + (Math.random() - 0.5) * jitter;
    const sy = baseY + (Math.random() - 0.5) * jitter;
    ref.body.setTranslation({ x: sx, y: sy }, true);
    ref.body.setLinvel({ x: 0, y: 0 }, true);
    player.x = sx;
    player.y = sy;
    player.rotation = 0;
    player.hp = PLAYER_MAX_HP;
    player.shield = player.maxShield;
    player.deathCount++;
    let supplyOwned = 0;
    for (const s of state.structures.values()) {
      if (s.ownerId === id && s.kind === "supply") supplyOwned++;
    }
    player.credits = STARTING_CREDITS + supplyOwned;
  }

  return { culledAsteroidIds };
}

