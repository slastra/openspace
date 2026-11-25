/**
 * Headless room scaffolding for simulation tests: a Rapier world, an
 * ArenaState, and a SimContext wired the way ArenaRoom wires them, without
 * Colyseus. Only imported by *.test.ts files.
 */
import {
  ArenaState,
  PLAYER_CONTACT_RADIUS,
  PLAYER_MAX_HP,
  Player,
  PlayerInput,
  STRUCTURE_KIND_META,
  Structure,
  TICK_MS,
  UNIT_KIND_META,
  Unit,
} from "@openspace/shared";
import {
  PhysicsWorld,
  addCombatantBody,
  addStructureBody,
  createPhysicsWorld,
  initPhysics,
} from "./physics.js";
import { BodyRef, SimContext, simulateTick } from "./simulation.js";
import { createTickGrids } from "./spatial.js";

export interface TestWorld {
  state: ArenaState;
  phys: PhysicsWorld;
  bodyRefs: Map<string, BodyRef>;
  inputQueues: Map<string, PlayerInput[]>;
  ctx: SimContext;
  ownerBits: Map<string, number>;
  addPlayer(id: string, x: number, y: number): Player;
  addUnit(ownerId: string, kind: string, x: number, y: number): Unit;
  addStructure(ownerId: string, kind: string, x: number, y: number): Structure;
  /** Queue an input for `playerId` with the next sequence number. */
  pushInput(playerId: string, targetX: number, targetY: number): PlayerInput;
  tick(): void;
}

export async function createTestWorld(): Promise<TestWorld> {
  await initPhysics();
  const phys = createPhysicsWorld();
  const state = new ArenaState();
  const bodyRefs = new Map<string, BodyRef>();
  const inputQueues = new Map<string, PlayerInput[]>();
  const ownerBits = new Map<string, number>();
  const seqs = new Map<string, number>();
  let counter = 0;
  let tickCount = 0;
  const ctx: SimContext = {
    creditAccrual: new Map(),
    lastAttackerByVictim: new Map(),
    allocProjectileId: () => `p${++counter}`,
    allocWreckageId: () => `w${++counter}`,
    pendingRespawnSet: new Set(),
    formations: new Map(),
    lastEntityPos: new Map(),
    inputCursors: new Map(),
    grids: createTickGrids(),
    tickIndex: 0,
    unitCooldownById: new Map(),
    structureCooldownById: new Map(),
    ownerBitOf: (id) => ownerBits.get(id),
    pendingEvents: [],
    lastBaseAlertAt: new Map(),
  };

  const world: TestWorld = {
    state,
    phys,
    bodyRefs,
    inputQueues,
    ctx,
    ownerBits,
    addPlayer(id, x, y) {
      const p = new Player();
      p.id = id;
      p.name = id;
      p.color = "#ffffff";
      p.x = x;
      p.y = y;
      p.hp = PLAYER_MAX_HP;
      p.maxHp = PLAYER_MAX_HP;
      p.supplyCap = 10_000;
      state.players.set(id, p);
      inputQueues.set(id, []);
      const bit = ownerBits.size;
      ownerBits.set(id, bit);
      bodyRefs.set(
        id,
        addCombatantBody(phys, {
          entityId: id,
          x,
          y,
          radius: PLAYER_CONTACT_RADIUS,
          density: 12,
          ownerBit: bit,
        }),
      );
      return p;
    },
    addUnit(ownerId, kind, x, y) {
      const meta = UNIT_KIND_META[kind]!;
      const owner = state.players.get(ownerId)!;
      const u = new Unit();
      u.id = `u${++counter}`;
      u.ownerId = ownerId;
      u.kind = kind;
      u.x = x;
      u.y = y;
      u.hp = meta.maxHp;
      u.maxHp = meta.maxHp;
      u.targetId = "";
      u.slotIndex = owner.ownedUnitCount;
      owner.ownedUnitCount++;
      state.units.set(u.id, u);
      bodyRefs.set(
        u.id,
        addCombatantBody(phys, {
          entityId: u.id,
          x,
          y,
          radius: meta.contactRadius,
          ownerBit: ownerBits.get(ownerId),
          passSameOwner: true,
        }),
      );
      return u;
    },
    addStructure(ownerId, kind, x, y) {
      const meta = STRUCTURE_KIND_META[kind]!;
      const s = new Structure();
      s.id = `s${++counter}`;
      s.ownerId = ownerId;
      s.kind = kind;
      s.x = x;
      s.y = y;
      s.hp = meta.hp;
      s.maxHp = meta.hp;
      s.contactRadius = meta.halfExtent;
      state.structures.set(s.id, s);
      bodyRefs.set(
        s.id,
        addStructureBody(phys, {
          entityId: s.id,
          x,
          y,
          radius: meta.halfExtent,
          shape: meta.colliderShape ?? "ball",
          ownerBit: ownerBits.get(ownerId),
        }),
      );
      return s;
    },
    pushInput(playerId, targetX, targetY) {
      const seq = (seqs.get(playerId) ?? 0) + 1;
      seqs.set(playerId, seq);
      const input = { seq, targetX, targetY };
      inputQueues.get(playerId)!.push(input);
      return input;
    },
    tick() {
      tickCount++;
      state.serverTime = tickCount * TICK_MS;
      simulateTick(state, inputQueues, bodyRefs, phys, ctx);
    },
  };
  return world;
}
