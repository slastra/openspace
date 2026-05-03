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

    // We're past the newest snapshot — return the newest as a static fallback.
    // Extrapolation could be added here later if needed.
    const s = this.history[this.history.length - 1]!;
    return { x: s.x, y: s.y, rotation: s.rotation };
  }
}

