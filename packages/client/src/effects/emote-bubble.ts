import { Container, Text, TextStyle } from "pixi.js";
import type { Effect } from "./manager.js";

const DURATION = 2.0;
/** First N seconds: pop in (scale 0.5 -> 1.0 with overshoot, alpha 0 -> 1). */
const POP_IN_SECONDS = 0.2;
/** Last N seconds: float-fade-grow exit (scale 1.0 -> 1.3, alpha 1 -> 0). */
const FADE_OUT_SECONDS = 0.5;
/** Vertical offset above the ship's center the bubble base sits at. */
const VERTICAL_OFFSET = 28;
/** How much further the bubble drifts upward over the fade-out phase. */
const FLOAT_RISE = 30;
/** Slight overshoot during pop-in for the "punch" feel — peaks at this
 *  scale at the end of the pop, then settles to 1.0. */
const POP_OVERSHOOT_SCALE = 1.15;

const TEXT_STYLE = new TextStyle({
  fontFamily: "system-ui, sans-serif",
  fontSize: 22,
  fill: 0xffffff,
  align: "center",
});

/**
 * Floating emote bubble that tracks a sender entity. `anchor()` returns
 * the sender's CURRENT world position each frame (or null when the
 * sender has dropped out of view — bubble then renders at last known
 * position and continues fading). Three-phase animation: pop in, hold,
 * fade-grow up.
 */
export function createEmoteBubble(
  glyph: string,
  anchor: () => { x: number; y: number } | null,
): Effect {
  const container = new Container();
  const text = new Text({ text: glyph, style: TEXT_STYLE });
  text.anchor.set(0.5);
  container.addChild(text);

  // Initial position from anchor; subsequent frames re-anchor to track
  // the sender ship as it moves.
  const initial = anchor();
  let lastX = initial?.x ?? 0;
  let lastY = initial?.y ?? 0;
  container.x = lastX;
  container.y = lastY - VERTICAL_OFFSET;

  let elapsed = 0;
  return {
    container,
    update(dt: number) {
      elapsed += dt;
      if (elapsed >= DURATION) return false;

      // Re-anchor to the sender's current position each frame so the
      // bubble follows them rather than staying at the spawn point.
      const a = anchor();
      if (a) {
        lastX = a.x;
        lastY = a.y;
      }

      // Phase math.
      let scale: number;
      let alpha: number;
      let yOffset: number;

      if (elapsed < POP_IN_SECONDS) {
        // Pop in: scale 0.5 -> overshoot, alpha 0 -> 1.
        const t = elapsed / POP_IN_SECONDS;
        const eased = 1 - (1 - t) * (1 - t); // ease-out
        scale = 0.5 + (POP_OVERSHOOT_SCALE - 0.5) * eased;
        alpha = eased;
        yOffset = 0;
      } else if (elapsed < DURATION - FADE_OUT_SECONDS) {
        // Hold: settle to 1.0 (slight bounce back from overshoot), full alpha.
        const settleT = Math.min(
          1,
          (elapsed - POP_IN_SECONDS) / 0.1,
        );
        scale = POP_OVERSHOOT_SCALE - (POP_OVERSHOOT_SCALE - 1) * settleT;
        alpha = 1;
        yOffset = 0;
      } else {
        // Fade out: scale 1.0 -> 1.3, alpha 1 -> 0, drift up FLOAT_RISE.
        const t = (elapsed - (DURATION - FADE_OUT_SECONDS)) / FADE_OUT_SECONDS;
        scale = 1 + 0.3 * t;
        alpha = 1 - t;
        yOffset = -FLOAT_RISE * t;
      }

      container.x = lastX;
      container.y = lastY - VERTICAL_OFFSET + yOffset;
      container.scale.set(scale);
      container.alpha = alpha;
      return true;
    },
  };
}
