export const WORLD_WIDTH = 12000;
export const WORLD_HEIGHT = 12000;

export const TICK_RATE_HZ = 30;
/** Snapshots/sec from server to clients. Must be an integer divisor of
 *  TICK_RATE_HZ (or equal to it) so consecutive snapshot serverTimes have
 *  consistent spacing. Mismatched rates produce alternating short/long
 *  intervals that snapshot interp renders as visible motion stutter. */
export const SNAPSHOT_RATE_HZ = 30;
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
/** Credits a fresh player joins with. The base structure that gates all
 *  unit production is free, so this seeds the very first miner / wall
 *  buy without forcing the player to mine with the ship before they can
 *  do anything. */
export const STARTING_CREDITS = 20;
/** Supply cap a player joins with — enough for a starter swarm before any structures. */
export const STARTING_SUPPLY_CAP = 4;
/** All structures snap to this world-grid spacing on placement. Reuses the visual GRID_SPACING. */
export const STRUCTURE_GRID_SNAP = 100;
/** Sight range (world units) of a friendly entity for revealing enemy structures on the minimap. */
export const VISION_RADIUS = 450;

/** Speed multiplier applied to the player ship while sustained dash is held. */
export const DASH_SPEED_MULTIPLIER = 2.0;
/** Speed factor floor when the player owns the maximum allowed live units
 *  (MAX_UNITS_PER_PLAYER). Linear ramp from 1.0 at zero owned units to this
 *  value at the cap, applied multiplicatively on top of any dash boost so
 *  dash remains the explicit "punch through your own swarm" escape valve.
 *  See `playerFleetDragFactor` in movement.ts. */
export const PLAYER_FLEET_DRAG_FLOOR = 0.25;
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

/** Per-player live unit cap. Worst-case room load is MAX_PLAYERS_PER_ROOM ×
 *  MAX_UNITS_PER_PLAYER + asteroids + projectiles + structures. The schema
 *  encodes Unit slot indexes in a uint8, which also caps this at 255. */
export const MAX_UNITS_PER_PLAYER = 255;
/** Hard cap on concurrent players per ArenaRoom. Wired into Room.maxClients
 *  so Colyseus matchmaker rejects extra joins. */
export const MAX_PLAYERS_PER_ROOM = 15;
/** Total live projectiles allowed per room. Prevents gunner-spam DoS where
 *  an alt swarm flooding the snapshot stream starves everyone else. */
export const MAX_PROJECTILES_PER_ROOM = 600;
/** Per-player structure cap. The supply economy already bounds this loosely;
 *  the explicit cap is a guardrail against placement-spam griefing. */
export const MAX_STRUCTURES_PER_PLAYER = 64;

/** Area-of-interest radius (world units) for per-client snapshot filtering.
 *  An entity within this distance of the player ship is included in that
 *  client's view. Roughly 1.5 viewports so units pop in well before they
 *  enter visible range. */
export const AOI_RADIUS_U = 1500;
/** Hysteresis band added to AOI_RADIUS_U on the way out — once visible,
 *  an entity stays visible until it passes RADIUS + this distance. Kills
 *  in/out flicker for entities skating along the boundary. */
export const AOI_HYSTERESIS_U = 300;

/** Radius (world units) of the territorial claim projected by an owned
 *  base. Enemy players cannot place ANY structure within this radius of
 *  your live base; you can build freely inside your own claim. Existing
 *  enemy structures already in the radius when a base is planted are
 *  unaffected — claim only blocks new placements. */
export const BASE_CLAIM_RADIUS_U = 600;

/** Radius (world units) of the no-build bubble around the world-center
 *  spawn point. Players initially spawn in this area (or respawn there
 *  if they have no base); the bubble keeps anyone from walling in the
 *  spawn zone or planting a base on top of it. The bubble is drawn on
 *  the world layer so players can see exactly where they need to fly
 *  out to before dropping their first base. */
export const SPAWN_BUBBLE_RADIUS_U = 800;

/** Duration (ms) the player ship is invulnerable to all damage after
 *  spawning or respawning. Lets a fresh / just-respawned player set up
 *  their first base + miners without being insta-killed at the spawn
 *  point. Indicated visually on the ship while active. */
export const SPAWN_INVULN_MS = 20000;

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
