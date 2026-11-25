import {
  ASTEROID_TIERS,
  ArenaState,
  STRUCTURE_KIND_META,
  UNIT_KIND_META,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  clamp,
  formationRadius,
  formationSlotOffset,
  shortestAngleDelta,
} from "@openspace/shared";
import type { Unit } from "@openspace/shared";
import type { TickGrids } from "./spatial.js";

/**
 * Formations: every group of units sharing an anchor (an owner's ship, or
 * the wreckage orphans orbit) holds a sunflower disc around it (layout in
 * shared/src/formation.ts). This module owns the per-anchor frame and the
 * unit → slot assignment, and hands the simulation a target (position +
 * velocity) per unit. Steering toward it is `holdFormation`.
 */

/** Rim speed (u/s) of the parked spin. ω = RIM_SPEED / rimRadius, so the
 *  disc turns at the same gentle edge speed whatever its size. */
const RIM_SPEED = 40;
/** Anchor speed below which the disc spins at full rate. */
const SPIN_FREEZE_LO_SPEED = 30;
/** Anchor speed at and above which the disc stops spinning: units follow a
 *  moving ship rigidly rather than chasing slots that also rotate. */
const SPIN_FREEZE_HI_SPEED = 100;
/** Gap kept between a slot and the world edge (beyond the unit's radius). */
const WORLD_EDGE_MARGIN = 14;
/** Proportional gain (1/s) of the formation controller: position error
 *  decays with time constant 1/K = 0.25 s. */
const FORMATION_GAIN = 4;

/** Per-anchor state, kept across ticks in `SimContext.formations`. */
export interface FormationState {
  /** Rigid rotation of the whole disc (radians). */
  angle: number;
  /** Member unit ids joined in state order; a change triggers reassignment. */
  memberKey: string;
  /** unit id → slot index. */
  slotOf: Map<string, number>;
}

