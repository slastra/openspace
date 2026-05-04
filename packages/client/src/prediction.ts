import {
  PLAYER_CONTACT_RADIUS,
  PlayerInput,
  RECONCILE_SNAP_THRESHOLD,
  TICK_DT,
  clamp01,
  lerp,
  lerpAngle,
  stepPlayer,
} from "@openspace/shared";

/** Decay rate (per second) for the reconcile error vector. Half-life = ln2 / rate ≈ 87ms. */
const RECONCILE_ERROR_DECAY_RATE = 8;

/** Obstacle the predictor knows about (currently only asteroids). */
export interface PredictedObstacle {
  x: number;
  y: number;
  radius: number;
}

/** Pulled at predict-time so the obstacle set always matches what's on screen. */
export type ObstacleProvider = () => Iterable<PredictedObstacle>;

/**
 * Client-side prediction for the local player.
 *
 * Movement uses fixed-timestep simulation with render-state interpolation:
 *
 *   1. The simulation advances in discrete TICK_DT steps that match the
 *      server. Each step generates one input (seq + target), buffers it,
 *      and integrates the predicted position forward via the shared
 *      `stepPlayer` so prediction can never drift from authority.
 *   2. Between simulation steps, the displayed position is interpolated
 *      between the *previous* tick's predicted state and the *current*
 *      tick's predicted state, using `accumulator / TICK_DT` as alpha.
 *      That gives buttery motion at frame rate even though the underlying
 *      simulation only ticks at 30Hz, with no rate-lerp lag.
 *   3. When a server snapshot arrives, we replay still-unacknowledged
 *      inputs from the server's authoritative pos. Small drift just shifts
 *      the predicted target so the next interpolation absorbs it. Big
 *      drift snaps everything (display included) so the visible position
 *      doesn't visibly slide after a real desync.
 */
export class LocalPrediction {
  private nextSeq = 1;
  private accumulator = 0;
  private buffer: PlayerInput[] = [];

  private serverX: number;
  private serverY: number;
  // Predicted state at the start of the current tick.
  private prevX: number;
  private prevY: number;
  private prevRot = 0;
  // Predicted state at the end of the current tick.
  private curX: number;
  private curY: number;
  private curRot = 0;

  // Position/rotation we actually render — derived from prev/cur and the
  // accumulator each frame, then offset by the decaying error vector.
  private displayX: number;
  private displayY: number;
  private displayRot = 0;

  // Error-smoothing reconcile: when a server correction lands, the sim
  // (prev/cur) jumps to authority and the visible delta is absorbed into
  // this error vector, which decays toward zero each frame. Avoids the
  // "pop" that snap-reconcile produces under variable network jitter.
  // Half-life ~87ms (rate 8/sec) — fast enough to feel responsive,
  // slow enough to hide single-snapshot wobble.
  private errorX = 0;
  private errorY = 0;
  private errorRot = 0;

  private lastAckSeq = 0;
  private getObstacles: ObstacleProvider;

  constructor(initialX: number, initialY: number, getObstacles?: ObstacleProvider) {
    this.serverX = initialX;
    this.serverY = initialY;
    this.prevX = initialX;
    this.prevY = initialY;
    this.curX = initialX;
    this.curY = initialY;
    this.displayX = initialX;
    this.displayY = initialY;
    this.getObstacles = getObstacles ?? (() => []);
  }

  /**
   * Step time forward. Returns any new inputs that should be sent this frame
   * (zero or more, depending on accumulated time). `speedMultiplier` is the
   * current dash boost (1 normally, DASH_SPEED_MULTIPLIER while dashing) —
   * caller derives it from the player's `dashUntil` so prediction matches
   * the server's velocity scaling exactly.
   */
  step(
    dtSeconds: number,
    target: { x: number; y: number },
    speedMultiplier: number = 1,
  ): PlayerInput[] {
    this.accumulator += dtSeconds;
    const out: PlayerInput[] = [];

    // Bound the catch-up so a paused tab doesn't fire 1000 inputs on resume.
    if (this.accumulator > TICK_DT * 5) this.accumulator = TICK_DT * 5;

    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;

      this.prevX = this.curX;
      this.prevY = this.curY;
      this.prevRot = this.curRot;

      const input: PlayerInput = {
        seq: this.nextSeq++,
        targetX: target.x,
        targetY: target.y,
      };
      this.buffer.push(input);
      out.push(input);

      const next = stepPlayer(
        { x: this.curX, y: this.curY, rotation: this.curRot },
        input,
        TICK_DT,
        speedMultiplier,
      );
      const resolved = resolveObstacles(next.x, next.y, this.getObstacles());
      this.curX = resolved.x;
      this.curY = resolved.y;
      this.curRot = next.rotation;
    }

