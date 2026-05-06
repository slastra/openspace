import type { BuildInfo, StructureKindName } from "@openspace/shared";

/**
 * One row in the leaderboard panel. Pushed each frame from the game loop.
 */
export interface LeaderboardEntry {
  id: string;
  name: string;
  color: string;
  rank: number;
  isLocal: boolean;
  isDead: boolean;
}

/**
 * Reactive HUD state — the game loop pushes into this each frame, Svelte
 * components subscribe to whatever they need. Replaces the per-panel typed
 * setter interfaces (`StatsPanel`, `UnitHud`, etc.) — single source of truth
 * with built-in equality so unchanged values don't trigger downstream effects.
 *
 * Build icons (Pixi-snapshotted canvases) are non-reactive; they're set once
 * at startup and accessed directly.
 */
class HudState {
  rank = $state(0);
  minerals = $state(0);
  hp = $state(0);
  maxHp = $state(0);
  supplyUsed = $state(0);
  supplyCap = $state(0);
  isDead = $state(false);

  /** Disconnect / error notice text. Empty by default. */
  status = $state("");
  /** Transient-mode hint (e.g. "RECYCLE — click an owned structure"). */
  modeHint = $state("");

  /** Sorted leaderboard rows, replaced wholesale each frame. */
  players = $state<LeaderboardEntry[]>([]);

  /** Per-kind owned counts. Indexed by kind name (rammer/miner/...). */
  unitCounts = $state<Record<string, number>>({});

  /** Per-kind affordability — true when player has enough credits + supply. */
  affordable = $state<Record<string, boolean>>({});

  /** Active build mode: structure kind being placed, or null. */
  placing = $state<StructureKindName | null>(null);

  /** Build-card art keyed by kind. Set once at startup from the Pixi extracts. */
  buildIcons: Map<string, HTMLCanvasElement> = new Map();

  /** Mineral counter pulse — bumped on increase to drive a CSS animation. */
  mineralBumpToken = $state(0);
  private lastMinerals = 0;

  setMinerals(value: number) {
    if (value > this.lastMinerals) this.mineralBumpToken++;
    this.lastMinerals = value;
    this.minerals = value;
  }

  /** Debug metrics — null when F1 overlay is off. Pushed each frame from
   *  the game loop when the overlay is enabled. */
  debug = $state<DebugMetrics | null>(null);

  /** Top-center event feed entries (kills, emotes, base alerts). Each
   *  entry has a `pushedAt` so the Svelte feed can fade out on TTL.
   *  Bounded — pushEvent drops the oldest when over MAX_FEED_ENTRIES. */
  events = $state<FeedEntry[]>([]);

  /** Radial-menu open state. Non-null while right-click is held —
   *  RadialEmoteMenu component renders + tracks pointer to pick wedge,
   *  fires onEmote on release if past dead zone. Cleared by the
   *  component itself on pointerup. */
  emoteMenu = $state<{ x: number; y: number } | null>(null);

  /** Connection lifecycle, drives ReconnectOverlay:
   *  - "connected": normal play, overlay hidden
   *  - "reconnecting": ws closed, polling /build-info to detect server return
   *  - "update-available": server is back with a different SHA — show
   *    update modal with notes + countdown to refresh */
  connectionState = $state<"connected" | "reconnecting" | "update-available">("connected");
  /** The server's BuildInfo at the moment we detected a redeploy.
   *  Populated only when `connectionState === "update-available"`. */
  serverBuildInfo = $state<BuildInfo | null>(null);

  pushFeedEntry(entry: FeedEntryInput) {
    // Cast keeps the discriminated union intact — Omit on the union
    // distributes oddly and TypeScript loses the kind narrowing.
    const next = { ...entry, pushedAt: performance.now() } as FeedEntry;
    // Reassign (not mutate) so $state diffs properly.
    const arr = [next, ...this.events];
    if (arr.length > MAX_FEED_ENTRIES) arr.length = MAX_FEED_ENTRIES;
    this.events = arr;
  }

  /** Drop expired entries. Called from the game ticker each frame. */
  pruneFeed(now: number) {
    if (this.events.length === 0) return;
    const cutoff = now - FEED_TTL_MS;
    let firstExpired = -1;
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i]!.pushedAt < cutoff) {
        firstExpired = i;
        break;
      }
    }
    if (firstExpired >= 0) {
      this.events = this.events.slice(0, firstExpired);
    }
  }
}

/** How long a toast stays in the feed (ms). 5s is the standard MOBA
 *  kill-feed lifetime — enough to read at a glance, short enough that
 *  a busy fight doesn't block the screen. */
export const FEED_TTL_MS = 5000;
/** Max simultaneous toasts before oldest gets pushed off. */
export const MAX_FEED_ENTRIES = 6;

export type FeedEntry =
  | KillFeedEntry
  | EmoteFeedEntry
  | BaseAttackFeedEntry;

/** Input shape for `pushFeedEntry` — same union but without the
 *  `pushedAt` timestamp (the method stamps it). */
export type FeedEntryInput =
  | Omit<KillFeedEntry, "pushedAt">
  | Omit<EmoteFeedEntry, "pushedAt">
  | Omit<BaseAttackFeedEntry, "pushedAt">;

export interface KillFeedEntry {
  kind: "kill";
  /** Empty when the death was environmental — feed renders dimmed. */
  killerName: string;
  killerColor: string;
  victimName: string;
  victimColor: string;
  /** True when YOU were the killer or the victim — feed highlights. */
  involvesLocal: boolean;
  pushedAt: number;
}

export interface EmoteFeedEntry {
  kind: "emote";
  senderName: string;
  senderColor: string;
  emote: string;
  pushedAt: number;
}

export interface BaseAttackFeedEntry {
  kind: "base-attack";
  pushedAt: number;
}

/** F1 debug panel data. All non-counter fields are smoothed over a rolling
 *  window so single-frame outliers don't make the readouts unreadable. */
export interface DebugMetrics {
  fps: number;
  frameDtMeanMs: number;
  frameDtP99Ms: number;
  snapshotIntervalMeanMs: number;
  snapshotIntervalP99Ms: number;
  snapshotsPerSec: number;
  serverOffsetMs: number;
  rttSpreadMs: number;
  reconcileDriftU: number;
  predictionErrorU: number;
  pendingInputs: number;
  units: number;
  asteroids: number;
  projectiles: number;
  players: number;
}

export const hud = new HudState();
