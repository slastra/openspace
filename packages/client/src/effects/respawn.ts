import { Container, Graphics } from "pixi.js";
import { lighten, parseHexColor } from "../render/colors.js";
import type { Effect } from "./manager.js";

const DURATION = 0.55;
const RING_COUNT = 3;
const RING_START_RADIUS = 70;

/**
 * A "warp in" effect: three concentric rings starting wide and contracting
 * onto the spawn point, plus a brief central pulse that expands as the
 * rings collapse — reads as "materialization" without sprites.
 */
export function createRespawnPulse(x: number, y: number, color: string): Effect {
  const container = new Container();
  container.x = x;
  container.y = y;
  const tint = parseHexColor(color);
  const ringColor = lighten(tint, 0.5);

  // Pre-create the rings; we'll redraw each frame with shrinking radius.
  const rings: { graphic: Graphics; offset: number }[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const g = new Graphics();
    container.addChild(g);
    rings.push({ graphic: g, offset: i * 0.12 });
  }

  const pulse = new Graphics();
  container.addChild(pulse);

  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;

      for (const r of rings) {
        // Each ring runs slightly out of phase with the others (cascading collapse).
        const local = Math.max(0, Math.min(1, (elapsed - r.offset) / (DURATION - r.offset)));
        const radius = RING_START_RADIUS * (1 - local);
        const alpha = local < 0.05 ? 0 : (1 - local) * 0.85;
        r.graphic.clear();
        if (radius > 0.5 && alpha > 0) {
          r.graphic
            .circle(0, 0, radius)
            .stroke({ color: ringColor, width: 1.5, alpha });
        }
      }

      // Central pulse — expands as rings collapse, fades out.
      const pulseT = Math.min(1, elapsed / DURATION);
      pulse.clear();
      pulse
        .circle(0, 0, 4 + pulseT * 22)
        .fill({ color: ringColor, alpha: (1 - pulseT) * 0.65 });

      return true;
    },
  };
}
