import { Container, Graphics } from "pixi.js";
import { lighten, parseHexColor } from "../render/colors.js";
import type { Effect } from "./manager.js";

const DURATION = 0.55;
const SHARD_COUNT = 7;
const SHARD_SIZE = 5;
const SHARD_SPEED_MIN = 90;
const SHARD_SPEED_MAX = 200;

interface Shard {
  graphic: Graphics;
  vx: number;
  vy: number;
  omega: number;
  initialAngle: number;
}

/**
 * A burst of small triangular shards spraying outward from a death position.
 * Each shard takes off at a random angle, rotates, and the whole effect
 * fades to zero alpha over the duration.
 */
export function createDeathBurst(x: number, y: number, color: string): Effect {
  const container = new Container();
  container.x = x;
  container.y = y;
  const tint = parseHexColor(color);
  const stroke = lighten(tint, 0.55);

  // Bright central flash on tick 0 — adds punch without much extra geometry.
  const flash = new Graphics();
  flash
    .circle(0, 0, SHARD_SIZE * 1.5)
    .fill({ color: lighten(tint, 0.7), alpha: 0.85 });
  container.addChild(flash);

  const shards: Shard[] = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const g = new Graphics();
    g.poly([
      -SHARD_SIZE * 0.5, -SHARD_SIZE * 0.4,
      SHARD_SIZE * 0.6, 0,
      -SHARD_SIZE * 0.5, SHARD_SIZE * 0.4,
    ])
      .fill({ color: tint, alpha: 1 })
      .stroke({ color: stroke, width: 0.75, alpha: 0.9 });
    const angle = (i / SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.5;
    const speed = SHARD_SPEED_MIN + Math.random() * (SHARD_SPEED_MAX - SHARD_SPEED_MIN);
    g.rotation = angle;
    container.addChild(g);
    shards.push({
      graphic: g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      omega: (Math.random() - 0.5) * 12,
      initialAngle: angle,
    });
  }

  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;
      const t = elapsed / DURATION;
      const easeOut = 1 - Math.pow(1 - t, 2); // distance grows fast then slows
      // Drag — reduces speed over time so shards don't fly forever.
      const drag = 1 - Math.min(0.85, t * 0.9);
      for (const s of shards) {
        s.graphic.x = s.vx * easeOut * 0.55;
        s.graphic.y = s.vy * easeOut * 0.55;
        s.graphic.rotation = s.initialAngle + s.omega * elapsed * drag;
      }
      flash.alpha = 1 - t * t; // fast fall on the central flash
      flash.scale.set(1 + t * 1.4);
      container.alpha = 1 - t;
      return true;
    },
  };
}
