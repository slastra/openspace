export interface PlayerInput {
  seq: number;
  targetX: number;
  targetY: number;
}

export interface SpawnUnitMessage {
  kind: string;
}

export interface BuildStructureMessage {
  kind: string;
  /** World-space target. Server snaps to STRUCTURE_GRID_SNAP. */
  x: number;
  y: number;
}

export interface RecycleStructureMessage {
  /** Schema id of the structure being recycled. Server validates ownership. */
  id: string;
}

/**
 * Event broadcast from server to clients via Colyseus message channel
 * (NOT schema state — these are one-shot, transient, no persistence).
 * Drives the top-center toast feed and (for emotes) the world-space
 * bubble above the sender's ship.
 *
 * Discriminated union on `kind`. Add new event kinds here as features
 * land (base destroyed, killstreak, etc.).
 */
export type GameEvent = KillEvent | EmoteEvent | BaseAttackEvent;

export interface KillEvent {
  kind: "kill";
  /** Killer sessionId. Empty string when the kill is environmental
   *  (perimeter wall, asteroid impact, dash burn) — client renders
   *  these as a dim "☠ {victim}" toast with no killer attribution. */
  killerId: string;
  killerName: string;
  killerColor: string;
  victimId: string;
  victimName: string;
  victimColor: string;
}

export interface EmoteEvent {
  kind: "emote";
  senderId: string;
  senderName: string;
  senderColor: string;
  emote: EmoteKind;
}

/** Routed PRIVATELY to the base owner only — see ArenaRoom.send vs
 *  broadcast. No payload needed; the recipient is implicit (you only
 *  receive this if it's about your base) and the toast styling is
 *  hardcoded to "your base under attack." */
export interface BaseAttackEvent {
  kind: "base-attack";
}

/** Outbound emote message from client to server. Server validates the
 *  enum, rate-limits to 1/sec/player, and broadcasts an EmoteEvent. */
export interface EmoteMessage {
  emote: EmoteKind;
}

/** Emote enum — the radial-menu choices. Keep this small + game-relevant
 *  so the UI fits 6 wedges and policing isn't needed. */
export type EmoteKind =
  | "greet"
  | "help"
  | "attack"
  | "truce"
  | "thanks"
  | "rip";

export const EMOTE_KINDS: readonly EmoteKind[] = [
  "greet",
  "help",
  "attack",
  "truce",
  "thanks",
  "rip",
] as const;

export function isKnownEmote(kind: string): kind is EmoteKind {
  return (EMOTE_KINDS as readonly string[]).includes(kind);
}

/** Minimum interval (ms) between emote sends per player. Server-enforced. */
export const EMOTE_COOLDOWN_MS = 1000;

/** Per-base cooldown (ms) on the "base under attack" alert toast. Once
 *  fired for a base, suppresses further alerts for the same base for
 *  this duration even if damage continues — sustained attack only needs
 *  ONE alert. */
export const BASE_ATTACK_COOLDOWN_MS = 30000;
