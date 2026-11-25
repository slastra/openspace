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
  /** Kick a screen shake (world units of peak offset); decays quickly. */
  shake(amount: number): void;
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

export function createCamera(
  app: Application,
  world: Container,
  onApply: (x: number, y: number, screenW: number, screenH: number) => void,
): Camera {
  let x = 0;
  let y = 0;
  let shakeMag = 0;
  let lastApply = performance.now();

  // Read from the canvas's actual rendered CSS rect — Pixi's renderer.width
  // can drift from this when DPR doesn't match what was set at init.
  const screen = () => {
    const r = app.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const apply = () => {
    const { w, h } = screen();
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
    world.position.set(w / 2 - x + sx, h / 2 - y + sy);
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
    shake(amount) {
      shakeMag = Math.min(14, Math.max(shakeMag, amount));
    },
    screenToWorld(screenX, screenY) {
      const { w, h } = screen();
      return { x: screenX - w / 2 + x, y: screenY - h / 2 + y };
    },
  };
}
