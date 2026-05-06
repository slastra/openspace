import type { BuildInfo } from "@openspace/shared";

const DEFAULT_INTERVAL_MS = 1500;
const SLOW_POLL_AFTER_MS = 30_000;
const SLOW_INTERVAL_MS = 4000;

/**
 * Repeatedly fetch `/build-info` until the server responds, then call
 * `onResult` once with the parsed payload. The 1.5s → 4s backoff after
 * 30s of failure keeps the server log readable when many stuck-open
 * tabs poll across a slow Coolify deploy.
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
