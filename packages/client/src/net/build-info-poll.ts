import type { BuildInfo } from "@openspace/shared";

const DEFAULT_INTERVAL_MS = 1500;
/** Server is allowed to take this long to come back before we slow the
 *  poll cadence — Coolify deploys typically resolve well under this. */
const SLOW_POLL_AFTER_MS = 30_000;
const SLOW_INTERVAL_MS = 4000;

/**
 * Repeatedly fetch `/build-info` until the server responds. Calls
 * `onResult` with the parsed BuildInfo on the first successful fetch
 * and then stops. Aborts immediately if the returned `stop` function
 * is invoked.
 *
 * Polling is gentle on purpose: a 1.5s interval (slowing to 4s after
 * the first 30 seconds of failure) keeps the server log readable
 * across a fleet of stuck-open browser tabs while still feeling
 * responsive to a normal redeploy.
 */
export function pollBuildInfo(onResult: (info: BuildInfo) => void): () => void {
  const startedAt = performance.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (cancelled) return;
    try {
      const res = await fetch("/build-info", { cache: "no-store" });
      if (res.ok) {
        const info = (await res.json()) as BuildInfo;
        if (cancelled) return;
        onResult(info);
        return;
      }
    } catch {
      // network/CORS/aborted — fall through and retry
    }
    if (cancelled) return;
    const interval =
      performance.now() - startedAt > SLOW_POLL_AFTER_MS
        ? SLOW_INTERVAL_MS
        : DEFAULT_INTERVAL_MS;
    timer = setTimeout(tick, interval);
  };

  // First attempt fires immediately so a brief blip resolves with no
  // visible delay. Subsequent attempts use the interval.
  tick();

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
  };
}
