import { TICK_MS, clamp, lerpAngle } from "@openspace/shared";

/**
 * Snapshot interpolation for remote entities (players, units).
 *
 * Server snapshots arrive ~20Hz; rendering them as-is looks choppy. We keep
 * a short history and render at (now - delay), interpolating between the
 * snapshots that bracket that time. The delay is adaptive (see
 * `InterpolationDelay`).
 *
 * Position uses **cubic Hermite** between sample pairs, taking each sample's
 * server-reported velocity (vx, vy) as the tangent. Tangents are clamped via
 * Fritsch-Carlson (monotone Hermite) so server velocity disagreeing with the
 * sample-to-sample secant — collision impulses, sudden stops — doesn't make
 * the curve overshoot. Linear interpolation of accelerating bodies produces
 * a visible kink at every snapshot boundary; Hermite removes it.
 *
 * Rotation stays on `lerpAngle` (shortest-arc slerp). Angular extrapolation
 * looks worse than just freezing the angle on hard turns.
 *
 * On buffer underflow (renderTime past newest sample), extrapolate linearly
 * from the newest sample's velocity for up to ~100ms, then freeze.
 */
export interface RemoteSnapshot {
  t: number; // serverTime in the snapshot, in same clock as render time.
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
}

const MAX_HISTORY = 20;

/** When renderTime overruns the newest snapshot, extrapolate linearly from
 *  its velocity for up to this many ms. Beyond, freeze at the newest sample.
 *  Source-engine default; Fiedler's recommended cap. */
const MAX_EXTRAPOLATION_MS = 100;

/** Fritsch-Carlson tangent magnitude cap (relative to the sample-to-sample
 *  secant). Standard monotone-Hermite knee that prevents overshoot when the
 *  reported velocity disagrees with the actual trajectory. */
const TANGENT_CLAMP_FACTOR = 3;

export class RemoteInterpolator {
  private history: RemoteSnapshot[] = [];
  private color = "#ffffff";

  setColor(color: string) {
    this.color = color;
  }
  getColor() {
    return this.color;
  }

  push(snap: RemoteSnapshot) {
    if (this.history.length === 0 || snap.t >= this.history[this.history.length - 1]!.t) {
      this.history.push(snap);
    } else {
      const idx = this.history.findIndex((s) => s.t > snap.t);
      this.history.splice(idx, 0, snap);
    }
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }

  /** Pose at `renderTime` (server clock), i.e. server now minus the delay. */
  sample(renderTime: number): { x: number; y: number; rotation: number } | null {
    if (this.history.length === 0) return null;

    if (renderTime <= this.history[0]!.t) {
      const s = this.history[0]!;
      return { x: s.x, y: s.y, rotation: s.rotation };
    }

    for (let i = 0; i < this.history.length - 1; i++) {
      const a = this.history[i]!;
      const b = this.history[i + 1]!;
      if (renderTime >= a.t && renderTime <= b.t) {
        const span = b.t - a.t;
        if (span <= 0) return { x: a.x, y: a.y, rotation: a.rotation };
        const s = (renderTime - a.t) / span;
        // span is in ms; v is u/sec. Hermite tangent term is `dt * v`, where
        // dt here is the segment span in seconds.
        const dtSec = span / 1000;
        return {
          x: hermite(a.x, a.vx, b.x, b.vx, dtSec, s),
          y: hermite(a.y, a.vy, b.y, b.vy, dtSec, s),
          rotation: lerpAngle(a.rotation, b.rotation, s),
        };
      }
    }

    // Past the newest snapshot — extrapolate linearly from its velocity.
    const newest = this.history[this.history.length - 1]!;
    const aheadMs = renderTime - newest.t;
    if (aheadMs > MAX_EXTRAPOLATION_MS) {
      return { x: newest.x, y: newest.y, rotation: newest.rotation };
    }
    const aheadSec = aheadMs / 1000;
    return {
      x: newest.x + newest.vx * aheadSec,
      y: newest.y + newest.vy * aheadSec,
      rotation: newest.rotation,
    };
  }
}

/** Cubic Hermite with Fritsch-Carlson tangent clamp on a single axis.
 *  `dtSec` is the segment span in seconds (the `dt` weighting on tangents).
 *  `s` ∈ [0, 1] is the normalized position within the segment. */
function hermite(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  dtSec: number,
  s: number,
): number {
  // Fritsch-Carlson clamp: zero a tangent if it disagrees with the secant
  // direction; clip magnitude to TANGENT_CLAMP_FACTOR × |secant|. Eliminates
  // overshoot when the reported velocity doesn't match Δposition/Δt (e.g.
  // a collision changed velocity mid-segment).
  const secant = (p1 - p0) / dtSec;
  let t0 = v0;
  let t1 = v1;
  if (t0 * secant < 0) t0 = 0;
  if (t1 * secant < 0) t1 = 0;
  const maxMag = TANGENT_CLAMP_FACTOR * Math.abs(secant);
  if (Math.abs(t0) > maxMag) t0 = Math.sign(t0) * maxMag;
  if (Math.abs(t1) > maxMag) t1 = Math.sign(t1) * maxMag;

  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * dtSec * t0 + h01 * p1 + h11 * dtSec * t1;
}

/** Delay floor: two snapshot intervals, so there's always a pair to blend. */
const MIN_DELAY_MS = 2 * TICK_MS;
/** Ceiling, so a jitter storm costs smoothness rather than unbounded lag. */
const MAX_DELAY_MS = 250;
/** Starting delay, before any jitter has been measured. */
const INITIAL_DELAY_MS = 150;
/** Per-snapshot decay of the lateness peak (half-life about 4.6 s at 30 Hz). */
const LATENESS_DECAY = 0.995;
/** Headroom on top of the measured lateness peak. */
const LATENESS_MARGIN = 1.25;
/** Max slew of the delay in ms per second (render clock runs at most 3%
 *  slow while the delay grows and 1% fast while it shrinks). */
const DELAY_RISE_PER_SEC = 30;
const DELAY_FALL_PER_SEC = 10;

/**
 * Adaptive interpolation delay. A snapshot stamped T arrives `lateness`
 * after the client's filtered clock expected it; it is still on time for
 * rendering while `delay >= TICK_MS + lateness`. So the target is one
 * tick plus a slowly decaying peak of observed lateness, plus headroom.
 * The delay slews toward the target gradually so render time never jumps.
 * On a steady connection it settles near two ticks (~67 ms) instead of a
 * fixed 150 ms, which shortens how far remote entities and your own
 * formation trail behind your predicted ship.
 */
export class InterpolationDelay {
  private latenessPeakMs = 0;
  /** Current delay (ms) to subtract from server time when sampling. */
  delayMs = INITIAL_DELAY_MS;

  /** Feed one snapshot's lateness: its arrival offset minus the filtered offset. */
  observe(latenessMs: number) {
    this.latenessPeakMs = Math.max(Math.max(0, latenessMs), this.latenessPeakMs * LATENESS_DECAY);
  }

  get targetMs(): number {
    return clamp(TICK_MS + this.latenessPeakMs * LATENESS_MARGIN, MIN_DELAY_MS, MAX_DELAY_MS);
  }

  /** Slew toward the target; call once per frame. */
  advance(dtSeconds: number) {
    const d = this.targetMs - this.delayMs;
    this.delayMs += clamp(d, -DELAY_FALL_PER_SEC * dtSeconds, DELAY_RISE_PER_SEC * dtSeconds);
  }
}
