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
const SPAWN_CHANCE_PER_SECOND = 18;

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
      const miner = findMinerNear(a, ax, ay, units, local, remotes);
      if (!miner) continue;
      // Probabilistic spawn — average ~SPAWN_CHANCE_PER_SECOND per active link.
      if (Math.random() < spawnP) {
        const angle = Math.atan2(miner.y - ay, miner.x - ax) + (Math.random() - 0.5) * 0.8;
        this.particles.push({
          sx: ax + Math.cos(angle) * a.radius * 0.95,
          sy: ay + Math.sin(angle) * a.radius * 0.95,
          ex: miner.x,
          ey: miner.y,
          age: 0,
        });
      }
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

/** First mining-capable thing within reach of this asteroid (units first, then ships). */
function findMinerNear(
  a: Asteroid,
  ax: number,
  ay: number,
  units: Map<string, Unit>,
  local: LocalPlayer | null,
  remotes: Iterable<RemotePlayer>,
): { x: number; y: number } | null {
  for (const u of units.values()) {
    const meta = UNIT_KIND_META[u.kind];
    if (!meta?.miningDps) continue;
    if (u.targetId !== a.id) continue;
    const ux = u.view.container.x;
    const uy = u.view.container.y;
    const reach = meta.contactRadius + a.radius + (meta.miningReach ?? 0);
    const dx = ax - ux;
    const dy = ay - uy;
    if (dx * dx + dy * dy <= reach * reach) return { x: ux, y: uy };
  }
  const reach = PLAYER_CONTACT_RADIUS + a.radius + PLAYER_MINING_REACH;
  const reachSq = reach * reach;
  if (local) {
    const px = local.prediction.position.x;
    const py = local.prediction.position.y;
    if ((ax - px) ** 2 + (ay - py) ** 2 <= reachSq) return { x: px, y: py };
  }
  for (const r of remotes) {
    if ((ax - r.renderedX) ** 2 + (ay - r.renderedY) ** 2 <= reachSq) {
      return { x: r.renderedX, y: r.renderedY };
    }
  }
  return null;
}
