import RAPIER from "@dimforge/rapier2d-compat";
import { Client, Room } from "colyseus";
import {
  ASTEROID_COUNT,
  ASTEROID_MIN_SPACING,
  ASTEROID_RESPAWN_DELAY_MS,
  ASTEROID_SPAWN_MARGIN,
  ASTEROID_TIERS,
  AsteroidTier,
  ArenaState,
  Asteroid,
  BuildStructureMessage,
  CREDITS_PER_ASTEROID_HP,
  RecycleStructureMessage,
  structureRecycleRefund,
  PLAYER_COLORS,
  PLAYER_CONTACT_RADIUS,
  PLAYER_MAX_HP,
  Player,
  PlayerInput,
  SNAPSHOT_RATE_HZ,
  STARTING_CREDITS,
  STARTING_SUPPLY_CAP,
  STRUCTURE_KIND_META,
  SpawnUnitMessage,
  Structure,
  TICK_RATE_HZ,
  UNIT_KIND_META,
  UNIT_SPAWN_COOLDOWN_MS,
  Unit,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  isKnownKind,
  isKnownStructureKind,
  snapToGrid,
} from "@openspace/shared";
import {
  addAsteroidBody,
  addCombatantBody,
  addStructureBody,
  createPhysicsWorld,
  disposePhysicsWorld,
  initPhysics,
  PhysicsWorld,
  removeCombatantBody,
  WALL_ENTITY_ID,
} from "../physics.js";
import { BodyRef, SimContext, simulateTick } from "../simulation.js";

/** Width of the static perimeter walls in world units. */
const WALL_THICKNESS = 40;

export class ArenaRoom extends Room<ArenaState> {
  override state = new ArenaState();
  private physics!: PhysicsWorld;
  private bodyRefs = new Map<string, BodyRef>();
  private inputQueues = new Map<string, PlayerInput[]>();
  private colorCursor = 0;
  private unitCounter = 0;
  private asteroidCounter = 0;
  private projectileCounter = 0;
  private structureCounter = 0;
  private wreckageCounter = 0;
  private lastUnitSpawnAt = new Map<string, number>();
  /** Wall-clock timestamps at which a fresh asteroid should spawn. */
  private pendingAsteroidRespawnAt: number[] = [];
  /** Mutable per-tick side tables threaded into `simulateTick`. */
  private simCtx: SimContext = {
    creditAccrual: new Map(),
    lastAttackerByVictim: new Map(),
    allocProjectileId: () => `r${++this.projectileCounter}`,
    allocWreckageId: () => `w${++this.wreckageCounter}`,
    pendingRespawnSet: new Set(),
    formationPhaseByOwner: new Map(),
    lastEntityPos: new Map(),
  };

