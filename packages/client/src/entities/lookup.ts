import type { LocalPlayer, RemotePlayer } from "./players.js";
import type { Structure } from "./structures.js";
import type { Unit } from "./units.js";

/**
 * Resolve an entity id to its currently-rendered world position. Searches
 * (in order) the local player, remote players, AI units, and structures.
 * Used by anything that needs to anchor a visual to "wherever entity X is
 * on screen right now" — beam endpoints, heal tethers, debug overlay
 * target lines.
 *
 * Takes Map references (not iterators) for two reasons: O(1) `.get(id)`
 * lookups beat O(N) scans, and avoids a single-pass-iterator footgun where
 * a caller iterating a Map's values and ALSO passing the iterator here
 * would silently get a partially-consumed iterator.
 *
 * Returns null if the id matches nothing currently on screen (e.g. the entity
 * just died but the caller hasn't dropped its reference yet).
 */
export function resolveRenderedPosition(
  id: string,
  local: LocalPlayer | null,
  localSessionId: string,
  remotes: Map<string, RemotePlayer>,
  units: Map<string, Unit>,
  structures: Map<string, Structure>,
): { x: number; y: number } | null {
  if (local && id === localSessionId) {
    return { x: local.prediction.position.x, y: local.prediction.position.y };
  }
  const r = remotes.get(id);
  if (r) return { x: r.renderedX, y: r.renderedY };
  const u = units.get(id);
  if (u) return { x: u.view.container.x, y: u.view.container.y };
  const s = structures.get(id);
  if (s) return { x: s.view.container.x, y: s.view.container.y };
  return null;
}
