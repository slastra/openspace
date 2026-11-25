import { describe, expect, it } from "vitest";
import {
  DASH_FLEET_BURN_DPS,
  PLAYER_SPEED,
  PlayerInput,
  Projectile,
  TICK_DT,
  UNIT_KIND_META,
  playerFleetDragFactor,
  stepPlayer,
} from "@openspace/shared";
import { createTestWorld } from "./testWorld.js";

/** One tick of full-speed travel for a ship with no fleet drag. */
const STEP = PLAYER_SPEED * TICK_DT;

describe("physics", () => {
  it("moves the server ship exactly as fast as stepPlayer predicts", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    for (let i = 0; i < 60; i++) {
      w.pushInput("a", 9000, 3000);
      w.tick();
    }
    expect(p.x - 3000).toBeCloseTo(60 * STEP, 3);
  });

  it("lets the owner's ship fly through its own base but blocks an enemy", async () => {
    const w = await createTestWorld();
    const own = w.addPlayer("a", 3000, 3000);
    const enemy = w.addPlayer("b", 3000, 3300);
    w.addStructure("a", "base", 3100, 3000);
    w.addStructure("a", "base", 3100, 3300);
    // Enemy spawn invuln is irrelevant here; we only check positions.
    for (let i = 0; i < 30; i++) {
      w.pushInput("a", 9000, 3000);
      w.pushInput("b", 9000, 3300);
      w.tick();
    }
    expect(own.x).toBeGreaterThan(3200); // passed through
    expect(enemy.x).toBeLessThan(3100); // stopped at the base's rim
  });
});

describe("player input consumption", () => {
  it("moves one step per input and acks one input per tick", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    w.pushInput("a", 9000, 3000);
    w.pushInput("a", 9000, 3000);
    w.tick();
    expect(p.lastProcessedInputSeq).toBe(1);
    w.tick();
    expect(p.lastProcessedInputSeq).toBe(2);
    expect(p.x - 3000).toBeCloseTo(2 * STEP, 1);
  });

  it("coasts through a starved tick and repays the step later", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    w.pushInput("a", 9000, 3000);
    w.tick(); // input 1
    w.tick(); // starved: coast on input 1, owe a step
    expect(p.lastProcessedInputSeq).toBe(1);
    w.pushInput("a", 9000, 3000);
    w.pushInput("a", 9000, 3000);
    w.tick(); // input 2 repays the coast unsimulated, input 3 moves
    expect(p.lastProcessedInputSeq).toBe(3);
    // Three inputs, three steps: identical to what the client predicted.
    expect(p.x - 3000).toBeCloseTo(3 * STEP, 1);
  });

  it("drops a stale backlog instead of replaying it", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    for (let i = 0; i < 10; i++) w.pushInput("a", 9000, 3000);
    w.tick();
    // 10 queued, backlog cap 3: seq 1..7 are acked unsimulated, 8 applies.
    expect(p.lastProcessedInputSeq).toBe(8);
    expect(w.inputQueues.get("a")!.length).toBe(2);
  });
});

describe("dash and fleet drag ride on the input", () => {
  it("dashes exactly the inputs marked dash", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    const seen: boolean[] = [];
    for (const dash of [false, true, true, false]) {
      w.pushInput("a", 9000, 3000, { dash });
      w.tick();
      seen.push(p.dashing);
    }
    expect(seen).toEqual([false, true, true, false]);
    expect(p.x - 3000).toBeCloseTo(6 * STEP, 3); // 1 + 2 + 2 + 1
  });

  it("floors a claimed fleet at the player's recent unit count", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    p.ownedUnitCount = 120; // drag without simulating 120 bodies
    w.pushInput("a", 9000, 3000, { fleet: 0 }); // lying: "no fleet"
    w.tick();
    expect(p.x - 3000).toBeCloseTo(STEP * playerFleetDragFactor(120), 3);
  });

  it("matches the client's prediction while dash burn kills units", async () => {
    const w = await createTestWorld();
    const p = w.addPlayer("a", 3000, 3000);
    for (let i = 0; i < 60; i++) w.addUnit("a", "rammer", 3000, 3000);
    for (let i = 0; i < 30; i++) w.tick();
    // The client stamps each input with the unit count from its latest
    // snapshot, which lags the server by a few ticks while units burn.
    const counts: number[] = [];
    const sent: PlayerInput[] = [];
    const start = { x: p.x, y: p.y, rotation: 0 };
    const burnTicks = Math.ceil((UNIT_KIND_META.rammer!.maxHp / DASH_FLEET_BURN_DPS) / TICK_DT) + 15;
    for (let i = 0; i < burnTicks; i++) {
      counts.push(p.ownedUnitCount);
      const stale = counts[Math.max(0, counts.length - 4)]!;
      sent.push(w.pushInput("a", 9000, 3000, { dash: true, fleet: stale }));
      w.tick();
    }
    expect(p.ownedUnitCount).toBe(0); // the whole fleet burned up
    let predicted = start;
    for (const input of sent) predicted = stepPlayer(predicted, input, TICK_DT);
    // Rapier stores positions as float32, hence 1 decimal (0.05u).
    expect(p.x).toBeCloseTo(predicted.x, 1);
    expect(p.y).toBeCloseTo(predicted.y, 1);
  });
});