    return out;
  }

  /**
   * Compute the rendered position from the simulation. Called every frame.
   * Display = sim(prev → cur) − decaying error.
   */
  advanceDisplay(dtSeconds: number = 0) {
    const alpha = clamp01(this.accumulator / TICK_DT);
    const simX = lerp(this.prevX, this.curX, alpha);
    const simY = lerp(this.prevY, this.curY, alpha);
    const simRot = lerpAngle(this.prevRot, this.curRot, alpha);

    // Frame-rate-independent decay: error *= exp(-rate * dt).
    if (dtSeconds > 0) {
      const decay = Math.exp(-RECONCILE_ERROR_DECAY_RATE * dtSeconds);
      this.errorX *= decay;
      this.errorY *= decay;
      this.errorRot *= decay;
      // Snap the error to zero once it's imperceptible — avoids a long
      // exponential tail and lets the display equal the sim exactly.
      if (Math.abs(this.errorX) < 0.01) this.errorX = 0;
      if (Math.abs(this.errorY) < 0.01) this.errorY = 0;
      if (Math.abs(this.errorRot) < 0.001) this.errorRot = 0;
    }

    this.displayX = simX - this.errorX;
    this.displayY = simY - this.errorY;
    this.displayRot = simRot - this.errorRot;
  }

  /**
   * The server snapshot says: as of input seq=lastProcessedInputSeq, the
   * player was at (x, y, rotation). Reconcile our local prediction with that.
   */
  onServerUpdate(x: number, y: number, rotation: number, lastProcessedInputSeq: number) {
    this.serverX = x;
    this.serverY = y;
    this.lastAckSeq = lastProcessedInputSeq;

    // Drop inputs the server has already accounted for.
    this.buffer = this.buffer.filter((i) => i.seq > lastProcessedInputSeq);

    // Replay still-pending inputs from the server's authoritative pos.
    // Each replay step gets the same obstacle resolution as live prediction
    // so we end up at the same place the live tick would have produced.
    let state = { x, y, rotation };
    const obstacles = this.getObstacles();
    for (const input of this.buffer) {
      const next = stepPlayer(state, input);
      const resolved = resolveObstacles(next.x, next.y, obstacles);
      state = { x: resolved.x, y: resolved.y, rotation: next.rotation };
    }

    const drift = Math.hypot(state.x - this.curX, state.y - this.curY);

    if (drift > RECONCILE_SNAP_THRESHOLD) {
      // Large desync (respawn, teleport, big collision) — snap visibly and
      // zero the error so we don't leave a trail.
      this.errorX = 0;
      this.errorY = 0;
      this.errorRot = 0;
      this.prevX = state.x;
      this.prevY = state.y;
      this.prevRot = state.rotation;
      this.displayX = state.x;
      this.displayY = state.y;
      this.displayRot = state.rotation;
    } else {
      // Small drift — adjust cur to authority, leave prev alone. The in-
      // progress prev→cur lerp segment continues to advance smoothly toward
      // the corrected end, so motion never freezes between snapshot and the
      // next tick (which it would if we collapsed prev=cur=state). Error
      // absorbs the visual delta caused by cur changing under a fixed prev.
      // When prediction matches authority exactly (state == cur), error
      // stays at zero — the formula is self-cancelling for the no-drift
      // case, so steady motion has no visible reconcile artifacts.
      const alpha = clamp01(this.accumulator / TICK_DT);
      const liveSimX = lerp(this.prevX, this.curX, alpha);
      const liveSimY = lerp(this.prevY, this.curY, alpha);
      const liveSimRot = lerpAngle(this.prevRot, this.curRot, alpha);
      const liveDisplayX = liveSimX - this.errorX;
      const liveDisplayY = liveSimY - this.errorY;
      const liveDisplayRot = liveSimRot - this.errorRot;
      this.curX = state.x;
      this.curY = state.y;
      this.curRot = state.rotation;
      const newSimX = lerp(this.prevX, this.curX, alpha);
      const newSimY = lerp(this.prevY, this.curY, alpha);
      const newSimRot = lerpAngle(this.prevRot, this.curRot, alpha);
      this.errorX = newSimX - liveDisplayX;
      this.errorY = newSimY - liveDisplayY;
      this.errorRot = shortestAngleDelta(liveDisplayRot, newSimRot);
      return;
    }
    this.curX = state.x;
    this.curY = state.y;
    this.curRot = state.rotation;
  }

  get position() {
    return { x: this.displayX, y: this.displayY };
  }
  get rotation() {
    return this.displayRot;
  }
  get serverPosition() {
    return { x: this.serverX, y: this.serverY };
  }
  get acknowledgedSeq() {
    return this.lastAckSeq;
  }
  get pendingInputCount() {
    return this.buffer.length;
  }
}

/**
 * Push (x, y) out of any overlapping obstacle along the contact normal so
 * the player's circular hitbox sits flush against the surface rather than
 * inside it. Single-pass — resolves each obstacle once. The server's Rapier
 * solver behaves close enough that residual drift after this stays inside
 * the small-drift smoothing branch in onServerUpdate.
 *
 * Note: rest of the codebase expects this to be approximate, not perfect.
 * If two asteroids overlap a single resolution might wedge the player; in
 * practice spawn placement keeps them well apart so it's not a concern.
 */
/** Shortest signed angular delta from `from` → `to`, in (-π, π]. */
function shortestAngleDelta(from: number, to: number): number {
  const TAU = Math.PI * 2;
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

function resolveObstacles(
  x: number,
  y: number,
  obstacles: Iterable<PredictedObstacle>,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  for (const o of obstacles) {
    const dx = nx - o.x;
    const dy = ny - o.y;
    const minDist = PLAYER_CONTACT_RADIUS + o.radius;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) continue;
    const dist = Math.sqrt(distSq);
    if (dist < 1e-4) {
      // Degenerate: player center exactly at obstacle center. Pick an
      // arbitrary axis to push out along.
      nx = o.x + minDist;
      ny = o.y;
      continue;
    }
    nx = o.x + (dx / dist) * minDist;
    ny = o.y + (dy / dist) * minDist;
  }
  return { x: nx, y: ny };
}

