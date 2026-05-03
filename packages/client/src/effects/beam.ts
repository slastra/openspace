import { Container, Graphics } from "pixi.js";
import { lighten, parseHexColor } from "../render/colors.js";
import type { Effect } from "./manager.js";

const DURATION = 0.22;
const CORE_WIDTH = 1.5;
const GLOW_WIDTH = 4.5;
const IMPACT_RADIUS = 6;

/**
 * A short-lived laser beam from (x1,y1) to (x2,y2). Two stroked lines
 * (wide soft glow + narrow bright core) plus a small impact pulse at the
 * destination. Endpoints are captured at fire time and don't track the
 * shooter/target — beams are intentionally instantaneous in fiction.
 *
 * `intensity` (0..1) baseline-scales every alpha so distant shots look
 * weaker than point-blank ones. Caller computes it from the fire distance
 * vs the firing kind's `abilityRange`.
 */
export function createBeam(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  intensity: number = 1,
): Effect {
  const container = new Container();
  const tint = parseHexColor(color);
  const bright = lighten(tint, 0.7);
  const a = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;

  const glow = new Graphics();
  glow
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke({ color: tint, width: GLOW_WIDTH, alpha: 0.5 * a });
  container.addChild(glow);

  const core = new Graphics();
  core
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke({ color: bright, width: CORE_WIDTH, alpha: 1 * a });
  container.addChild(core);

  const impact = new Graphics();
  impact.circle(x2, y2, IMPACT_RADIUS).fill({ color: bright, alpha: 0.85 * a });
  container.addChild(impact);

  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;
      const t = elapsed / DURATION;
      container.alpha = 1 - t;
      const bloom = 1 + Math.sin(t * Math.PI) * 0.6;
      impact.scale.set(bloom);
      return true;
    },
  };
}
