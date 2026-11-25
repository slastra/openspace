import { Container, Graphics } from "pixi.js";
import { lighten, parseHexColor } from "../render/colors.js";
import type { Effect } from "./manager.js";

const DURATION = 0.16;
const SPARKS = 4;

/**
 * Impact flicker on a damaged unit, structure or ship: a few short streaks
 * flying outward. Cheaper than the death burst; the caller caps how many
 * spawn per frame so a big fight stays readable.
 */
export function createHitSpark(x: number, y: number, color: string): Effect {
  const container = new Container();
  container.x = x;
  container.y = y;
  container.blendMode = "add";
  const g = new Graphics();
  container.addChild(g);
  const tint = lighten(parseHexColor(color), 0.6);
  const base = Math.random() * Math.PI * 2;
  const dirs = Array.from({ length: SPARKS }, (_, i) => base + (i / SPARKS) * Math.PI * 2 + Math.random() * 0.6);
  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;
      const t = elapsed / DURATION;
      const r0 = 3 + 10 * t;
      const r1 = r0 + 6 * (1 - t);
      g.clear();
      for (const a of dirs) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        g.moveTo(c * r0, s * r0).lineTo(c * r1, s * r1);
      }
      g.stroke({ color: tint, width: 1.5, alpha: 1 - t });
      return true;
    },
  };
}
