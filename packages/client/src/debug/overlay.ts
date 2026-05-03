import { Container, Graphics } from "pixi.js";
import { PLAYER_CONTACT_RADIUS, UNIT_KIND_META } from "@openspace/shared";
import type { LocalPlayer, RemotePlayer } from "../entities/players.js";
import type { Unit } from "../entities/units.js";
import type { Asteroid } from "../entities/asteroids.js";
import type { Structure } from "../entities/structures.js";
import { resolveRenderedPosition } from "../entities/lookup.js";

const COLOR_LOCAL = 0x4ade80;
const COLOR_REMOTE = 0x60a5fa;
const COLOR_UNIT = 0xa78bfa;
const COLOR_ASTEROID = 0xb8a07a;
const COLOR_TARGET_LINE = 0xfacc15;
const COLOR_DIVERGENCE = 0xf87171;

/**
 * F1-toggleable diagnostic overlay. Draws into world space so everything
 * lines up with entities. Redraws all geometry each frame; if profiling
 * ever shows it matters we can cache.
 *
 * Layers shown:
 *   - Hitboxes (circle outlines at each combatant's contact radius)
 *   - AI target lines (yellow line from each engaged unit to its target)
 *   - Server-vs-predicted divergence (red line from local server pos to predicted pos)
 */
export class DebugOverlay {
  readonly layer: Container;
  private readonly g: Graphics;
  private enabled = false;

  constructor(parent: Container) {
    this.layer = new Container({ label: "debug-overlay" });
    this.g = new Graphics();
    this.layer.addChild(this.g);
    this.layer.visible = false;
    parent.addChild(this.layer);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.layer.visible = this.enabled;
    if (!this.enabled) this.g.clear();
  }

  isEnabled() {
    return this.enabled;
  }

  render(
    local: LocalPlayer | null,
    remotes: Map<string, RemotePlayer>,
    units: Map<string, Unit>,
    asteroids: Map<string, Asteroid>,
    structures: Map<string, Structure>,
    localSessionId: string,
  ) {
    if (!this.enabled) return;
    this.g.clear();

    // Local player: hitbox + server-vs-predicted divergence line.
    if (local) {
      const lx = local.prediction.position.x;
      const ly = local.prediction.position.y;
      this.g
        .circle(lx, ly, PLAYER_CONTACT_RADIUS)
        .stroke({ color: COLOR_LOCAL, width: 1, alpha: 0.85 });
      const sp = local.prediction.serverPosition;
      this.g
        .moveTo(sp.x, sp.y)
        .lineTo(lx, ly)
        .stroke({ color: COLOR_DIVERGENCE, width: 1, alpha: 0.85 });
      this.g.circle(sp.x, sp.y, 2).fill({ color: COLOR_DIVERGENCE, alpha: 0.9 });
    }

    // Remote players: hitboxes at last rendered position.
    for (const r of remotes.values()) {
      this.g
        .circle(r.renderedX, r.renderedY, PLAYER_CONTACT_RADIUS)
        .stroke({ color: COLOR_REMOTE, width: 1, alpha: 0.65 });
    }

    // Asteroids: hitbox circle (visible polygon is jagged so the actual
    // collider radius isn't otherwise obvious).
    for (const a of asteroids.values()) {
      this.g
        .circle(a.view.container.x, a.view.container.y, a.radius)
        .stroke({ color: COLOR_ASTEROID, width: 0.75, alpha: 0.65 });
    }

    // Units: hitboxes + target lines.
    for (const u of units.values()) {
      const ux = u.view.container.x;
      const uy = u.view.container.y;
      const r = UNIT_KIND_META[u.kind]?.contactRadius ?? 9;
      this.g
        .circle(ux, uy, r)
        .stroke({ color: COLOR_UNIT, width: 0.75, alpha: 0.6 });

      if (u.targetId) {
        const target = resolveRenderedPosition(
          u.targetId,
          local,
          localSessionId,
          remotes,
          units,
          structures,
        );
        if (target) {
          this.g
            .moveTo(ux, uy)
            .lineTo(target.x, target.y)
            .stroke({ color: COLOR_TARGET_LINE, width: 1, alpha: 0.65 });
        }
      }
    }
  }
}
