import RAPIER from "@dimforge/rapier2d-compat";
import { Client, Room } from "colyseus";
import { StateView } from "@colyseus/schema";
import {
  AOI_HYSTERESIS_U,
  AOI_RADIUS_U,
  ASTEROID_COUNT,
  BASE_CLAIM_RADIUS_U,
  EMOTE_COOLDOWN_MS,
  EmoteMessage,
  isKnownEmote,
  SPAWN_BUBBLE_RADIUS_U,
  SPAWN_INVULN_MS,
  ASTEROID_MIN_SPACING,
  ASTEROID_RESPAWN_DELAY_MS,
  ASTEROID_SPAWN_MARGIN,
  ASTEROID_TIERS,
  AsteroidTier,
  ArenaState,
  Asteroid,
  BuildStructureMessage,
  CREDITS_PER_ASTEROID_HP,
  LeaderboardEntry,
  MAX_PLAYERS_PER_ROOM,
  MAX_STRUCTURES_PER_PLAYER,
  MAX_UNITS_PER_PLAYER,
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
import { createTickGrids } from "../spatial.js";

/** Width of the static perimeter walls in world units. */
const WALL_THICKNESS = 40;

export class ArenaRoom extends Room<ArenaState> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
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
  /** Per-player wall-clock time of last accepted emote. Drives the
   *  EMOTE_COOLDOWN_MS rate limit so a player can't spam the feed. */
  private lastEmoteAt = new Map<string, number>();
  /** Wall-clock timestamps at which a fresh asteroid should spawn. */
  private pendingAsteroidRespawnAt: number[] = [];
  /** Per-player Rapier collision-group bit (0..14). Drives the wall
   *  owner-passthrough filter — see physics.ts. Bits are recycled from
   *  the free pool on leave so a re-join doesn't exhaust the cap. */
  private ownerBitBySession = new Map<string, number>();
  /** Free-bit pool. `pop()` hands out the lowest bit first. Sized to
   *  MAX_PLAYERS_PER_ROOM so we always have one bit per connected client. */
  private freeOwnerBits: number[] = Array.from(
    { length: MAX_PLAYERS_PER_ROOM },
    (_, i) => MAX_PLAYERS_PER_ROOM - 1 - i,
  );
  /** Per-client previously-visible entity-id set. Used to apply hysteresis
   *  on AOI: an entity stays visible until it's past `AOI_RADIUS_U +
   *  AOI_HYSTERESIS_U` so units skating along the boundary don't pop in
   *  and out every few ticks. */
  private visibleByClient = new Map<string, Set<string>>();
  /** Mutable per-tick side tables threaded into `simulateTick`. */
  private simCtx: SimContext = {
    creditAccrual: new Map(),
    lastAttackerByVictim: new Map(),
    allocProjectileId: () => `r${++this.projectileCounter}`,
    allocWreckageId: () => `w${++this.wreckageCounter}`,
    pendingRespawnSet: new Set(),
    formationPhaseByOwner: new Map(),
    lastEntityPos: new Map(),
    grids: createTickGrids(),
    tickIndex: 0,
    unitCooldownById: new Map(),
    structureCooldownById: new Map(),
    ownerBitOf: (sessionId: string) => this.ownerBitBySession.get(sessionId),
    pendingEvents: [],
    lastBaseAlertAt: new Map(),
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
      // Hard per-player live-unit cap. Counts only non-orphan units so a
      // dead player's wreckage swarm doesn't block their respawn from
      // spawning fresh units. Spawn rate is rate-limited (≤4/sec/player),
      // so the walk cost is negligible.
      let owned = 0;
      for (const u of this.state.units.values()) {
        if (u.ownerId === client.sessionId && !u.wreckageId) owned++;
      }
      if (owned >= MAX_UNITS_PER_PLAYER) return;
      const now = performance.now();
      const last = this.lastUnitSpawnAt.get(client.sessionId) ?? 0;
      if (now - last < UNIT_SPAWN_COOLDOWN_MS) return;
      // Base-gated production: a player must own a live base before they
      // can spawn any unit. No base = no production. Losing your base is
      // a real setback — existing units stay, but you can't reinforce
      // them until you place a fresh base.
      const spawn = this.nearestOwnedBase(client.sessionId, player.x, player.y);
      if (!spawn) return;
      this.lastUnitSpawnAt.set(client.sessionId, now);
      player.credits -= meta.cost;
      player.supplyUsed += meta.supplyCost;
      this.spawnUnit(client.sessionId, kind, spawn.x, spawn.y);
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
      // Hard per-player structure cap + per-kind cap + reject stacking on
      // the same cell.
      let ownedStructures = 0;
      let ownedOfKind = 0;
      for (const s of this.state.structures.values()) {
        if (s.x === sx && s.y === sy) return;
        if (s.ownerId === client.sessionId) {
          ownedStructures++;
          if (s.kind === payload.kind) ownedOfKind++;
        }
      }
      if (ownedStructures >= MAX_STRUCTURES_PER_PLAYER) return;
      if (meta.maxPerPlayer !== undefined && ownedOfKind >= meta.maxPerPlayer) return;
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
      // No-build bubble around the world-center spawn point. Keeps
      // anyone from walling in the spawn zone or dropping a base on top
      // of it (which would let them base-camp respawning players).
      const cx = WORLD_WIDTH / 2;
      const cy = WORLD_HEIGHT / 2;
      const sdx = sx - cx;
      const sdy = sy - cy;
      if (sdx * sdx + sdy * sdy < SPAWN_BUBBLE_RADIUS_U * SPAWN_BUBBLE_RADIUS_U) return;
      // Base territorial claim: enemy bases within BASE_CLAIM_RADIUS_U
      // block any new placement here (your own base doesn't block — you
      // build freely inside your own territory). Existing structures
      // aren't affected by a fresh claim — only new placements are gated.
      const claimSq = BASE_CLAIM_RADIUS_U * BASE_CLAIM_RADIUS_U;
      for (const s of this.state.structures.values()) {
        if (s.kind !== "base") continue;
        if (s.ownerId === client.sessionId) continue;
        const dx = s.x - sx;
        const dy = s.y - sy;
        if (dx * dx + dy * dy < claimSq) return;
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
      this.simCtx.structureCooldownById.delete(payload.id);
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

    this.onMessage<EmoteMessage>("emote", (client, payload) => {
      if (!payload || !isKnownEmote(payload.emote)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return; // emoting while dead is fine — no hp gate
      const now = performance.now();
      const last = this.lastEmoteAt.get(client.sessionId) ?? 0;
      if (now - last < EMOTE_COOLDOWN_MS) return;
      this.lastEmoteAt.set(client.sessionId, now);
      // Broadcast directly (no need to route through pendingEvents — this
      // isn't tied to a sim tick). Same channel as other GameEvents.
      this.broadcast("event", {
        kind: "emote" as const,
        senderId: client.sessionId,
        senderName: player.name,
        senderColor: player.color,
        emote: payload.emote,
      });
    });

    console.log(`[ArenaRoom ${this.roomId}] created`);
  }

  private spawnUnit(ownerId: string, kind: string, x: number, y: number) {
    const meta = UNIT_KIND_META[kind];
    if (!meta) return;

    const unit = new Unit();
    unit.id = `u${++this.unitCounter}`;
    unit.ownerId = ownerId;
    unit.kind = kind;
    unit.x = x;
    unit.y = y;
    unit.hp = meta.maxHp;
    unit.maxHp = meta.maxHp;
    unit.shield = meta.maxShield;
    unit.maxShield = meta.maxShield;
    unit.targetId = "";
    unit.slotIndex = this.allocSlot(ownerId);
    this.state.units.set(unit.id, unit);

    const ref = addCombatantBody(this.physics, {
      entityId: unit.id,
      x,
      y,
      radius: meta.contactRadius,
      ownerBit: this.ownerBitBySession.get(ownerId),
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
    // Fresh ship is invulnerable for SPAWN_INVULN_MS so the new player
    // has time to drop their base + first miners without being insta-
    // killed at spawn. Same window applies on respawn (cullAndRespawn).
    player.invulnerableUntil = this.state.serverTime + SPAWN_INVULN_MS;
    player.supplyCap = STARTING_SUPPLY_CAP;
    player.supplyUsed = 0;
    this.colorCursor++;

    this.state.players.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);
    // Allocate this player's owner-bit for wall passthrough — must happen
    // BEFORE the player ship body is created so the ship's collision
    // group is set correctly on its first tick.
    const ownerBit = this.freeOwnerBits.pop();
    if (ownerBit !== undefined) {
      this.ownerBitBySession.set(client.sessionId, ownerBit);
    }
    // Per-client view: every entity map in ArenaState is view-filtered, so
    // without a view the client receives nothing. recomputeViews() in the
    // tick loop populates it with everything inside AOI of this player's
    // ship plus their own owned entities.
    client.view = new StateView();
    this.visibleByClient.set(client.sessionId, new Set());

    const ref = addCombatantBody(this.physics, {
      entityId: client.sessionId,
      x: spawnX,
      y: spawnY,
      radius: PLAYER_CONTACT_RADIUS,
      // Heavy ship: collisions with units mostly shove the unit aside, so
      // the player can dash through their own swarm without stalling.
      density: 12,
      ownerBit,
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
    this.state.leaderboard.delete(client.sessionId);
    this.inputQueues.delete(client.sessionId);
    this.lastUnitSpawnAt.delete(client.sessionId);
    this.lastEmoteAt.delete(client.sessionId);
    this.visibleByClient.delete(client.sessionId);
    // Recycle the leaver's owner-bit so a future join can take it. The
    // leaver's walls / units / ship are torn down below, so no live body
    // still references this bit by the time we hand it out again.
    const leaverBit = this.ownerBitBySession.get(client.sessionId);
    if (leaverBit !== undefined) {
      this.ownerBitBySession.delete(client.sessionId);
      this.freeOwnerBits.push(leaverBit);
    }
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
      this.simCtx.unitCooldownById.delete(id);
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
      this.simCtx.structureCooldownById.delete(id);
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
    this.recomputeLeaderboard();
    this.recomputeViews();
    // Drain GameEvents emitted this tick. Most go via room.broadcast()
    // (kills, emotes); events with `targetSessionId` set route to a
    // single client (base-attack alerts) so spectators don't see "X's
    // base under attack" in their feed.
    if (result.events.length > 0) {
      for (const tev of result.events) {
        if (tev.targetSessionId) {
          const client = this.clients.find(
            (c) => c.sessionId === tev.targetSessionId,
          );
          if (client) client.send("event", tev.event);
        } else {
          this.broadcast("event", tev.event);
        }
      }
    }
  }

  /**
   * Refresh the leaderboard MapSchema from authoritative state. Runs every
   * tick — it's small (≤ MAX_PLAYERS_PER_ROOM entries) and clients use it
   * for the rank list and minimap legends, neither of which can derive
   * counts from the AOI-filtered units map.
   */
  private recomputeLeaderboard() {
    const unitCounts = new Map<string, number>();
    for (const u of this.state.units.values()) {
      if (u.wreckageId) continue;
      unitCounts.set(u.ownerId, (unitCounts.get(u.ownerId) ?? 0) + 1);
    }
    for (const [sessionId, player] of this.state.players) {
      let entry = this.state.leaderboard.get(sessionId);
      if (!entry) {
        entry = new LeaderboardEntry();
        entry.id = sessionId;
        this.state.leaderboard.set(sessionId, entry);
      }
      // Only assign when changed — Colyseus dirty-tracking is field-level,
      // and most ticks only `unitCount` shifts. Skipping no-op writes keeps
      // the patch stream small.
      if (entry.name !== player.name) entry.name = player.name;
      if (entry.color !== player.color) entry.color = player.color;
      if (entry.deathCount !== player.deathCount) entry.deathCount = player.deathCount;
      const isDead = player.hp <= 0;
      if (entry.isDead !== isDead) entry.isDead = isDead;
      const count = unitCounts.get(sessionId) ?? 0;
      if (entry.unitCount !== count) entry.unitCount = count;
    }
  }

  /**
   * Per-client AOI: walk every connected client, compute which entities lie
   * within `AOI_RADIUS_U` of their ship (with a small hysteresis band so
   * boundary-skating entities don't flicker), and update the client's
   * StateView accordingly. Entities outside the view aren't encoded into
   * that client's snapshot patches.
   *
   * Always-visible: the client's own ship, owned units, and owned structures
   * (so the camera entourage doesn't pop in/out as the ship moves).
   */
  private recomputeViews() {
    const grids = this.simCtx.grids;
    const radius = AOI_RADIUS_U;
    const radiusSq = radius * radius;
    const outerSq = (radius + AOI_HYSTERESIS_U) * (radius + AOI_HYSTERESIS_U);

    for (const client of this.clients) {
      const view = client.view;
      if (!view) continue;
      const sessionId = client.sessionId;
      const player = this.state.players.get(sessionId);
      if (!player) continue;

      const prev = this.visibleByClient.get(sessionId) ?? new Set<string>();
      const next = new Set<string>();

      // Own player + own units + own structures are always visible.
      view.add(player);
      next.add(sessionId);
      for (const u of this.state.units.values()) {
        if (u.ownerId !== sessionId) continue;
        if (!prev.has(u.id)) view.add(u);
        next.add(u.id);
      }
      for (const s of this.state.structures.values()) {
        if (s.ownerId !== sessionId) continue;
        if (!prev.has(s.id)) view.add(s);
        next.add(s.id);
      }

      // Other entities — gated on AOI radius. Hysteresis: an entity that
      // was visible last tick stays visible until it crosses the outer
      // band. We query at outer radius and re-check below.
      grids.combatants.forEachInRadius(player.x, player.y, radius + AOI_HYSTERESIS_U, (c) => {
        if (next.has(c.id)) return;
        const dx = c.x - player.x;
        const dy = c.y - player.y;
        const d2 = dx * dx + dy * dy;
        const wasVisible = prev.has(c.id);
        const visible = wasVisible ? d2 <= outerSq : d2 <= radiusSq;
        if (!visible) return;
        if (!wasVisible) view.add(c);
        next.add(c.id);
      });

      // Asteroids: same AOI gate, simpler (no team filter).
      grids.asteroids.forEachInRadius(player.x, player.y, radius + AOI_HYSTERESIS_U, (a) => {
        if (next.has(a.id)) return;
        const dx = a.x - player.x;
        const dy = a.y - player.y;
        const d2 = dx * dx + dy * dy;
        const wasVisible = prev.has(a.id);
        const visible = wasVisible ? d2 <= outerSq : d2 <= radiusSq;
        if (!visible) return;
        if (!wasVisible) view.add(a);
        next.add(a.id);
      });

      // Projectiles + wreckages aren't in the spatial grid (transient /
      // sparse). Linear walk — projectile cap is small (~600) so this stays
      // cheap; a dedicated grid is overkill at this scale.
      for (const [id, p] of this.state.projectiles) {
        if (next.has(id)) continue;
        const dx = p.x - player.x;
        const dy = p.y - player.y;
        const d2 = dx * dx + dy * dy;
        const wasVisible = prev.has(id);
        const visible = wasVisible ? d2 <= outerSq : d2 <= radiusSq;
        if (!visible) continue;
        if (!wasVisible) view.add(p);
        next.add(id);
      }
      for (const [id, w] of this.state.wreckages) {
        if (next.has(id)) continue;
        const dx = w.x - player.x;
        const dy = w.y - player.y;
        const d2 = dx * dx + dy * dy;
        const wasVisible = prev.has(id);
        const visible = wasVisible ? d2 <= outerSq : d2 <= radiusSq;
        if (!visible) continue;
        if (!wasVisible) view.add(w);
        next.add(id);
      }

      // Anything that was visible last tick but isn't this tick — remove
      // from the view. The `next` set is authoritative for this tick.
      for (const id of prev) {
        if (next.has(id)) continue;
        const ent =
          this.state.players.get(id) ??
          this.state.units.get(id) ??
          this.state.structures.get(id) ??
          this.state.asteroids.get(id) ??
          this.state.projectiles.get(id) ??
          this.state.wreckages.get(id);
        if (ent) view.remove(ent);
      }
      this.visibleByClient.set(sessionId, next);
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
    asteroid.x = Math.round(x);
    asteroid.y = Math.round(y);
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
      shape: meta.colliderShape ?? "ball",
      // Walls (cuboid) get owner-passthrough — owner's units/ship/projectiles
      // pass through their own walls. Other structure shapes ignore this.
      ownerBit: this.ownerBitBySession.get(ownerId),
    });
    this.bodyRefs.set(s.id, ref);
  }

  /**
   * Lookup for the spawn-at-base rule. Bases are capped at 1 per player
   * so this is at most a single match, but the loop tolerates future
   * relaxation of that cap.
   */
  private nearestOwnedBase(
    ownerId: string,
    x: number,
    y: number,
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD2 = Infinity;
    for (const s of this.state.structures.values()) {
      if (s.kind !== "base") continue;
      if (s.ownerId !== ownerId) continue;
      if (s.hp <= 0) continue;
      const dx = s.x - x;
      const dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { x: s.x, y: s.y };
      }
    }
    return best;
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
