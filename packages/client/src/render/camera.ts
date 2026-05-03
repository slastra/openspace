import type { Application, Container } from "pixi.js";

/**
 * Owns the camera position and the screen↔world transforms.
 *
 * The world container is positioned each frame so the camera's world point
 * lands at canvas center. The background container gets the same translation
 * scaled down for parallax. Game code only sets `target` and calls `apply()`.
 */
export interface Camera {
  x: number;
  y: number;
  setTarget(x: number, y: number): void;
  apply(): void;
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

export interface CameraOptions {
  /** Parallax factor for the background container (0 = static, 1 = same as world). */
  backgroundParallax?: number;
}

export function createCamera(
  app: Application,
  world: Container,
  background: Container,
  options: CameraOptions = {},
): Camera {
  const parallax = options.backgroundParallax ?? 0.15;
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
    background.position.set((w / 2 - x) * parallax, (h / 2 - y) * parallax);
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
