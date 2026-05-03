import type { StructureKindName } from "@openspace/shared";

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
}

export const hud = new HudState();
