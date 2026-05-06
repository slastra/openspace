import {
  MAX_UNITS_PER_PLAYER,
  PLAYER_FLEET_DRAG_FLOOR,
  PLAYER_FULL_SPEED_DIST,
  PLAYER_INPUT_DEADZONE,
  PLAYER_SPEED,
  TICK_DT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants.js";
import { clamp } from "./math.js";
import type { PlayerInput } from "./types.js";

/**
 * Multiplicative speed factor the captain takes from their own fleet.
 * Linear ramp from 1.0 at zero owned units to PLAYER_FLEET_DRAG_FLOOR at
 * MAX_UNITS_PER_PLAYER, clamped on either side. Composes with the dash
 * multiplier (`dash * fleet`) — server applies it in `applyPlayerInputs`
 * and the client predictor reads the same field off the synced snapshot
 * so prediction stays aligned without re-deriving on the client.
 */
export function playerFleetDragFactor(ownedUnitCount: number): number {
  const t = Math.min(1, Math.max(0, ownedUnitCount / MAX_UNITS_PER_PLAYER));
  return 1 - (1 - PLAYER_FLEET_DRAG_FLOOR) * t;
}

export interface PlayerKinematics {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Player desired velocity from cursor target. Used by both client prediction
 * (via stepPlayer) and the server's physics input pass — they MUST agree
 * here or prediction reconcile drifts every frame.
 *
 *   - dist <= PLAYER_INPUT_DEADZONE: zero (cursor on/near ship → ship stops)
 *   - dist >= PLAYER_FULL_SPEED_DIST: full PLAYER_SPEED
 *   - in between: linear ramp (0 at deadzone, full at full-speed-dist)
 *
 * Returns the desired velocity vector and the scalar speed (for callers that
 * want to special-case "stopped").
 */
export function playerDesiredVelocity(
  px: number,
  py: number,
  targetX: number,
  targetY: number,
  /** Multiplier on PLAYER_SPEED — used by dash to apply a temporary boost.
   *  Server and client predictor pass the same value (derived from the
   *  player's `dashUntil` schema field) so prediction stays in sync. */
  speedMultiplier: number = 1,
): { vx: number; vy: number; speed: number } {
  const dx = targetX - px;
  const dy = targetY - py;
  const dist = Math.hypot(dx, dy);
  if (dist <= PLAYER_INPUT_DEADZONE) return { vx: 0, vy: 0, speed: 0 };
  const range = PLAYER_FULL_SPEED_DIST - PLAYER_INPUT_DEADZONE;
  const scale = range > 0 ? Math.min(1, (dist - PLAYER_INPUT_DEADZONE) / range) : 1;
  const speed = PLAYER_SPEED * scale * speedMultiplier;
  const inv = 1 / dist;
  return { vx: dx * inv * speed, vy: dy * inv * speed, speed };
}

/**
 * Advance a kinematic player one tick toward the cursor target. Used by the
 * CLIENT for local-player prediction; the server uses Rapier dynamics.
 *
 * The two diverge on collisions (server pushes the player around; client
 * doesn't see it) — `RECONCILE_SNAP_THRESHOLD` plus the standard reconcile
 * keeps the displayed position aligned with authority.
 */
export function stepPlayer(
  current: PlayerKinematics,
  input: PlayerInput,
  dt: number = TICK_DT,
  speedMultiplier: number = 1,
): PlayerKinematics {
  const desired = playerDesiredVelocity(
    current.x,
    current.y,
    input.targetX,
    input.targetY,
    speedMultiplier,
  );
  if (desired.speed === 0) {
    return { x: current.x, y: current.y, rotation: current.rotation };
  }
  const nx = current.x + desired.vx * dt;
  const ny = current.y + desired.vy * dt;
  return {
    x: clamp(nx, 0, WORLD_WIDTH),
    y: clamp(ny, 0, WORLD_HEIGHT),
    rotation: Math.atan2(desired.vy, desired.vx),
  };
}

