import type { Application, Container } from "pixi.js";

/**
 * Owns the camera position and the screen↔world transforms.
 *
 * The world container is positioned each frame so the camera's world point
 * lands at canvas center, and `onApply` hands the camera position and screen
 * size to the screen-space layers (parallax backdrop, vignette). Game code
 * only sets `target` and calls `apply()`.
 */
export interface Camera {
  x: number;
  y: number;
  setTarget(x: number, y: number): void;
  apply(): void;
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

export function createCamera(
  app: Application,
  world: Container,
  onApply: (x: number, y: number, screenW: number, screenH: number) => void,
): Camera {
  let x = 0;
  let y = 0;

  // Read from the canvas's actual rendered CSS rect — Pixi's renderer.width
  // can drift from this when DPR doesn't match what was set at init.
  const screen = () => {
    const r = app.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const apply = () => {
    const { w, h } = screen();
    world.position.set(w / 2 - x, h / 2 - y);
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
    setTarget(nx, ny) {
      x = nx;
      y = ny;
    },
    apply,
    screenToWorld(screenX, screenY) {
      const { w, h } = screen();
      return { x: screenX - w / 2 + x, y: screenY - h / 2 + y };
    },
  };
}