describe("grid-indexed passes", () => {
  it("projectiles hit the first enemy they overlap", async () => {
    const w = await createTestWorld();
    w.addPlayer("a", 3000, 3000);
    w.addPlayer("b", 6000, 6000);
    const target = w.addUnit("b", "gunner", 4000, 4000);
    const hpBefore = target.hp;
    const p = new Projectile();
    p.id = "shot";
    p.ownerId = "a";
    p.team = "a";
    p.x = 3990;
    p.y = 4000;
    p.vx = 300;
    p.vy = 0;
    p.damage = 5;
    p.expiresAt = 1e12;
    w.state.projectiles.set(p.id, p);
    w.tick();
    expect(w.state.projectiles.has("shot")).toBe(false);
    expect(target.hp + target.shield).toBeLessThan(hpBefore);
  });

  it("a dying rammer damages enemies inside its blast radius only", async () => {
    const w = await createTestWorld();
    w.addPlayer("a", 3000, 3000);
    w.addPlayer("b", 6000, 6000);
    const rammer = w.addUnit("a", "rammer", 4000, 4000);
    const radius = UNIT_KIND_META.rammer!.explodeRadius!;
    const near = w.addUnit("b", "gunner", 4000 + radius * 0.5, 4000);
    const far = w.addUnit("b", "gunner", 4000 + radius * 2, 4000);
    const nearBefore = near.hp;
    const farBefore = far.hp;
    rammer.hp = 0;
    w.tick();
    expect(near.hp).toBeLessThan(nearBefore);
    expect(far.hp).toBe(farBefore);
  });

  it("shielders raise the shield cap of nearby friendlies", async () => {
    const w = await createTestWorld();
    w.addPlayer("a", 3000, 3000);
    w.addUnit("a", "shielder", 4000, 4000);
    const ally = w.addUnit("a", "gunner", 4020, 4000);
    w.tick();
    expect(ally.maxShield).toBe(UNIT_KIND_META.shielder!.shieldGrant);
  });
});