/** Where a unit should be this tick, and how fast that point is moving. */
export interface FormationTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Anchor {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Anchor key for a unit: its wreckage while orphaned, else its owner. */
function anchorKeyOf(unit: Unit): string {
  return unit.wreckageId || unit.ownerId;
}

/**
 * Advance every formation one tick and return each live unit's target.
 * `ownerVelocity` reads a player's commanded velocity for this tick (the
 * anchor's feed-forward). Units whose anchor is gone get no target.
 */
export function planFormations(
  state: ArenaState,
  formations: Map<string, FormationState>,
  ownerVelocity: (ownerId: string) => { x: number; y: number },
  dt: number,
): Map<string, FormationTarget> {
  const groups = new Map<string, Unit[]>();
  for (const u of state.units.values()) {
    if (u.hp <= 0) continue;
    const key = anchorKeyOf(u);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(u);
  }

  for (const key of formations.keys()) {
    if (!groups.has(key)) formations.delete(key);
  }

  const targets = new Map<string, FormationTarget>();
  for (const [key, units] of groups) {
    const anchor = resolveAnchor(state, units[0]!, ownerVelocity);
    if (!anchor) continue;

    let f = formations.get(key);
    if (!f) {
      f = { angle: 0, memberKey: "", slotOf: new Map() };
      formations.set(key, f);
    }
    const memberKey = units.map((u) => u.id).join(",");
    if (memberKey !== f.memberKey) {
      f.slotOf = assignSlots(units, anchor, f);
      f.memberKey = memberKey;
    }

    const speed = Math.hypot(anchor.vx, anchor.vy);
    const spin = clamp(
      1 - (speed - SPIN_FREEZE_LO_SPEED) / (SPIN_FREEZE_HI_SPEED - SPIN_FREEZE_LO_SPEED),
      0,
      1,
    );
    const omega = (RIM_SPEED / formationRadius(units.length)) * spin;
    f.angle += omega * dt;

    for (const u of units) {
      const off = formationSlotOffset(f.slotOf.get(u.id) ?? 0, f.angle);
      const margin = (UNIT_KIND_META[u.kind]?.contactRadius ?? 0) + WORLD_EDGE_MARGIN;
      targets.set(u.id, {
        x: clamp(anchor.x + off.x, margin, WORLD_WIDTH - margin),
        y: clamp(anchor.y + off.y, margin, WORLD_HEIGHT - margin),
        // Rigid-body velocity of the slot: anchor velocity + ω × offset.
        vx: anchor.vx - omega * off.y,
        vy: anchor.vy + omega * off.x,
      });
    }
  }
  return targets;
}

function resolveAnchor(
  state: ArenaState,
  unit: Unit,
  ownerVelocity: (ownerId: string) => { x: number; y: number },
): Anchor | null {
  if (unit.wreckageId) {
    const w = state.wreckages.get(unit.wreckageId);
    return w ? { x: w.x, y: w.y, vx: 0, vy: 0 } : null;
  }
  const owner = state.players.get(unit.ownerId);
  if (!owner) return null;
  const v = ownerVelocity(owner.id);
  return { x: owner.x, y: owner.y, vx: v.x, vy: v.y };
}

/**
 * Hand out slots 0..n-1. Units are banded by `formationTier` (lower tiers
 * take the inner indices). Within a band, a unit keeps its previous slot
 * when that slot is still in the band; displaced units and newcomers then
 * take the nearest free slot. A spawn or death therefore moves at most one
 * unit per band: shifting a band by one index changes its slot set by
 * exactly one position.
 */
function assignSlots(units: Unit[], anchor: Anchor, f: FormationState): Map<string, number> {
  const tierOf = (u: Unit) => UNIT_KIND_META[u.kind]?.formationTier ?? 999;
  const ordered = [...units].sort((a, b) => tierOf(a) - tierOf(b) || a.slotIndex - b.slotIndex);

  const out = new Map<string, number>();
  let start = 0;
  while (start < ordered.length) {
    const tier = tierOf(ordered[start]!);
    let end = start;
    while (end < ordered.length && tierOf(ordered[end]!) === tier) end++;
    assignBand(ordered.slice(start, end), start, anchor, f, out);
    start = end;
  }
  return out;
}

function assignBand(
  band: Unit[],
  firstSlot: number,
  anchor: Anchor,
  f: FormationState,
  out: Map<string, number>,
) {
  const lastSlot = firstSlot + band.length; // exclusive
  const taken = new Set<number>();
  const unplaced: Unit[] = [];
  for (const u of band) {
    const prev = f.slotOf.get(u.id);
    if (prev !== undefined && prev >= firstSlot && prev < lastSlot) {
      taken.add(prev);
      out.set(u.id, prev);
    } else {
      unplaced.push(u);
    }
  }
  // `band` is in spawn order, so older units pick first.
  for (const u of unplaced) {
    let best = -1;
    let bestD2 = Infinity;
    for (let index = firstSlot; index < lastSlot; index++) {
      if (taken.has(index)) continue;
      const off = formationSlotOffset(index, f.angle);
      const d2 = (anchor.x + off.x - u.x) ** 2 + (anchor.y + off.y - u.y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = index;
      }
    }
    taken.add(best);
    out.set(u.id, best);
  }
}

/**
 * Formation steering: follow the slot's own velocity (feed-forward) plus a
 * proportional correction toward it, capped at `maxCorrection`. First order,
 * so a unit eases onto its slot without overshoot and sits still on it with
 * no dead band to twitch across.
 */
export function holdFormation(
  unit: { x: number; y: number },
  target: FormationTarget,
  maxCorrection: number,
): { vx: number; vy: number } {
  let cx = (target.x - unit.x) * FORMATION_GAIN;
  let cy = (target.y - unit.y) * FORMATION_GAIN;
  const mag = Math.hypot(cx, cy);
  if (mag > maxCorrection) {
    cx *= maxCorrection / mag;
    cy *= maxCorrection / mag;
  }
  return { vx: target.vx + cx, vy: target.vy + cy };
}

/** Gap kept between a detouring unit and an obstacle's surface. */
const OBSTACLE_CLEARANCE = 8;

/** Collision radius of a structure: its ball radius, or the corner
 *  distance of a cuboid wall. */
function structureObstacleRadius(kind: string): number {
  const meta = STRUCTURE_KIND_META[kind];
  if (!meta) return 0;
  return meta.colliderShape === "cuboid" ? meta.halfExtent * Math.SQRT2 : meta.halfExtent;
}

/** Largest obstacle radius, so one grid query finds every candidate. */
const MAX_OBSTACLE_RADIUS = Math.max(
  ...ASTEROID_TIERS.map((t) => t.radius),
  ...Object.keys(STRUCTURE_KIND_META).map(structureObstacleRadius),
);

/**
 * Detour for a formation unit whose way to its slot is blocked by a solid
 * obstacle (an asteroid or an enemy structure; its own structures let it
 * through). Returns null when the path is clear, so the caller uses
 * `holdFormation`.
 *
 * Blocked means the straight path to the slot crosses the obstacle's
 * inflated circle, or the slot itself lies inside it. The detour is a
 * velocity in the obstacle's polar frame: a tangential part that circles
 * toward the slot's side and slows as it reaches the slot's angle, and a
 * radial part that holds the unit on the inflated rim. A slot buried in a
 * rock therefore parks its unit on the rim nearest it, and a formation
 * sweeping over a rock flows around it. Pushing the slot target out of the
 * rock doesn't work: that target flips from the near rim to the far one as
 * the formation passes, and units drive straight through. Chasing a
 * waypoint on the rim doesn't either: the pursuit spirals inward.
 */
export function detourVelocity(
  unit: Unit,
  target: FormationTarget,
  unitRadius: number,
  grids: TickGrids,
  maxSpeed: number,
): { vx: number; vy: number } | null {
  const sx = unit.x;
  const sy = unit.y;
  const dx = target.x - sx;
  const dy = target.y - sy;
  const len2 = dx * dx + dy * dy;
  const pad = unitRadius + OBSTACLE_CLEARANCE;

  // The blocking obstacle closest to the unit along its path.
  let block: { cx: number; cy: number; r: number; t: number } | null = null;
  const consider = (cx: number, cy: number, radius: number) => {
    const r = radius + pad;
    const t = len2 > 1e-9 ? clamp(((cx - sx) * dx + (cy - sy) * dy) / len2, 0, 1) : 0;
    const px = sx + dx * t - cx;
    const py = sy + dy * t - cy;
    if (px * px + py * py >= r * r) return;
    if (!block || t < block.t) block = { cx, cy, r, t };
  };
  const midX = sx + dx / 2;
  const midY = sy + dy / 2;
  const reach = Math.sqrt(len2) / 2 + MAX_OBSTACLE_RADIUS + pad;
  grids.asteroids.forEachInRadius(midX, midY, reach, (a) => {
    if (a.hp > 0) consider(a.x, a.y, a.radius);
  });
  grids.structures.forEachInRadius(midX, midY, reach, (s) => {
    if (s.hp > 0 && s.ownerId !== unit.ownerId) consider(s.x, s.y, structureObstacleRadius(s.kind));
  });
  if (!block) return null;

  const { cx, cy, r } = block;
  const ru = Math.hypot(sx - cx, sy - cy);
  // Outward normal at the unit, and the tangent turning toward the slot.
  const nx = ru > 1e-6 ? (sx - cx) / ru : 1;
  const ny = ru > 1e-6 ? (sy - cy) / ru : 0;
  const delta = shortestAngleDelta(
    Math.atan2(ny, nx),
    Math.atan2(target.y - cy, target.x - cx),
  );
  const turn = delta >= 0 ? 1 : -1;
  const tx = -ny * turn;
  const ty = nx * turn;

  // Around the rim, easing in over the remaining arc; plus the slot's own
  // motion along the tangent (its radial part would push into the rock).
  const along = Math.min(maxSpeed, FORMATION_GAIN * Math.abs(delta) * r) + target.vx * tx + target.vy * ty;
  // Back onto the rim from either side.
  const out = clamp(FORMATION_GAIN * (r - ru), -maxSpeed, maxSpeed);
  return { vx: tx * along + nx * out, vy: ty * along + ny * out };
}
