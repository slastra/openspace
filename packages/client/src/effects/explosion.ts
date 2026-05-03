import { Container, Graphics } from "pixi.js";
import { lighten, parseHexColor } from "../render/colors.js";
import type { Effect } from "./manager.js";

const DURATION = 0.55;

/**
 * Big death pop with an expanding shockwave ring sized to the unit's actual
 * AOE radius. Used for unit deaths so a rammer's blast visibly fills the
 * area it just damaged. Layered as: bright central flash → expanding ring →
 * outward shards. All three fade over `DURATION`.
 *
 * `radius` is the AOE radius from the unit kind's `explodeRadius`. Pass 0
 * for a tiny no-payload pop.
 */
export function createExplosion(
  x: number,
  y: number,
  radius: number,
  color: string,
): Effect {
  const container = new Container();
  container.x = x;
  container.y = y;
  const tint = parseHexColor(color);
  const bright = lighten(tint, 0.7);

  const flash = new Graphics();
  flash.circle(0, 0, Math.max(8, radius * 0.35)).fill({ color: bright, alpha: 0.95 });
  container.addChild(flash);

  const ring = new Graphics();
  container.addChild(ring);

  const shardCount = radius > 50 ? 12 : 6;
  const shardSpeed = Math.max(120, radius * 2.5);
  const shards: { g: Graphics; vx: number; vy: number }[] = [];
  for (let i = 0; i < shardCount; i++) {
    const g = new Graphics();
    g.poly([-3, -2, 4, 0, -3, 2])
      .fill({ color: tint, alpha: 1 })
      .stroke({ color: bright, width: 0.75, alpha: 0.9 });
    const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.5;
    g.rotation = angle;
    container.addChild(g);
    shards.push({
      g,
      vx: Math.cos(angle) * (shardSpeed * (0.6 + Math.random() * 0.5)),
      vy: Math.sin(angle) * (shardSpeed * (0.6 + Math.random() * 0.5)),
    });
  }

  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;
      const t = elapsed / DURATION;
      // Shockwave: stroke ring grows from 0 → radius, fades out as it expands.
      ring.clear();
      if (radius > 0) {
        const ringR = radius * (1 - Math.pow(1 - t, 2));
        const ringAlpha = (1 - t) * 0.85;
        ring
          .circle(0, 0, ringR)
          .stroke({ color: bright, width: 2, alpha: ringAlpha });
      }
      // Flash blooms then collapses.
      flash.alpha = 1 - t * t;
      flash.scale.set(1 + t * 1.6);
      // Shards fly outward with drag.
      const drag = 1 - Math.min(0.85, t * 0.9);
      for (const s of shards) {
        s.g.x = s.vx * t * 0.55;
        s.g.y = s.vy * t * 0.55;
        s.g.alpha = (1 - t) * drag;
      }
      container.alpha = 1 - t * 0.5;
      return true;
    },
  };
}