describe("formation", () => {
  const KINDS = ["rammer", "miner", "gunner", "laser", "repair", "shielder"];

  /** Max |second difference| of each unit's ship-relative position over
   *  `ticks` ticks: zero when the swarm moves rigidly with the ship. */
  function measureJerk(
    w: Awaited<ReturnType<typeof createTestWorld>>,
    shipId: string,
    ticks: number,
    input: () => void,
  ): number {
    const ship = w.state.players.get(shipId)!;
    const hist = new Map<string, { x: number; y: number }[]>();
    for (let k = 0; k < ticks; k++) {
      input();
      w.tick();
      for (const u of w.state.units.values()) {
        let h = hist.get(u.id);
        if (!h) hist.set(u.id, (h = []));
        h.push({ x: u.x - ship.x, y: u.y - ship.y });
      }
    }
    let max = 0;
    for (const h of hist.values()) {
      for (let i = 2; i < h.length; i++) {
        const ax = h[i]!.x - 2 * h[i - 1]!.x + h[i - 2]!.x;
        const ay = h[i]!.y - 2 * h[i - 1]!.y + h[i - 2]!.y;
        max = Math.max(max, Math.hypot(ax, ay));
      }
    }
    return max;
  }

  it("holds a large swarm rigid around a cruising, turning ship", async () => {
    const w = await createTestWorld();
    const ship = w.addPlayer("a", 3000, 3000);
    for (let i = 0; i < 200; i++) w.addUnit("a", KINDS[i % KINDS.length]!, 3000 + (i % 20) * 10, 2800 + i);
    let k = 0;
    const steer = () => {
      const ang = Math.sin(k++ / 40) * 1.2;
      w.pushInput("a", ship.x + Math.cos(ang) * 1000, ship.y + Math.sin(ang) * 1000);
    };
    measureJerk(w, "a", 150, steer); // settle
    expect(measureJerk(w, "a", 150, steer)).toBeLessThan(0.05);
  });

  it("spins smoothly parked on top of its own base", async () => {
    const w = await createTestWorld();
    w.addPlayer("a", 3000, 3000);
    w.addStructure("a", "base", 3000, 3150);
    w.addStructure("a", "supply", 3150, 3000);
    for (let i = 0; i < 160; i++) w.addUnit("a", KINDS[i % KINDS.length]!, 3000, 3150);
    measureJerk(w, "a", 200, () => {}); // settle out of the base
    // Before owner pass-through and the rigid disc: 4.5 u/tick² spikes.
    expect(measureJerk(w, "a", 150, () => {})).toBeLessThan(0.05);
  });

  it("a spawn moves at most one existing unit per formation tier", async () => {
    const w = await createTestWorld();
    w.addPlayer("a", 3000, 3000);
    for (let i = 0; i < 60; i++) w.addUnit("a", KINDS[i % KINDS.length]!, 3000, 3000);
    for (let i = 0; i < 200; i++) w.tick();
    const before = new Map(w.ctx.formations.get("a")!.slotOf);
    w.addUnit("a", "repair", 3000, 3000); // innermost tier: shifts every band
    w.addUnit("a", "rammer", 3000, 3000); // outermost tier
    w.tick();
    const after = w.ctx.formations.get("a")!.slotOf;
    let moved = 0;
    for (const [id, slot] of before) if (after.get(id) !== slot) moved++;
    expect(moved).toBeLessThanOrEqual(4);
  });

  it("orphans regroup around their wreckage", async () => {
    const w = await createTestWorld();
    const owner = w.addPlayer("a", 3000, 3000);
    for (let i = 0; i < 30; i++) w.addUnit("a", KINDS[i % KINDS.length]!, 3000, 3000);
    for (let i = 0; i < 60; i++) w.tick();
    owner.hp = 0;
    w.tick(); // death: wreckage spawned, units orphaned
    const wreck = [...w.state.wreckages.values()][0]!;
    for (let i = 0; i < 120; i++) w.tick();
    for (const u of w.state.units.values()) {
      expect(u.wreckageId).toBe(wreck.id);
      const r = Math.hypot(u.x - wreck.x, u.y - wreck.y);
      expect(r).toBeGreaterThan(140);
      expect(r).toBeLessThan(260);
    }
  });
});

describe("bookkeeping", () => {
  it("forgets per-unit side tables when units die", async () => {
    const w = await createTestWorld();
    w.addPlayer("a", 3000, 3000);
    const units = Array.from({ length: 20 }, () => w.addUnit("a", "gunner", 3000, 3000));
    w.tick();
    for (const u of units) u.hp = 0;
    w.tick();
    expect(w.state.units.size).toBe(0);
    for (const u of units) {
      expect(w.ctx.lastEntityPos.has(u.id)).toBe(false);
      expect(w.ctx.unitCooldownById.has(u.id)).toBe(false);
    }
  });

  it("renumbers claimed units into the claimer's slot sequence", async () => {
    const w = await createTestWorld();
    const dead = w.addPlayer("a", 3000, 3000);
    const claimer = w.addPlayer("b", 5000, 5000);
    for (let i = 0; i < 5; i++) w.addUnit("a", "gunner", 3000, 3000);
    for (let i = 0; i < 5; i++) w.addUnit("b", "gunner", 5000, 5000);
    w.tick();
    dead.hp = 0;
    w.tick(); // wreckage spawns, a's units orphaned
    const wreck = [...w.state.wreckages.values()][0]!;
    w.bodyRefs.get("b")!.body.setTranslation({ x: wreck.x, y: wreck.y }, true);
    claimer.x = wreck.x;
    claimer.y = wreck.y;
    w.tick(); // claim
    const mine = [...w.state.units.values()].filter((u) => u.ownerId === "b");
    expect(mine.length).toBe(10);
    expect(new Set(mine.map((u) => u.slotIndex)).size).toBe(10);
  });
});
