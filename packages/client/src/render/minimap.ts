import { Application, Container, Graphics } from "pixi.js";
import { SPAWN_BUBBLE_RADIUS_U, WORLD_HEIGHT, WORLD_WIDTH } from "@openspace/shared";
import type { Asteroid } from "../entities/asteroids.js";
import type { LocalPlayer, RemotePlayer } from "../entities/players.js";
import type { Structure } from "../entities/structures.js";
import type { Unit } from "../entities/units.js";
import type { Wreckage } from "../entities/wreckages.js";
import type { Camera } from "./camera.js";
import { parseHexColor } from "./colors.js";

const MAP_SIZE = 168;
const EDGE_OFFSET_X = 18;
const EDGE_OFFSET_Y = 14;
const INSET = 8;
const INNER = MAP_SIZE - INSET * 2;
/** Matches the HUD panel tokens in hud/theme.css. */
const CORNER_RADIUS = 10;
const ASTEROID_COLOR = 0x8a7656;
const WRECK_COLOR = 0xfacc15;
/** Minimum interval (ms) between minimap redraws. 10 Hz looks identical
 *  to per-frame for map-scale motion and skips most Graphics rebuilds. */
const MIN_RENDER_INTERVAL_MS = 100;

/**
 * Bottom-right minimap, pinned to screen space (on app.stage, not the
 * camera-transformed world). Shows the arena edge and spawn ring, the
 * camera's view rectangle, asteroids, structures, wrecks, ships, and the
 * local fleet as faint dots.
 *
 * Server-side AOI already limits what's in local state to roughly vision
 * range, so there's no fog-of-war check here.
 */
export class Minimap {
  readonly container: Container;
  private readonly dots: Graphics;
  private readonly app: Application;
  private lastRenderAt = 0;

  constructor(app: Application) {
    this.app = app;
    this.container = new Container({ label: "minimap" });
    const frame = new Graphics();
    this.dots = new Graphics();
    this.container.addChild(frame);
    this.container.addChild(this.dots);
    app.stage.addChild(this.container);

    const sx = INNER / WORLD_WIDTH;
    frame
      .roundRect(0, 0, MAP_SIZE, MAP_SIZE, CORNER_RADIUS)
      .fill({ color: 0x0c111f, alpha: 0.85 })
      .stroke({ color: 0x94a3b8, width: 1, alpha: 0.2 })
      // Arena: faint grid quarters + edge.
      .rect(INSET, INSET, INNER, INNER)
      .fill({ color: 0x111a2c, alpha: 0.6 })
      .moveTo(INSET + INNER / 2, INSET)
      .lineTo(INSET + INNER / 2, INSET + INNER)
      .moveTo(INSET, INSET + INNER / 2)
      .lineTo(INSET + INNER, INSET + INNER / 2)
      .stroke({ color: 0x24506b, width: 1, alpha: 0.35 })
      .rect(INSET, INSET, INNER, INNER)
      .stroke({ color: 0x38bdf8, width: 1, alpha: 0.35 })
      .circle(INSET + INNER / 2, INSET + INNER / 2, SPAWN_BUBBLE_RADIUS_U * sx)
      .stroke({ color: 0x4ade80, width: 1, alpha: 0.3 });
  }

  render(
    asteroids: Iterable<Asteroid>,
    structures: Iterable<Structure>,
    units: Iterable<Unit>,
    wreckages: Iterable<Wreckage>,
    local: LocalPlayer | null,
    localSessionId: string,
    remotes: Iterable<RemotePlayer>,
    camera: Camera,
  ) {
    // Pin to bottom-right every frame (cheap; layout stays correct on resize)
    // but rate-limit the actual Graphics rebuild to MIN_RENDER_INTERVAL_MS.
    const { width: sw, height: sh } = this.app.screen;
    this.container.x = sw - MAP_SIZE - EDGE_OFFSET_X;
    this.container.y = sh - MAP_SIZE - EDGE_OFFSET_Y;
    const now = performance.now();
    if (now - this.lastRenderAt < MIN_RENDER_INTERVAL_MS) return;
    this.lastRenderAt = now;

    const d = this.dots;
    d.clear();
    const s = INNER / WORLD_WIDTH;
    const sy = INNER / WORLD_HEIGHT;
    const mx = (x: number) => INSET + x * s;
    const my = (y: number) => INSET + y * sy;

    for (const a of asteroids) {
      const r = Math.max(1, a.radius * s * 1.1);
      d.circle(mx(a.view.container.x), my(a.view.container.y), r);
    }
    d.fill({ color: ASTEROID_COLOR, alpha: 0.8 });

    // Own fleet: one batched fill of tiny squares.
    let fleetColor = 0xffffff;
    if (local) fleetColor = parseHexColor(local.color);
    let anyUnit = false;
    for (const u of units) {
      if (u.ownerId !== localSessionId) continue;
      d.rect(mx(u.view.container.x) - 0.5, my(u.view.container.y) - 0.5, 1, 1);
      anyUnit = true;
    }
    if (anyUnit) d.fill({ color: fleetColor, alpha: 0.55 });

    for (const st of structures) {
      const px = mx(st.view.container.x);
      const py = my(st.view.container.y);
      const size = st.kind === "base" ? 5 : 3;
      d.rect(px - size / 2, py - size / 2, size, size).fill({
        color: parseHexColor(st.color),
        alpha: 0.9,
      });
    }

    for (const w of wreckages) {
      const px = mx(w.view.container.x);
      const py = my(w.view.container.y);
      d.poly([px, py - 3, px + 3, py, px, py + 3, px - 3, py]).fill({ color: WRECK_COLOR, alpha: 0.9 });
    }

    for (const r of remotes) {
      if (r.hp <= 0) continue;
      d.circle(mx(r.renderedX), my(r.renderedY), 2.5).fill({ color: parseHexColor(r.color), alpha: 0.95 });
    }

    // Camera view rectangle.
    const vw = sw * s;
    const vh = sh * sy;
    d.rect(mx(camera.x) - vw / 2, my(camera.y) - vh / 2, vw, vh).stroke({
      color: 0xffffff,
      width: 1,
      alpha: 0.35,
    });

    if (local && local.hp > 0) {
      d.circle(mx(local.prediction.position.x), my(local.prediction.position.y), 3.25)
        .fill({ color: fleetColor, alpha: 1 })
        .stroke({ color: 0xffffff, width: 1, alpha: 0.95 });
    }
  }
}
