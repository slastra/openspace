import { Container, Graphics } from "pixi.js";
import {
  PLAYER_CONTACT_RADIUS,
  PLAYER_MINING_REACH,
  UNIT_KIND_META,
} from "@openspace/shared";
import type { Asteroid } from "../entities/asteroids.js";
import type { LocalPlayer, RemotePlayer } from "../entities/players.js";
import type { Unit } from "../entities/units.js";

const COLOR = 0xfacc15;
const LIFE = 0.5;
/** Per-link spawn rate (poisson). At 35/sec with 0.5s lifetime there's
 *  always ~17 particles in flight — random gaps stay below ~50ms even
 *  in the worst RNG runs, so the stream reads as continuous. */
const SPAWN_CHANCE_PER_SECOND = 35;
/** Extra slack added to the visual reach check beyond the server's
 *  contact-radius + asteroid radius + miningReach formula. Covers the
 *  ~150ms interpolation lag at mining onset and the few-pixel Rapier
 *  jitter while the miner is pressed against the rock — without this,
 *  the visual gate flickered off whenever the rendered position was
 *  briefly outside the tiny `miningReach` window. */
const VISUAL_REACH_SLACK = 30;

interface Particle {
  sx: number; sy: number;
  ex: number; ey: number;
  age: number;
}

/**
 * Tiny mineral motes that drift from each asteroid toward whatever's
 * mining it (a miner unit, or a player ship parked on it). Spawned
 * stochastically each frame; one shared Graphics for cheap batched draw.
 */
export class MiningParticleLayer {
  readonly layer: Container;
  private readonly g: Graphics;
  private particles: Particle[] = [];

  constructor(parent: Container) {
    this.layer = new Container({ label: "mining-particles" });
    this.g = new Graphics();
    this.layer.addChild(this.g);
    parent.addChild(this.layer);
  }

  render(
    asteroids: Map<string, Asteroid>,
    units: Map<string, Unit>,
    local: LocalPlayer | null,
    remotes: Iterable<RemotePlayer>,
    dt: number,
  ) {
    const spawnP = dt * SPAWN_CHANCE_PER_SECOND;

    for (const a of asteroids.values()) {
      const ax = a.view.container.x;
      const ay = a.view.container.y;
      // Spawn one stream per active miner on this asteroid (not just the
      // first one) so a stack of miners reads as proportionally busier.
      collectMinersNear(a, ax, ay, units, local, remotes, (mx, my) => {
        if (Math.random() >= spawnP) return;
        const angle = Math.atan2(my - ay, mx - ax) + (Math.random() - 0.5) * 0.8;
        this.particles.push({
          sx: ax + Math.cos(angle) * a.radius * 0.95,
          sy: ay + Math.sin(angle) * a.radius * 0.95,
          ex: mx,
          ey: my,
          age: 0,
        });
      });
    }

    this.g.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age >= LIFE) {
        this.particles.splice(i, 1);
        continue;
      }
      const t = p.age / LIFE;
      const eased = t * t; // accelerate as ore is "pulled in"
      const x = p.sx + (p.ex - p.sx) * eased;
      const y = p.sy + (p.ey - p.sy) * eased;
      this.g.circle(x, y, 1.5).fill({ color: COLOR, alpha: 1 - t });
    }
  }
}

/** Yield (x, y) for every mining-capable entity in (relaxed) reach of
 *  this asteroid: every miner unit targeting it, plus the local player
 *  ship and any remote ship parked on it. Reach uses the server's gate
 *  plus VISUAL_REACH_SLACK so brief interpolation lag / physics jitter
 *  doesn't drop the visual stream. */
function collectMinersNear(
  a: Asteroid,
  ax: number,
  ay: number,
  units: Map<string, Unit>,
  local: LocalPlayer | null,
  remotes: Iterable<RemotePlayer>,
  yield_: (mx: number, my: number) => void,
): void {
  for (const u of units.values()) {
    const meta = UNIT_KIND_META[u.kind];
    if (!meta?.miningDps) continue;
    if (u.targetId !== a.id) continue;
    const ux = u.view.container.x;
    const uy = u.view.container.y;
    const reach =
      meta.contactRadius + a.radius + (meta.miningReach ?? 0) + VISUAL_REACH_SLACK;
    const dx = ax - ux;
    const dy = ay - uy;
    if (dx * dx + dy * dy <= reach * reach) yield_(ux, uy);
  }
  const shipReach =
    PLAYER_CONTACT_RADIUS + a.radius + PLAYER_MINING_REACH + VISUAL_REACH_SLACK;
  const shipReachSq = shipReach * shipReach;
  if (local) {
    const px = local.prediction.position.x;
    const py = local.prediction.position.y;
    if ((ax - px) ** 2 + (ay - py) ** 2 <= shipReachSq) yield_(px, py);
  }
  for (const r of remotes) {
    if ((ax - r.renderedX) ** 2 + (ay - r.renderedY) ** 2 <= shipReachSq) {
      yield_(r.renderedX, r.renderedY);
    }
  }
}
