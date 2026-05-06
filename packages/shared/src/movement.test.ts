import { describe, expect, it } from "vitest";
import {
  MAX_UNITS_PER_PLAYER,
  PLAYER_FLEET_DRAG_FLOOR,
  PLAYER_FULL_SPEED_DIST,
  PLAYER_INPUT_DEADZONE,
  PLAYER_SPEED,
  TICK_DT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants.js";
import { playerDesiredVelocity, playerFleetDragFactor, stepPlayer } from "./movement.js";

const start = () => ({ x: 100, y: 100, rotation: 0 });

describe("playerFleetDragFactor", () => {
  it("returns 1.0 with zero owned units", () => {
    expect(playerFleetDragFactor(0)).toBe(1);
  });
  it("returns the floor at MAX_UNITS_PER_PLAYER", () => {
    expect(playerFleetDragFactor(MAX_UNITS_PER_PLAYER)).toBeCloseTo(
      PLAYER_FLEET_DRAG_FLOOR,
      6,
    );
  });
  it("interpolates linearly at the midpoint", () => {
    const mid = MAX_UNITS_PER_PLAYER / 2;
    expect(playerFleetDragFactor(mid)).toBeCloseTo(
      1 - (1 - PLAYER_FLEET_DRAG_FLOOR) / 2,
      6,
    );
  });
  it("clamps to floor when above the cap", () => {
    expect(playerFleetDragFactor(MAX_UNITS_PER_PLAYER + 1000)).toBe(
      PLAYER_FLEET_DRAG_FLOOR,
    );
  });
  it("clamps to 1.0 for negative inputs", () => {
    expect(playerFleetDragFactor(-5)).toBe(1);
  });
});

describe("playerDesiredVelocity", () => {
  it("returns zero inside the deadzone", () => {
    const v = playerDesiredVelocity(100, 100, 100 + PLAYER_INPUT_DEADZONE - 1, 100);
    expect(v.speed).toBe(0);
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(0);
  });

  it("returns full speed at or beyond full-speed distance", () => {
    const v = playerDesiredVelocity(100, 100, 100 + PLAYER_FULL_SPEED_DIST, 100);
    expect(v.speed).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it("ramps linearly between deadzone and full-speed distance", () => {
    const mid = (PLAYER_INPUT_DEADZONE + PLAYER_FULL_SPEED_DIST) / 2;
    const v = playerDesiredVelocity(100, 100, 100 + mid, 100);
    expect(v.speed).toBeCloseTo(PLAYER_SPEED * 0.5, 1);
  });

  it("velocity vector points from ship toward cursor", () => {
    const v = playerDesiredVelocity(100, 100, 1000, 100);
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeCloseTo(0, 5);
  });
});

describe("stepPlayer", () => {
  it("moves toward the cursor at full speed when far away", () => {
    const next = stepPlayer(start(), { seq: 1, targetX: 1000, targetY: 100 }, TICK_DT);
    expect(next.x).toBeCloseTo(100 + PLAYER_SPEED * TICK_DT, 5);
    expect(next.y).toBeCloseTo(100, 5);
  });

  it("does not move when cursor is inside the deadzone", () => {
    const next = stepPlayer(
      { x: 100, y: 100, rotation: 0.5 },
      { seq: 1, targetX: 100 + PLAYER_INPUT_DEADZONE - 5, targetY: 100 },
      TICK_DT,
    );
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
    expect(next.rotation).toBe(0.5); // rotation preserved when stopped
  });

  it("clamps to world bounds", () => {
    const past = stepPlayer(
      { x: WORLD_WIDTH - 1, y: 100, rotation: 0 },
      { seq: 1, targetX: WORLD_WIDTH + 500, targetY: 100 },
      TICK_DT,
    );
    expect(past.x).toBe(WORLD_WIDTH);
    const above = stepPlayer({ x: 100, y: 1, rotation: 0 }, { seq: 1, targetX: 100, targetY: -200 }, TICK_DT);
    expect(above.y).toBe(0);
  });

  it("sets rotation to face direction of travel", () => {
    const right = stepPlayer(start(), { seq: 1, targetX: 1000, targetY: 100 }, TICK_DT);
    expect(right.rotation).toBeCloseTo(0, 5);
    const down = stepPlayer(start(), { seq: 1, targetX: 100, targetY: 1000 }, TICK_DT);
    expect(down.rotation).toBeCloseTo(Math.PI / 2, 5);
    const up = stepPlayer(start(), { seq: 1, targetX: 100, targetY: -1000 }, TICK_DT);
    expect(up.rotation).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("handles vertical and horizontal world bounds the same way", () => {
    const right = stepPlayer(
      { x: WORLD_WIDTH - 1, y: 100, rotation: 0 },
      { seq: 1, targetX: WORLD_WIDTH + 1000, targetY: 100 },
      TICK_DT,
    );
    const down = stepPlayer(
      { x: 100, y: WORLD_HEIGHT - 1, rotation: 0 },
      { seq: 1, targetX: 100, targetY: WORLD_HEIGHT + 1000 },
      TICK_DT,
    );
    expect(right.x).toBe(WORLD_WIDTH);
    expect(down.y).toBe(WORLD_HEIGHT);
  });

  it("asymptotically approaches the deadzone boundary as the cursor sits beyond it", () => {
    let state = { x: 0, y: 0, rotation: 0 };
    const target = { seq: 1, targetX: 50, targetY: 0 };
    for (let i = 0; i < 200; i++) state = stepPlayer(state, target, TICK_DT);
    // Ship coasts toward the cursor and slows as it nears the deadzone boundary
    // (cursor at 50, deadzone 35 → ship plateaus near x=15).
    const distToCursor = 50 - state.x;
    expect(distToCursor).toBeGreaterThan(PLAYER_INPUT_DEADZONE - 5);
    expect(distToCursor).toBeLessThan(PLAYER_INPUT_DEADZONE + 5);
  });
});
