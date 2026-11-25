import { describe, expect, it } from "vitest";
import { PLAYER_SPEED, Projectile, TICK_DT, UNIT_KIND_META } from "@openspace/shared";
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