  override async onCreate() {
    await initPhysics();
    this.physics = createPhysicsWorld();
    this.buildWorldWalls();
    for (let i = 0; i < ASTEROID_COUNT; i++) this.spawnAsteroid();

    this.setSimulationInterval(() => this.update(), 1000 / TICK_RATE_HZ);
    this.setPatchRate(1000 / SNAPSHOT_RATE_HZ);

    this.onMessage<PlayerInput>("input", (client, payload) => {
      if (!isValidInput(payload)) return;
      const queue = this.inputQueues.get(client.sessionId);
      if (!queue) return;
      const player = this.state.players.get(client.sessionId);
      if (player && payload.seq <= player.lastProcessedInputSeq) return;
      queue.push(payload);
    });

    this.onMessage<SpawnUnitMessage>("spawn-unit", (client, payload) => {
      const kind = payload?.kind ?? "rammer";
      if (!isKnownKind(kind)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const meta = UNIT_KIND_META[kind];
      if (!meta) return;
      if (player.credits < meta.cost) return;
      if (player.supplyUsed + meta.supplyCost > player.supplyCap) return;
      const now = performance.now();
      const last = this.lastUnitSpawnAt.get(client.sessionId) ?? 0;
      if (now - last < UNIT_SPAWN_COOLDOWN_MS) return;
      this.lastUnitSpawnAt.set(client.sessionId, now);
      player.credits -= meta.cost;
      player.supplyUsed += meta.supplyCost;
      this.spawnUnit(client.sessionId, kind, player.x, player.y, player.color);
    });

    this.onMessage<BuildStructureMessage>("build-structure", (client, payload) => {
      if (!payload || !isKnownStructureKind(payload.kind)) return;
      if (typeof payload.x !== "number" || typeof payload.y !== "number") return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const meta = STRUCTURE_KIND_META[payload.kind]!;
      if (player.credits < meta.cost) return;
      const sx = snapToGrid(payload.x);
      const sy = snapToGrid(payload.y);
      if (sx <= 0 || sx >= WORLD_WIDTH || sy <= 0 || sy >= WORLD_HEIGHT) return;
      // Reject stacking another structure on the exact same cell.
      for (const s of this.state.structures.values()) {
        if (s.x === sx && s.y === sy) return;
      }
      // Reject placement that would trap a live player ship inside the
      // structure's collider — Rapier can't push a body out of a fixed body
      // it's spawned inside, so the ship would jitter against the wall every
      // tick (and the camera with it) until the player escapes manually.
      const playerReach = meta.halfExtent + PLAYER_CONTACT_RADIUS;
      const playerReachSq = playerReach * playerReach;
      for (const p of this.state.players.values()) {
        if (p.hp <= 0) continue;
        const dx = p.x - sx;
        const dy = p.y - sy;
        if (dx * dx + dy * dy < playerReachSq) return;
      }
      player.credits -= meta.cost;
      this.spawnStructure(client.sessionId, payload.kind, sx, sy, player.color);
      player.supplyCap += meta.supplyContribution;
    });

    this.onMessage<RecycleStructureMessage>("recycle-structure", (client, payload) => {
      if (!payload || typeof payload.id !== "string") return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      const structure = this.state.structures.get(payload.id);
      if (!structure || structure.ownerId !== client.sessionId) return;
      const meta = STRUCTURE_KIND_META[structure.kind];
      if (!meta) return;
      const refund = structureRecycleRefund(
        meta.cost,
        structure.maxHp > 0 ? structure.hp / structure.maxHp : 0,
      );
      player.credits += refund;
      player.supplyCap = Math.max(0, player.supplyCap - meta.supplyContribution);
      const ref = this.bodyRefs.get(payload.id);
      if (ref) removeCombatantBody(this.physics, ref.body, ref.colliderHandle);
      this.bodyRefs.delete(payload.id);
      this.state.structures.delete(payload.id);
    });

    this.onMessage("respawn", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;
      this.simCtx.pendingRespawnSet.add(client.sessionId);
    });

    this.onMessage("recall", (client) => {
      // Drop every owned unit's chase target so they all head back to
      // formation around the owner. Per-tick AI re-acquires next frame
      // if an enemy is still in aggro range, but the moment of reset
      // gives the player a "regroup now" tactical lever.
      for (const u of this.state.units.values()) {
        if (u.ownerId === client.sessionId) u.targetId = "";
      }
    });

    this.onMessage("dash-start", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp <= 0) return;
      player.dashing = true;
    });

    this.onMessage("dash-end", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.dashing = false;
    });

    console.log(`[ArenaRoom ${this.roomId}] created`);
  }

  private spawnUnit(
    ownerId: string,
    kind: string,
    x: number,
    y: number,
    color: string,
  ) {
    const meta = UNIT_KIND_META[kind];
    if (!meta) return;

    const unit = new Unit();
    unit.id = `u${++this.unitCounter}`;
    unit.ownerId = ownerId;
    unit.color = color;
    unit.kind = kind;
    unit.x = x;
    unit.y = y;
    unit.hp = meta.maxHp;
    unit.maxHp = meta.maxHp;
    unit.shield = meta.maxShield;
    unit.maxShield = meta.maxShield;
    unit.cooldown = 0;
    unit.targetId = "";
    unit.slotIndex = this.allocSlot(ownerId);
    this.state.units.set(unit.id, unit);

    const ref = addCombatantBody(this.physics, {
      entityId: unit.id,
      x,
      y,
      radius: meta.contactRadius,
    });
    this.bodyRefs.set(unit.id, ref);
  }

  override onJoin(client: Client, options?: { name?: unknown }) {
    const spawnX = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 200;
    const spawnY = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 200;

    const player = new Player();
    player.id = client.sessionId;
    player.name = sanitizeName(options?.name, this.colorCursor);
    player.x = spawnX;
    player.y = spawnY;
    player.rotation = 0;
    player.color = PLAYER_COLORS[this.colorCursor % PLAYER_COLORS.length] ?? "#ffffff";
    player.hp = PLAYER_MAX_HP;
    player.maxHp = PLAYER_MAX_HP;
    player.credits = STARTING_CREDITS;
    player.supplyCap = STARTING_SUPPLY_CAP;
    player.supplyUsed = 0;
    this.colorCursor++;

    this.state.players.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);

    const ref = addCombatantBody(this.physics, {
      entityId: client.sessionId,
      x: spawnX,
      y: spawnY,
      radius: PLAYER_CONTACT_RADIUS,
      // Heavy ship: collisions with units mostly shove the unit aside, so
      // the player can dash through their own swarm without stalling.
      density: 12,
    });
    this.bodyRefs.set(client.sessionId, ref);

    console.log(`[ArenaRoom] join ${client.sessionId} name=${player.name} color=${player.color}`);
  }

  override onLeave(client: Client) {
    const playerRef = this.bodyRefs.get(client.sessionId);
    if (playerRef) {
      removeCombatantBody(this.physics, playerRef.body, playerRef.colliderHandle);
      this.bodyRefs.delete(client.sessionId);
    }
    this.state.players.delete(client.sessionId);
    this.inputQueues.delete(client.sessionId);
    this.lastUnitSpawnAt.delete(client.sessionId);
    this.simCtx.creditAccrual.delete(client.sessionId);
    this.simCtx.lastAttackerByVictim.delete(client.sessionId);
    this.simCtx.pendingRespawnSet.delete(client.sessionId);
    // Also drop any entries where the leaver was the attacker — stale references.
    for (const [victimId, attackerId] of this.simCtx.lastAttackerByVictim) {
      if (attackerId === client.sessionId) this.simCtx.lastAttackerByVictim.delete(victimId);
    }

    // Remove every unit owned by the leaving player + their physics bodies.
    const owned: string[] = [];
    for (const [id, unit] of this.state.units) {
      if (unit.ownerId === client.sessionId) owned.push(id);
    }
    for (const id of owned) {
      const ref = this.bodyRefs.get(id);
      if (ref) removeCombatantBody(this.physics, ref.body, ref.colliderHandle);
      this.bodyRefs.delete(id);
      this.state.units.delete(id);
    }

    // Tear down any structures the leaver placed.
    const ownedStructures: string[] = [];
    for (const [id, s] of this.state.structures) {
      if (s.ownerId === client.sessionId) ownedStructures.push(id);
    }
    for (const id of ownedStructures) {
      const ref = this.bodyRefs.get(id);
      if (ref) removeCombatantBody(this.physics, ref.body, ref.colliderHandle);
      this.bodyRefs.delete(id);
      this.state.structures.delete(id);
    }

    console.log(`[ArenaRoom] leave ${client.sessionId}`);
  }

  override onDispose() {
    if (this.physics) disposePhysicsWorld(this.physics);
    this.bodyRefs.clear();
    console.log(`[ArenaRoom ${this.roomId}] disposed`);
  }

  private update() {
    const now = performance.now();
    this.state.serverTime = now;
    const result = simulateTick(
      this.state,
      this.inputQueues,
      this.bodyRefs,
      this.physics,
      this.simCtx,
    );
    for (let i = 0; i < result.culledAsteroidIds.length; i++) {
      this.pendingAsteroidRespawnAt.push(now + ASTEROID_RESPAWN_DELAY_MS);
    }
    // Flush whole-credit parts from the accrual map onto player.credits.
    // Fractional remainder stays in the accumulator until it crosses 1.
    for (const [sessionId, accrued] of this.simCtx.creditAccrual) {
      if (accrued < 1) continue;
      const whole = Math.floor(accrued);
      this.simCtx.creditAccrual.set(sessionId, accrued - whole);
      const player = this.state.players.get(sessionId);
      if (player) player.credits += whole;
    }
    if (this.pendingAsteroidRespawnAt.length > 0) {
      // Drain any that are due. Order doesn't matter — each entry is just
      // a "spawn one fresh asteroid now" cue.
      let kept: number[] | null = null;
      for (let i = 0; i < this.pendingAsteroidRespawnAt.length; i++) {
        const due = this.pendingAsteroidRespawnAt[i]!;
        if (due <= now) {
          this.spawnAsteroid();
        } else {
          (kept ??= []).push(due);
        }
      }
      this.pendingAsteroidRespawnAt = kept ?? [];
    }
  }

  /**
   * Pick a position not too close to any existing asteroid or player and
   * drop a fresh asteroid there. Bails after a few attempts (the field
   * just stays one short for a tick — next cull adds another respawn cue).
   */
  private spawnAsteroid() {
    const tier = pickAsteroidTier();
    const lo = ASTEROID_SPAWN_MARGIN + tier.radius;
    const hiX = WORLD_WIDTH - ASTEROID_SPAWN_MARGIN - tier.radius;
    const hiY = WORLD_HEIGHT - ASTEROID_SPAWN_MARGIN - tier.radius;
    let x = 0;
    let y = 0;
    let placed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      x = lo + Math.random() * (hiX - lo);
      y = lo + Math.random() * (hiY - lo);
      if (this.isAsteroidPlacementClear(x, y, tier.radius)) {
        placed = true;
        break;
      }
    }
    if (!placed) return;

    const asteroid = new Asteroid();
    asteroid.id = `a${++this.asteroidCounter}`;
    asteroid.x = x;
    asteroid.y = y;
    asteroid.radius = tier.radius;
    asteroid.hp = tier.hp;
    asteroid.maxHp = tier.hp;
    asteroid.resourceValue = Math.round(tier.hp * CREDITS_PER_ASTEROID_HP);
    asteroid.lastHitBy = "";
    this.state.asteroids.set(asteroid.id, asteroid);

    const ref = addAsteroidBody(this.physics, {
      entityId: asteroid.id,
      x,
      y,
      radius: tier.radius,
    });
    this.bodyRefs.set(asteroid.id, ref);
  }

  private spawnStructure(
    ownerId: string,
    kind: string,
    x: number,
    y: number,
    color: string,
  ) {
    const meta = STRUCTURE_KIND_META[kind];
    if (!meta) return;
    const s = new Structure();
    s.id = `s${++this.structureCounter}`;
    s.ownerId = ownerId;
    s.kind = kind;
    s.color = color;
    s.x = x;
    s.y = y;
    s.hp = meta.hp;
    s.maxHp = meta.hp;
    s.contactRadius = meta.halfExtent;
    this.state.structures.set(s.id, s);

    const ref = addStructureBody(this.physics, {
      entityId: s.id,
      x,
      y,
      radius: meta.halfExtent,
    });
    this.bodyRefs.set(s.id, ref);
  }

  /**
   * Lowest unused formation slot for `ownerId`. Walks the owner's live units
   * and finds the first non-taken integer ≥ 0. Stable per-unit: when one
   * dies its slot frees up and the next spawn fills the gap, so survivors
   * keep their stations instead of reshuffling.
   */
  private allocSlot(ownerId: string): number {
    const taken = new Set<number>();
    for (const u of this.state.units.values()) {
      if (u.ownerId === ownerId) taken.add(u.slotIndex);
    }
    for (let i = 0; ; i++) {
      if (!taken.has(i)) return i;
    }
  }

  private isAsteroidPlacementClear(x: number, y: number, radius: number): boolean {
    // ASTEROID_MIN_SPACING is the minimum *gap* between rock surfaces
    // (and between any rock surface and a player). Adding the candidate's
    // radius + the existing rock's radius keeps giants from overlapping.
    for (const a of this.state.asteroids.values()) {
      if (Math.hypot(a.x - x, a.y - y) < radius + a.radius + ASTEROID_MIN_SPACING) return false;
    }
    for (const p of this.state.players.values()) {
      if (Math.hypot(p.x - x, p.y - y) < radius + ASTEROID_MIN_SPACING) return false;
    }
    return true;
  }

  /**
   * Place 4 fixed-body cuboid walls just outside the world rectangle so
   * dynamic bodies can't escape.
   */
  private buildWorldWalls() {
    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;
    const t = WALL_THICKNESS;
    const walls = [
      // top
      { x: w / 2, y: -t / 2, hw: w / 2 + t, hh: t / 2 },
      // bottom
      { x: w / 2, y: h + t / 2, hw: w / 2 + t, hh: t / 2 },
      // left
      { x: -t / 2, y: h / 2, hw: t / 2, hh: h / 2 + t },
      // right
      { x: w + t / 2, y: h / 2, hw: t / 2, hh: h / 2 + t },
    ];
    for (const wall of walls) {
      const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, wall.y);
      const body = this.physics.world.createRigidBody(desc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(wall.hw, wall.hh)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.physics.world.createCollider(colliderDesc, body);
      this.physics.handleMap.set(collider.handle, WALL_ENTITY_ID);
    }
  }
}

/**
 * Cap and trim a join-time name. Empty / non-string falls back to
 * "Player <colorCursor>" so every player has a readable identifier.
 */
function sanitizeName(raw: unknown, fallbackIndex: number): string {
  if (typeof raw !== "string") return `Player ${fallbackIndex + 1}`;
  const trimmed = raw.trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : `Player ${fallbackIndex + 1}`;
}

function isValidInput(p: unknown): p is PlayerInput {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.seq === "number" &&
    typeof o.targetX === "number" &&
    typeof o.targetY === "number"
  );
}

/** Weighted random pick from `ASTEROID_TIERS` using each tier's `weight`. */
function pickAsteroidTier(): AsteroidTier {
  const total = ASTEROID_TIERS.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * total;
  for (const tier of ASTEROID_TIERS) {
    roll -= tier.weight;
    if (roll <= 0) return tier;
  }
  return ASTEROID_TIERS[ASTEROID_TIERS.length - 1]!;
}
