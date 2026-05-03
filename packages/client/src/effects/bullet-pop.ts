import { Container, Graphics } from "pixi.js";
import { lighten, parseHexColor } from "../render/colors.js";
import type { Effect } from "./manager.js";

const DURATION = 0.18;
const MAX_RADIUS = 7;

/**
 * Tiny terminal flash for an expired or impacting projectile. Just a small
 * ring that expands + fades plus a dot in the middle — lighter than a unit
 * death burst (no shards, no flying debris) so a stream of gunner shots
 * doesn't blanket the screen in particle clutter.
 */
export function createBulletPop(x: number, y: number, color: string): Effect {
  const container = new Container();
  container.x = x;
  container.y = y;
  const tint = parseHexColor(color);
  const bright = lighten(tint, 0.7);

  const ring = new Graphics();
  const dot = new Graphics();
  container.addChild(ring);
  container.addChild(dot);

  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;
      const t = elapsed / DURATION;
      const r = MAX_RADIUS * (1 - Math.pow(1 - t, 2));
      const alpha = 1 - t;
      ring.clear();
      ring.circle(0, 0, r).stroke({ color: bright, width: 1.25, alpha });
      dot.clear();
      dot.circle(0, 0, 1.5 * (1 - t)).fill({ color: bright, alpha });
      return true;
    },
  };
}
