import { INTERPOLATION_DELAY_MS, lerp, lerpAngle } from "@openspace/shared";

/**
 * Snapshot interpolation for remote players.
 *
 * Server snapshots are authoritative but only arrive ~20Hz, so naively
 * teleporting a remote ship to its latest reported position looks choppy.
 * Instead we keep a short history of received snapshots and render each
 * remote player at (now - INTERPOLATION_DELAY_MS), interpolating between
 * the two snapshots that bracket that timestamp.
 *
 * The render delay (default 100ms) gives us a buffer: as long as a fresh
 * snapshot arrives within that window, we have a "future" sample to
 * interpolate toward and the motion stays smooth. If snapshots dry up we
 * extrapolate gently from the most recent one.
 */
export interface RemoteSnapshot {
  t: number; // Local clock time (performance.now()) when received.
  x: number;
  y: number;
  rotation: number;
}

const MAX_HISTORY = 20;

/** When renderTime overruns the newest snapshot, extrapolate from the last
 *  two for up to this many ms. Beyond this we freeze at the newest sample
 *  rather than drift further from authority. ~100ms is the Source-engine
 *  default and Fiedler's recommended cap. */
const MAX_EXTRAPOLATION_MS = 100;

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
    // Keep history sorted by time. New snapshots usually append, but tolerate
    // out-of-order arrivals just in case.
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

  /**
   * Sample the interpolated position at the current display time.
   * `now` is performance.now() in the same clock as snapshot.t.
   */
  sample(now: number): { x: number; y: number; rotation: number } | null {
    if (this.history.length === 0) return null;
    const renderTime = now - INTERPOLATION_DELAY_MS;

    // Render time is older than every sample we have — snap to the oldest.
    if (renderTime <= this.history[0]!.t) {
      const s = this.history[0]!;
      return { x: s.x, y: s.y, rotation: s.rotation };
    }

    // Find the pair of snapshots that bracket renderTime.
    for (let i = 0; i < this.history.length - 1; i++) {
      const a = this.history[i]!;
      const b = this.history[i + 1]!;
      if (renderTime >= a.t && renderTime <= b.t) {
        const span = b.t - a.t;
        const tt = span > 0 ? (renderTime - a.t) / span : 0;
        return {
          x: lerp(a.x, b.x, tt),
          y: lerp(a.y, b.y, tt),
          rotation: lerpAngle(a.rotation, b.rotation, tt),
        };
      }
    }

    // We're past the newest snapshot — extrapolate from the last two
    // samples' velocity, capped so we don't fly far from authority. Beyond
    // the cap we freeze at the newest sample. Rotation is *not* extrapolated
    // (angular extrapolation looks broken on hard turns; freezing reads
    // better and corrects within 100ms when the next snapshot lands).
    const newest = this.history[this.history.length - 1]!;
    const ahead = renderTime - newest.t;
    if (this.history.length < 2 || ahead > MAX_EXTRAPOLATION_MS) {
      return { x: newest.x, y: newest.y, rotation: newest.rotation };
    }
    const prev = this.history[this.history.length - 2]!;
    const span = newest.t - prev.t;
    if (span <= 0) return { x: newest.x, y: newest.y, rotation: newest.rotation };
    const vx = (newest.x - prev.x) / span;
    const vy = (newest.y - prev.y) / span;
    return {
      x: newest.x + vx * ahead,
      y: newest.y + vy * ahead,
      rotation: newest.rotation,
    };
  }
}

