import { Container, Graphics } from "pixi.js";
import { UNIT_KIND_META } from "@openspace/shared";
import type { LocalPlayer, RemotePlayer } from "../entities/players.js";
import type { Structure } from "../entities/structures.js";
import type { Unit } from "../entities/units.js";
import { resolveRenderedPosition } from "../entities/lookup.js";

const TETHER_COLOR = 0x4ade80;
const TETHER_GLOW_WIDTH = 4;
const TETHER_CORE_WIDTH = 1.25;

/**
 * Draws live heal-tethers from each repair unit to its current target.
 * Held by `game.ts` and called once per frame after entity rendering.
 *
 * Continuous-beam effect (vs the laser's discrete pulse) — the tether is
 * cleared and re-stroked every frame from current rendered positions, with
 * a subtle alpha pulse so it visibly "flows" without burning effects budget.
 *
 * Hidden when the source unit has no target or the target isn't on screen.
 */
export class HealTetherLayer {
  readonly layer: Container;
  private readonly g: Graphics;

  constructor(parent: Container) {
    this.layer = new Container({ label: "heal-tethers" });
    this.g = new Graphics();
    this.layer.addChild(this.g);
    parent.addChild(this.layer);
  }

  /**
   * `time` in seconds drives the alpha pulse so all tethers shimmer in sync.
   * `localSessionId` lets us look up the local player by id.
   */
  render(
    units: Map<string, Unit>,
    structures: Map<string, Structure>,
    local: LocalPlayer | null,
    remotes: Map<string, RemotePlayer>,
    localSessionId: string,
    time: number,
  ): void {
    this.g.clear();
    // Pulse 0.7..1.0 alpha — lively without being distracting.
    const pulse = 0.85 + 0.15 * Math.sin(time * 6);

    for (const u of units.values()) {
      const meta = UNIT_KIND_META[u.kind];
      const range = meta?.repairRange ?? 0;
      if (range <= 0) continue;
      if (!u.targetId) continue;
      const tgt = resolveRenderedPosition(
        u.targetId,
        local,
        localSessionId,
        remotes,
        units,
        structures,
      );
      if (!tgt) continue;

      const sx = u.view.container.x;
      const sy = u.view.container.y;
      const dx = tgt.x - sx;
      const dy = tgt.y - sy;
      const dist = Math.hypot(dx, dy);
      // Server only heals when in range; mirror that gate visually so a
      // tether doesn't render across the map while the drone is closing.
      if (dist > range) continue;
      // Fade alpha by distance like the laser beam — close-tether is bold,
      // edge-of-range tether is wispy.
      const distFade = Math.max(0.4, 1 - 0.55 * (dist / range));
      const alpha = pulse * distFade;

      this.g
        .moveTo(sx, sy)
        .lineTo(tgt.x, tgt.y)
        .stroke({ color: TETHER_COLOR, width: TETHER_GLOW_WIDTH, alpha: 0.4 * alpha });
      this.g
        .moveTo(sx, sy)
        .lineTo(tgt.x, tgt.y)
        .stroke({ color: 0xffffff, width: TETHER_CORE_WIDTH, alpha: 0.85 * alpha });
    }
  }
}

