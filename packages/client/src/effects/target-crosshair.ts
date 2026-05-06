import { Container, Graphics } from "pixi.js";
import type { Effect } from "./manager.js";

const FADE_IN_SECONDS = 0.18;
const FADE_OUT_SECONDS = 0.35;
/** Anchor briefly returns null while AOI streams a target re-add. The
 *  grace period rides those out so a transient null doesn't trigger
 *  a permanent fade. */
const ANCHOR_LOST_GRACE_SECONDS = 0.4;
const PULSE_PERIOD_SECONDS = 1.0;

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

  // The ring's geometry is fixed at construction — radius doesn't change
  // frame-to-frame. Build the Pixi Graphics once; per-frame work then is
  // just transform + alpha mutation, no clear()/stroke()/circle() rebuild.
  ring.circle(0, 0, radius).stroke({ width: 1.5, color, alpha: 0.85 });
  // Four short axis ticks just outside the ring — a classic reticle
  // silhouette that reads at any zoom.
  {
    const tickIn = radius * 0.95;
    const tickOut = radius * 1.18;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      ring
        .moveTo(cx * tickIn, cy * tickIn)
        .lineTo(cx * tickOut, cy * tickOut)
        .stroke({ width: 1.5, color, alpha: 0.85 });
    }
  }

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

      const pulse = 0.5 + 0.5 * Math.sin((elapsed / PULSE_PERIOD_SECONDS) * Math.PI * 2);
      const steadyAlpha = 0.55 + 0.35 * pulse;

      let envelope: number;
      if (fadeOutAt !== null) {
        const t = (elapsed - fadeOutAt) / FADE_OUT_SECONDS;
        if (t >= 1) return false;
        envelope = 1 - t;
      } else if (elapsed < FADE_IN_SECONDS) {
        envelope = elapsed / FADE_IN_SECONDS;
      } else {
        envelope = 1;
      }

      container.x = lastX;
      container.y = lastY;
      container.scale.set(1 + 0.08 * pulse);
      container.alpha = steadyAlpha * envelope;
      return true;
    },
  };
}
