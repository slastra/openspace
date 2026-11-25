import { describe, expect, it } from "vitest";
import { TICK_MS } from "@openspace/shared";
import { InterpolationDelay, RemoteInterpolator } from "./interpolation.js";

const FRAME = 1 / 120;

describe("InterpolationDelay", () => {
  it("settles to two ticks on a steady link", () => {
    const d = new InterpolationDelay();
    for (let s = 0; s < 30 * 20; s++) {
      d.observe(s % 3); // 0-2 ms of lateness
      for (let f = 0; f < 4; f++) d.advance(FRAME);
    }
    expect(d.delayMs).toBeCloseTo(2 * TICK_MS, 0);
  });

  it("grows to cover late snapshots, without jumping", () => {
    const d = new InterpolationDelay();
    for (let s = 0; s < 30 * 20; s++) {
      d.observe(0);
      for (let f = 0; f < 4; f++) d.advance(FRAME);
    }
    const before = d.delayMs;
    d.observe(80); // one snapshot 80 ms late
    expect(d.targetMs).toBeGreaterThanOrEqual(TICK_MS + 80);
    d.advance(FRAME);
    expect(d.delayMs - before).toBeLessThanOrEqual(30 * FRAME + 1e-9);
    for (let f = 0; f < 120 * 3; f++) d.advance(FRAME);
    expect(d.delayMs).toBeGreaterThanOrEqual(TICK_MS + 80);
  });
});

describe("RemoteInterpolator", () => {
  it("samples at the given render time", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 0, x: 0, y: 0, vx: 300, vy: 0, rotation: 0 });
    r.push({ t: TICK_MS, x: 10, y: 0, vx: 300, vy: 0, rotation: 0 });
    expect(r.sample(TICK_MS / 2)!.x).toBeCloseTo(5, 6);
  });
});
