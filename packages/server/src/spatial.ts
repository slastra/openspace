import {
  ArenaState,
  Asteroid,
  Combatant,
  WORLD_WIDTH,
  isNeutral,
  teamOf,
} from "@openspace/shared";
import type { Unit } from "@openspace/shared";

/** Cell edge length in world units. Sized just above the largest aggro
 *  radius (~460u) so most queries (target acquire, separation) only touch
 *  a 3×3 cell window. Powers of two are mildly cheaper for the integer
 *  divide, and 512 keeps the 12000² world to ~24×24 = 576 cells — small
 *  enough that a full clear/rebuild is microseconds. */
const CELL_SIZE = 512;
const INV_CELL = 1 / CELL_SIZE;
const COLS = Math.ceil(WORLD_WIDTH / CELL_SIZE) + 2;

/**
 * Uniform spatial grid for coarse "what's near (x,y)?" queries. Holds
 * references to live entities only; rebuilt fresh each tick (cheaper than
 * incremental insert/remove given how often entities move). Generic over
 * item type so the same class serves combatants, units-only, and asteroids.
 *
 * The class never distance-checks — it returns candidates in the cells
 * overlapping the query AABB. Callers do the radius check on the (small)
 * candidate list. This keeps the grid agnostic to query semantics
 * (nearest-enemy vs. neighbors-for-separation vs. mining-reach).
 */
export class SpatialGrid<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();

  clear() {
    // Drop the buckets; reusing the inner arrays is tempting but a fresh
    // Map outpaces walking + truncating every bucket from last tick.
    this.cells.clear();
  }

  insert(item: T) {
    const cx = (item.x * INV_CELL) | 0;
    const cy = (item.y * INV_CELL) | 0;
    const key = cy * COLS + cx;
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
  }

  /** Yield every item in cells overlapping a circle of `radius` around (x,y).
   *  May surface items just outside the radius (cell-AABB grain) — caller
   *  does the precise distance check. */
  forEachInRadius(x: number, y: number, radius: number, cb: (item: T) => void) {
    const minCx = ((x - radius) * INV_CELL) | 0;
    const maxCx = ((x + radius) * INV_CELL) | 0;
    const minCy = ((y - radius) * INV_CELL) | 0;
    const maxCy = ((y + radius) * INV_CELL) | 0;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(cy * COLS + cx);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) cb(bucket[i]!);
      }
    }
  }
}

/**
 * Per-tick spatial grids threaded through SimContext. Allocated once by
 * ArenaRoom and rebuilt at the top of every `simulateTick`.
 */
export interface TickGrids {
  /** All hostile-targetable entities (live players + non-orphan units +
   *  live structures). Used for target acquisition. */
  combatants: SpatialGrid<Combatant>;
  /** Live non-orphan units only. Used for unit-vs-unit separation. */
  units: SpatialGrid<Unit>;
  /** Live asteroids. Used for miner targeting + ship mining reach. */
  asteroids: SpatialGrid<Asteroid>;
}

export function createTickGrids(): TickGrids {
  return {
    combatants: new SpatialGrid<Combatant>(),
    units: new SpatialGrid<Unit>(),
    asteroids: new SpatialGrid<Asteroid>(),
  };
}

export function rebuildTickGrids(grids: TickGrids, state: ArenaState) {
  grids.combatants.clear();
  grids.units.clear();
  grids.asteroids.clear();
  for (const p of state.players.values()) {
    if (p.hp > 0) grids.combatants.insert(p);
  }
  for (const u of state.units.values()) {
    if (u.hp <= 0) continue;
    if (isNeutral(u)) continue;
    grids.combatants.insert(u);
    grids.units.insert(u);
  }
  for (const s of state.structures.values()) {
    if (s.hp > 0) grids.combatants.insert(s);
  }
  for (const a of state.asteroids.values()) {
    if (a.hp > 0) grids.asteroids.insert(a);
  }
}

/** Grid-accelerated equivalent of `nearestEnemy` from shared/combat.ts. */
export function gridNearestEnemy(
  grid: SpatialGrid<Combatant>,
  team: string,
  x: number,
  y: number,
  radius: number,
): Combatant | null {
  let best: Combatant | null = null;
  let bestD2 = radius * radius;
  grid.forEachInRadius(x, y, radius, (c) => {
    if (c.hp <= 0) return;
    if (teamOf(c) === team) return;
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  });
  return best;
}

/** Grid-accelerated equivalent of `nearestFriendlyDamaged` (repair drone target). */
export function gridNearestFriendlyDamaged(
  grid: SpatialGrid<Combatant>,
  team: string,
  selfId: string,
  x: number,
  y: number,
  radius: number,
): Combatant | null {
  let best: Combatant | null = null;
  let bestD2 = radius * radius;
  grid.forEachInRadius(x, y, radius, (c) => {
    if (c.hp <= 0) return;
    if (c.hp >= c.maxHp) return;
    if (c.id === selfId) return;
    if (teamOf(c) !== team) return;
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  });
  return best;
}

/** Grid-accelerated equivalent of `nearestAsteroid`. */
export function gridNearestAsteroid(
  grid: SpatialGrid<Asteroid>,
  x: number,
  y: number,
  radius: number,
): Asteroid | null {
  let best: Asteroid | null = null;
  let bestD2 = radius * radius;
  grid.forEachInRadius(x, y, radius, (a) => {
    if (a.hp <= 0) return;
    const dx = a.x - x;
    const dy = a.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = a;
    }
  });
  return best;
}
