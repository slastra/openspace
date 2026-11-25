import { describe, expect, it } from "vitest";
import { PLAYER_SPEED, TICK_DT } from "@openspace/shared";
import { createTestWorld } from "./testWorld.js";

/** One tick of full-speed travel for a ship with no fleet drag. */
const STEP = PLAYER_SPEED * TICK_DT;

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
