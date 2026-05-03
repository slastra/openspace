import { Application, Container, Graphics } from "pixi.js";
import { VISION_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from "@openspace/shared";
import type { Asteroid } from "../entities/asteroids.js";
import type { LocalPlayer, RemotePlayer } from "../entities/players.js";
import type { Structure } from "../entities/structures.js";
import type { Unit } from "../entities/units.js";
import { parseHexColor } from "./colors.js";

const MAP_SIZE = 160;
const EDGE_OFFSET_X = 18;
const EDGE_OFFSET_Y = 14;
const CORNER_RADIUS = 6;
const BG_COLOR = 0x0a0e1a;
const BG_ALPHA = 0.65;
const FRAME_COLOR = 0x2a3346;
const ASTEROID_COLOR = 0x8a7656;

/**
 * Bottom-right corner minimap. Pinned to screen space (added to app.stage,
 * not the camera-transformed world container) so it stays fixed regardless
 * of pan/zoom. Asteroids render as small tan dots; remote players as larger
 * tinted dots; the local player as a white-outlined dot in their color.
 *
 * Redrawn every frame — entity counts are small (~12 asteroids + ~8 ships)
 * so the cost is trivial vs anything else in the per-frame loop.
 */
export class Minimap {
  readonly container: Container;
  private readonly bg: Graphics;
  private readonly dots: Graphics;
  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
    this.container = new Container({ label: "minimap" });
    this.bg = new Graphics();
    this.dots = new Graphics();
    this.container.addChild(this.bg);
    this.container.addChild(this.dots);
    app.stage.addChild(this.container);

    this.bg
      .roundRect(0, 0, MAP_SIZE, MAP_SIZE, CORNER_RADIUS)
      .fill({ color: BG_COLOR, alpha: BG_ALPHA })
      .stroke({ color: FRAME_COLOR, width: 1, alpha: 0.9 });
  }

  render(
    asteroids: Iterable<Asteroid>,
    structures: Iterable<Structure>,
    units: Iterable<Unit>,
    local: LocalPlayer | null,
    localSessionId: string,
    remotes: Iterable<RemotePlayer>,
  ) {
    this.container.x = this.app.screen.width - MAP_SIZE - EDGE_OFFSET_X;
    this.container.y = this.app.screen.height - MAP_SIZE - EDGE_OFFSET_Y;

    this.dots.clear();
    const sx = MAP_SIZE / WORLD_WIDTH;
    const sy = MAP_SIZE / WORLD_HEIGHT;

    // Collect every friendly position to use as vision sources for the
    // enemy-structure fog. Local ship + units owned by us count.
    const friendlies: { x: number; y: number }[] = [];
    if (local) friendlies.push(local.prediction.position);
    for (const u of units) {
      if (u.ownerId === localSessionId) {
        friendlies.push({ x: u.view.container.x, y: u.view.container.y });
      }
    }
    const visionSq = VISION_RADIUS * VISION_RADIUS;
    const visibleToFriendly = (x: number, y: number) => {
      for (const f of friendlies) {
        const dx = f.x - x;
        const dy = f.y - y;
        if (dx * dx + dy * dy <= visionSq) return true;
      }
      return false;
    };

    for (const a of asteroids) {
      // Dot size proportional to actual radius so big rocks stand out as juicy targets.
      const dot = Math.max(0.9, a.radius * sx * 1.2);
      this.dots
        .circle(a.view.container.x * sx, a.view.container.y * sy, dot)
        .fill({ color: ASTEROID_COLOR, alpha: 0.85 });
    }

    // Structures: own ones always visible; enemy ones only revealed when a
    // friendly entity is within VISION_RADIUS of them (fog of war).
    for (const s of structures) {
      const isMine = s.ownerId === localSessionId;
      if (!isMine && !visibleToFriendly(s.view.container.x, s.view.container.y)) {
        continue;
      }
      const px = s.view.container.x * sx;
      const py = s.view.container.y * sy;
      this.dots
        .rect(px - 2, py - 2, 4, 4)
        .fill({ color: parseHexColor(s.color), alpha: 0.85 });
    }

    for (const r of remotes) {
      this.dots
        .circle(r.renderedX * sx, r.renderedY * sy, 2.5)
        .fill({ color: parseHexColor(r.color), alpha: 0.95 });
    }

    if (local) {
      this.dots
        .circle(local.prediction.position.x * sx, local.prediction.position.y * sy, 3.25)
        .fill({ color: parseHexColor(local.color), alpha: 1 })
        .stroke({ color: 0xffffff, width: 1, alpha: 0.95 });
    }
  }
}
