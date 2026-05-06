import { Container, Graphics } from "pixi.js";
import type { Effect } from "./manager.js";

/** Time for the crosshair to fade in on first appearance. */
const FADE_IN_SECONDS = 0.18;
/** Time the crosshair takes to fade out after `requestFadeOut()` or
 *  after the anchor goes null permanently (target gone). */
const FADE_OUT_SECONDS = 0.35;
/** If anchor has been null this long without recovering, treat the
 *  target as gone and start the fade. Anchor briefly returns null
 *  while AOI streams a re-add — the grace period rides those out. */
const ANCHOR_LOST_GRACE_SECONDS = 0.4;
/** Pulse period for the breathing radius/alpha animation, seconds. */
const PULSE_PERIOD = 1.0;

/** Returned by `createTargetCrosshair` so the caller can cancel mid-life. */
export interface TargetCrosshair extends Effect {
  /** Trigger an immediate fade-out. The effect self-destructs once
   *  alpha reaches zero. Idempotent. */
  requestFadeOut(): void;
}

/**
 * Pulsing crosshair that follows a designated target. `anchor()` returns
 * the target's CURRENT world position each frame, or null when the
 * target has dropped from AOI / been removed. After a short grace
 * period of consecutive nulls, the crosshair fades and self-destructs.
 *
 * `radius` is the visual reach of the ring (~1.5× the target's hit
 * radius reads naturally). `color` should be the local player color.
 */
export function createTargetCrosshair(
  anchor: () => { x: number; y: number } | null,
  radius: number,
  color: number,
): TargetCrosshair {
  const container = new Container();
  const ring = new Graphics();
  container.addChild(ring);
  container.alpha = 0;

  const initial = anchor();
  let lastX = initial?.x ?? 0;
  let lastY = initial?.y ?? 0;
  container.x = lastX;
  container.y = lastY;

  let elapsed = 0;
  let fadeOutAt: number | null = null;
  let anchorLostFor = 0;

  const drawRing = (r: number) => {
    ring.clear();
    ring.circle(0, 0, r).stroke({ width: 1.5, color, alpha: 0.85 });
    // Four short axis ticks just outside the ring — a classic
    // reticle silhouette that reads at any zoom.
    const tickIn = r * 0.95;
    const tickOut = r * 1.18;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      ring
        .moveTo(cx * tickIn, cy * tickIn)
        .lineTo(cx * tickOut, cy * tickOut)
        .stroke({ width: 1.5, color, alpha: 0.85 });
    }
  };

  return {
    container,
    requestFadeOut() {
      if (fadeOutAt === null) fadeOutAt = elapsed;
    },
    update(dt: number) {
      elapsed += dt;

      const a = anchor();
      if (a) {
        lastX = a.x;
        lastY = a.y;
        anchorLostFor = 0;
      } else {
        anchorLostFor += dt;
        if (
          anchorLostFor > ANCHOR_LOST_GRACE_SECONDS &&
          fadeOutAt === null
        ) {
          fadeOutAt = elapsed;
        }
      }

      // Pulse: 0..1 sine eased so the ring "breathes."
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / PULSE_PERIOD) * Math.PI * 2);
      const scale = 1 + 0.08 * pulse;

      let alpha: number;
      if (fadeOutAt !== null) {
        const t = (elapsed - fadeOutAt) / FADE_OUT_SECONDS;
        if (t >= 1) return false;
        alpha = (1 - t) * (0.55 + 0.35 * pulse);
      } else if (elapsed < FADE_IN_SECONDS) {
        alpha = (elapsed / FADE_IN_SECONDS) * (0.55 + 0.35 * pulse);
      } else {
        alpha = 0.55 + 0.35 * pulse;
      }

      drawRing(radius);
      container.x = lastX;
      container.y = lastY;
      container.scale.set(scale);
      container.alpha = alpha;
      return true;
    },
  };
}
