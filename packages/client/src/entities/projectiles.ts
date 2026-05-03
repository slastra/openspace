import { Container, Graphics } from "pixi.js";
import { PROJECTILE_RADIUS } from "@openspace/shared";
import { lighten, parseHexColor } from "../render/colors.js";
import { Renderer } from "../render/renderer.js";
import { ProjectileSnapshot } from "../net/client.js";

/**
 * Client-side mirror of a server Projectile. Constant-velocity, so we
 * extrapolate position from the latest snapshot anchor instead of
 * snapshot-interpolating with a buffer delay (which would render the
 * bullet ~150ms behind the server's hit, producing visible gaps where
 * the projectile pops out before reaching its target).
 *
 * Re-anchored on every server update so any clock drift between client
 * and server gets corrected without visible jumps.
 */
export class Projectile {
  readonly id: string;
  readonly view: Container;
  private anchorX: number;
  private anchorY: number;
  private anchorTime: number;
  private vx: number;
  private vy: number;

  constructor(snap: ProjectileSnapshot, renderer: Renderer) {
    this.id = snap.id;
    this.view = new Container();
    const tint = parseHexColor(snap.color);
    const bright = lighten(tint, 0.7);
    const glow = new Graphics();
    glow.circle(0, 0, PROJECTILE_RADIUS * 1.8).fill({ color: tint, alpha: 0.45 });
    const core = new Graphics();
    core.circle(0, 0, PROJECTILE_RADIUS * 0.8).fill({ color: bright, alpha: 1 });
    this.view.addChild(glow);
    this.view.addChild(core);
    this.view.x = snap.x;
    this.view.y = snap.y;
    renderer.entities.addChild(this.view);

    this.anchorX = snap.x;
    this.anchorY = snap.y;
    this.anchorTime = snap.serverTime;
    this.vx = snap.vx;
    this.vy = snap.vy;
  }

  applyServerUpdate(snap: ProjectileSnapshot) {
    this.anchorX = snap.x;
    this.anchorY = snap.y;
    this.anchorTime = snap.serverTime;
    this.vx = snap.vx;
    this.vy = snap.vy;
  }

  /** Position at server-time `t` (ms). */
  positionAt(t: number): { x: number; y: number } {
    const dt = (t - this.anchorTime) / 1000;
    return { x: this.anchorX + this.vx * dt, y: this.anchorY + this.vy * dt };
  }

  destroy(renderer: Renderer) {
    renderer.entities.removeChild(this.view);
    this.view.destroy({ children: true });
  }
}

export function renderProjectiles(
  projectiles: Map<string, Projectile>,
  serverNow: number,
) {
  for (const p of projectiles.values()) {
    const pos = p.positionAt(serverNow);
    p.view.x = pos.x;
    p.view.y = pos.y;
  }
}
