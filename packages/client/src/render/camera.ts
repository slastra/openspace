import type { Application, Container } from "pixi.js";
import { AOI_RADIUS_U } from "@openspace/shared";

/**
 * Owns the camera position, zoom and the screen↔world transforms.
 *
 * The world container is positioned and scaled each frame so the camera's
 * world point lands at canvas center, and `onApply` hands the camera
 * position and screen size to the screen-space layers (parallax backdrop,
 * vignette). Game code only sets `target` and calls `apply()`.
 */
export interface Camera {
  x: number;
  y: number;
  /** World-to-screen scale (1 = one world unit per CSS pixel). */
  readonly zoom: number;
  setTarget(x: number, y: number): void;
  apply(): void;
  /** Kick a screen shake (world units of peak offset); decays quickly. */
  shake(amount: number): void;
  /** Multiply the player's zoom preference (wheel, pinch), clamped. */
  zoomBy(factor: number): void;
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

/** The server only streams entities within AOI_RADIUS_U of the ship, so the
 *  view's half-extent must stay inside it (minus a margin) or the edges
 *  would show things popping in and out. */
const MAX_VIEW_HALF_EXTENT = AOI_RADIUS_U - 100;
const MAX_ZOOM = 1.6;
/** Small screens zoom out so a phone sees about as much as a laptop. */
const COMFORT_SHORT_SIDE_U = 620;

export function createCamera(
  app: Application,
  world: Container,
  onApply: (x: number, y: number, screenW: number, screenH: number) => void,
): Camera {
  let x = 0;
  let y = 0;
  let zoom = 1;
  /** Player's wheel/pinch adjustment on top of the screen-size default. */
  let userZoom = 1;
  let shakeMag = 0;
  let lastApply = performance.now();

  // Read from the canvas's actual rendered CSS rect — Pixi's renderer.width
  // can drift from this when DPR doesn't match what was set at init.
  const screen = () => {
    const r = app.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const zoomLimits = (w: number, h: number) => {
    const min = Math.max(w, h) / 2 / MAX_VIEW_HALF_EXTENT;
    const base = Math.max(min, Math.min(1, Math.min(w, h) / COMFORT_SHORT_SIDE_U));
    return { min, base };
  };

  const apply = () => {
    const { w, h } = screen();
    const { min, base } = zoomLimits(w, h);
    zoom = Math.max(min, Math.min(MAX_ZOOM, base * userZoom));
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastApply) / 1000);
    lastApply = now;
    let sx = 0;
    let sy = 0;
    if (shakeMag > 0.05) {
      shakeMag *= Math.exp(-dt * 14);
      sx = (Math.random() * 2 - 1) * shakeMag;
      sy = (Math.random() * 2 - 1) * shakeMag;
    } else {
      shakeMag = 0;
    }
    world.scale.set(zoom);
    world.position.set(w / 2 - x * zoom + sx, h / 2 - y * zoom + sy);
    onApply(x, y, w, h);
  };

  app.renderer.on("resize", apply);

  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get zoom() {
      return zoom;
    },
    setTarget(nx, ny) {
      x = nx;
      y = ny;
    },
    apply,
    shake(amount) {
      shakeMag = Math.min(14, Math.max(shakeMag, amount));
    },
    zoomBy(factor) {
      const { w, h } = screen();
      const { min, base } = zoomLimits(w, h);
      // Clamp the preference itself so zooming past a limit doesn't bank
      // invisible "extra" zoom that must be scrolled back first.
      userZoom = Math.max(min / base, Math.min(MAX_ZOOM / base, userZoom * factor));
    },
    screenToWorld(screenX, screenY) {
      const { w, h } = screen();
      return { x: (screenX - w / 2) / zoom + x, y: (screenY - h / 2) / zoom + y };
    },
  };
}
