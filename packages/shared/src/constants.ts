export const WORLD_WIDTH = 12000;
export const WORLD_HEIGHT = 12000;

export const TICK_RATE_HZ = 30;
export const SNAPSHOT_RATE_HZ = 20;
export const TICK_DT = 1 / TICK_RATE_HZ;

export const PLAYER_SPEED = 300;
export const PLAYER_SIZE = 24;
export const PLAYER_MAX_HP = 100;
/** Effective collision radius for the player ship (roughly half of PLAYER_SIZE). */
export const PLAYER_CONTACT_RADIUS = 12;
/** Cursor must be at least this far from the ship for any movement (deadzone). */
export const PLAYER_INPUT_DEADZONE = 35;
/** Cursor at this distance produces full PLAYER_SPEED; in between, speed scales linearly. */
export const PLAYER_FULL_SPEED_DIST = 180;

/** Default visual size for AI units. Per-kind sizing can override at render time. */
export const UNIT_SIZE = 18;
/** Smallest interval (ms) between unit-spawn requests honored per player. */
export const UNIT_SPAWN_COOLDOWN_MS = 250;
/** Credits a fresh player joins with — seeds the economy so spawning isn't gated on first kill. */
export const STARTING_CREDITS = 10;
/** Supply cap a player joins with — enough for a starter swarm before any structures. */
export const STARTING_SUPPLY_CAP = 4;
/** All structures snap to this world-grid spacing on placement. Reuses the visual GRID_SPACING. */
export const STRUCTURE_GRID_SNAP = 100;
/** Sight range (world units) of a friendly entity for revealing enemy structures on the minimap. */
export const VISION_RADIUS = 450;

/** Speed multiplier applied to the player ship while sustained dash is held. */
export const DASH_SPEED_MULTIPLIER = 2.0;
/** HP per second drained from EVERY owned unit while the player is dashing.
 *  Engine wash — gives the ship raw speed at the cost of cooking the fleet
 *  trailing behind. At ~12/sec, a 30 HP rammer pops in ~2.5s of held thrust. */
export const DASH_FLEET_BURN_DPS = 12;

/** Smallest wreckage square (player died with no credits) — still claimable. */
export const WRECKAGE_HALF_SIZE_MIN = 12;
/** Largest wreckage square (capped so a hoarder's death isn't an entire screen). */
export const WRECKAGE_HALF_SIZE_MAX = 40;
/** How long a wreckage lingers before its credits + orphan units vanish. */
export const WRECKAGE_LIFETIME_MS = 30000;

/**
 * Visual + hitbox size of a wreckage scaled to its credit pile. Sqrt-ish so
 * the area grows roughly linearly with credits — small piles read as small,
 * big piles read as a juicy target without visually overwhelming the field.
 */
export function wreckageHalfSize(credits: number): number {
  const raw = WRECKAGE_HALF_SIZE_MIN + Math.sqrt(Math.max(0, credits)) * 2.5;
  return Math.min(WRECKAGE_HALF_SIZE_MAX, raw);
}

/** HP per unit of relative impact speed. Damage = clamp(relSpeed * this, MIN, MAX). */
export const COLLISION_DAMAGE_PER_SPEED = 0.02;
/** Floor — even a brush at near-zero relative speed costs 1 HP, so contact always stings. */
export const COLLISION_DAMAGE_MIN = 1;
/** Cap — prevents pathological burst damage from any solver-induced velocity spike. */
export const COLLISION_DAMAGE_MAX = 20;
/** Damping coefficient applied to dynamic body linear velocity (Rapier units). */
export const LINEAR_DAMPING = 2.0;

export const ROOM_NAME = "arena";
export const SERVER_PORT = 2567;

export const PLAYER_COLORS = [
  "#4ade80",
  "#60a5fa",
  "#f472b6",
  "#fb923c",
  "#a78bfa",
  "#facc15",
  "#f87171",
  "#2dd4bf",
] as const;

export const BACKGROUND_COLOR = 0x0a0e1a;
export const GRID_COLOR = 0x103040;
export const GRID_SPACING = 100;

export const INTERPOLATION_DELAY_MS = 150;
/** Drift between local prediction and server authority above which we snap
 *  the visible position rather than smooth-correct via the error vector.
 *  Tuned for VPS RTT: at PLAYER_SPEED 300 u/s with ~30ms one-way latency,
 *  steady-state drift while moving is ~9u just from network lag — that's
 *  not a desync, it's the fundamental client-server gap. The snap branch
 *  is reserved for *real* desyncs (respawn teleport, hard collisions). */
export const RECONCILE_SNAP_THRESHOLD = 60;

/** Number of asteroids the room maintains in the field. */
export const ASTEROID_COUNT = 108;
/** HP of a fresh asteroid; mining damage chips this down. */
export const ASTEROID_HP = 60;
/** Collision radius (also visual radius) of an asteroid. */
export const ASTEROID_RADIUS = 28;
/** Credits awarded to the owning player on asteroid destruction. */
export const ASTEROID_REWARD = 5;
/** Delay (ms) between an asteroid being mined out and a fresh one spawning. */
export const ASTEROID_RESPAWN_DELAY_MS = 4000;
/** Inset from the arena edges where new asteroids may spawn. */
export const ASTEROID_SPAWN_MARGIN = 200;
/** Minimum distance between a new asteroid and any existing entity (asteroid or player). */
export const ASTEROID_MIN_SPACING = 120;
/** Credits awarded per point of asteroid HP mined. Total per rock = HP * this. */
export const CREDITS_PER_ASTEROID_HP = ASTEROID_REWARD / ASTEROID_HP;

/**
 * Spawnable asteroid tier. ArenaRoom picks one weighted-randomly each spawn
 * — `weight` is unitless, summed across tiers for the roll. HP scales linearly
 * with reward via `CREDITS_PER_ASTEROID_HP` (so big rocks pay more total but
 * the per-second-per-miner rate stays consistent).
 */
export interface AsteroidTier {
  radius: number;
  hp: number;
  weight: number;
}

export const ASTEROID_TIERS: AsteroidTier[] = [
  { radius: 14, hp: 18, weight: 25 }, // tiny — pop in seconds
  { radius: 22, hp: 40, weight: 30 }, // small
  { radius: 32, hp: 75, weight: 25 }, // medium
  { radius: 50, hp: 160, weight: 15 }, // large
  { radius: 252, hp: 2400, weight: 5 }, // giant — rare, very juicy
];
/** Mining DPS the player ship itself contributes when parked on an asteroid.
 *  Intentionally far below MINER.miningDps so dedicated miners stay worth buying. */
export const PLAYER_MINING_DPS = 5;
/** Extra slack beyond ship+asteroid radii at which the ship still mines. */
export const PLAYER_MINING_REACH = 4;

/** Visual + collision radius of a fired projectile. */
export const PROJECTILE_RADIUS = 2.5;
/** Extra ms tacked onto computed projectile lifetime so it doesn't pop just before reaching max range. */
export const PROJECTILE_LIFETIME_GRACE_MS = 100;
