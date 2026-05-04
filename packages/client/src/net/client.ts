import * as Colyseus from "colyseus.js";
import { getStateCallbacks } from "colyseus.js";
import {
  ArenaState,
  Asteroid,
  BuildStructureMessage,
  Player,
  PlayerInput,
  Projectile,
  ROOM_NAME,
  SERVER_PORT,
  SpawnUnitMessage,
  Structure,
  Unit,
  Wreckage,
} from "@openspace/shared";

/**
 * Plain snapshot of a player's state used by callbacks. Decouples game code
 * from the Colyseus Schema instance so we can swap transports later.
 */
export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  color: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  deathCount: number;
  lastProcessedInputSeq: number;
  credits: number;
  supplyCap: number;
  supplyUsed: number;
  dashing: boolean;
  /** Server's tick time when this state was sampled — use for jitter-free interpolation. */
  serverTime: number;
}

export interface WreckageSnapshot {
  id: string;
  x: number;
  y: number;
  color: string;
  ownerName: string;
  credits: number;
  halfSize: number;
  expiresAt: number;
}

export interface StructureSnapshot {
  id: string;
  ownerId: string;
  kind: string;
  color: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  rotation: number;
  cooldown: number;
  targetId: string;
}

export interface AsteroidSnapshot {
  id: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  resourceValue: number;
  lastHitBy: string;
  serverTime: number;
}

export interface ProjectileSnapshot {
  id: string;
  ownerId: string;
  team: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  expiresAt: number;
  serverTime: number;
}

export interface UnitSnapshot {
  id: string;
  ownerId: string;
  color: string;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  cooldown: number;
  targetId: string;
  deactivated: boolean;
  serverTime: number;
}

export interface NetClientHandlers {
  onLocalSpawn?: (snap: PlayerSnapshot) => void;
  onLocalUpdate?: (snap: PlayerSnapshot) => void;
  onRemoteAdd?: (snap: PlayerSnapshot) => void;
  onRemoteUpdate?: (snap: PlayerSnapshot) => void;
  onRemoteRemove?: (sessionId: string) => void;
  onUnitAdd?: (snap: UnitSnapshot) => void;
  onUnitUpdate?: (snap: UnitSnapshot) => void;
  onUnitRemove?: (id: string) => void;
  onAsteroidAdd?: (snap: AsteroidSnapshot) => void;
  onAsteroidUpdate?: (snap: AsteroidSnapshot) => void;
  onAsteroidRemove?: (id: string) => void;
  onProjectileAdd?: (snap: ProjectileSnapshot) => void;
  onProjectileUpdate?: (snap: ProjectileSnapshot) => void;
  onProjectileRemove?: (id: string) => void;
  onStructureAdd?: (snap: StructureSnapshot) => void;
  onStructureUpdate?: (snap: StructureSnapshot) => void;
  onStructureRemove?: (id: string) => void;
  onWreckageAdd?: (snap: WreckageSnapshot) => void;
  onWreckageUpdate?: (snap: WreckageSnapshot) => void;
  onWreckageRemove?: (id: string) => void;
  onDisconnect?: (code: number) => void;
  onError?: (code: number, message: string) => void;
  onSnapshot?: () => void;
}

export interface NetClient {
  readonly sessionId: string;
  readonly playerCount: number;
  readonly unitCount: number;
  readonly asteroidCount: number;
  send(input: PlayerInput): void;
  spawnUnit(kind?: string): void;
  buildStructure(kind: string, x: number, y: number): void;
  /** Ask the server to respawn the local player. No-op server-side if alive. */
  respawn(): void;
  /** Drop every owned unit's chase target — they all return to formation. */
  recall(): void;
  /** Begin sustained dash thrust. Speed boost lasts until `dashEnd()`. */
  dashStart(): void;
  /** Stop sustained dash thrust. */
  dashEnd(): void;
  setHandlers(handlers: NetClientHandlers): void;
  leave(): Promise<void>;
}

export interface ConnectOptions {
  endpoint?: string;
  /** Display name shown in the player list — captured at the join overlay. */
  name?: string;
}

export async function connectToArena(opts: ConnectOptions = {}): Promise<NetClient> {
  const endpoint = opts.endpoint ?? defaultEndpoint();
  const client = new Colyseus.Client(endpoint);
  const room = await client.joinOrCreate<ArenaState>(ROOM_NAME, { name: opts.name });

  let handlers: NetClientHandlers = {};
  const $ = getStateCallbacks(room);

  $(room.state).players.onAdd((player: Player, sessionId: string) => {
    const isLocal = sessionId === room.sessionId;
    if (isLocal) {
      handlers.onLocalSpawn?.(toPlayerSnapshot(player, room.state.serverTime));
      $(player).onChange(() =>
        handlers.onLocalUpdate?.(toPlayerSnapshot(player, room.state.serverTime)),
      );
    } else {
      handlers.onRemoteAdd?.(toPlayerSnapshot(player, room.state.serverTime));
      $(player).onChange(() =>
        handlers.onRemoteUpdate?.(toPlayerSnapshot(player, room.state.serverTime)),
      );
    }
  });

  $(room.state).players.onRemove((_player: Player, sessionId: string) => {
    if (sessionId !== room.sessionId) {
      handlers.onRemoteRemove?.(sessionId);
    }
  });

  $(room.state).units.onAdd((unit: Unit, id: string) => {
    handlers.onUnitAdd?.(toUnitSnapshot(unit, id, room.state.serverTime));
    $(unit).onChange(() =>
      handlers.onUnitUpdate?.(toUnitSnapshot(unit, id, room.state.serverTime)),
    );
  });
  $(room.state).units.onRemove((_unit: Unit, id: string) => {
    handlers.onUnitRemove?.(id);
  });

  $(room.state).asteroids.onAdd((asteroid: Asteroid, id: string) => {
    handlers.onAsteroidAdd?.(toAsteroidSnapshot(asteroid, id, room.state.serverTime));
    $(asteroid).onChange(() =>
      handlers.onAsteroidUpdate?.(toAsteroidSnapshot(asteroid, id, room.state.serverTime)),
    );
  });
  $(room.state).asteroids.onRemove((_asteroid: Asteroid, id: string) => {
    handlers.onAsteroidRemove?.(id);
  });

  $(room.state).projectiles.onAdd((projectile: Projectile, id: string) => {
    handlers.onProjectileAdd?.(toProjectileSnapshot(projectile, id, room.state.serverTime));
    $(projectile).onChange(() =>
      handlers.onProjectileUpdate?.(toProjectileSnapshot(projectile, id, room.state.serverTime)),
    );
  });
  $(room.state).projectiles.onRemove((_p: Projectile, id: string) => {
    handlers.onProjectileRemove?.(id);
  });

  $(room.state).structures.onAdd((structure: Structure, id: string) => {
    handlers.onStructureAdd?.(toStructureSnapshot(structure, id));
    $(structure).onChange(() =>
      handlers.onStructureUpdate?.(toStructureSnapshot(structure, id)),
    );
  });
  $(room.state).structures.onRemove((_s: Structure, id: string) => {
    handlers.onStructureRemove?.(id);
  });

  $(room.state).wreckages.onAdd((w: Wreckage, id: string) => {
    handlers.onWreckageAdd?.(toWreckageSnapshot(w, id));
    $(w).onChange(() => handlers.onWreckageUpdate?.(toWreckageSnapshot(w, id)));
  });
  $(room.state).wreckages.onRemove((_w: Wreckage, id: string) => {
    handlers.onWreckageRemove?.(id);
  });

  room.onStateChange(() => handlers.onSnapshot?.());
  room.onLeave((code) => handlers.onDisconnect?.(code));
  room.onError((code, message) => handlers.onError?.(code, message ?? ""));

  return {
    get sessionId() {
      return room.sessionId;
    },
    get playerCount() {
      return room.state?.players?.size ?? 0;
    },
    get unitCount() {
      return room.state?.units?.size ?? 0;
    },
    get asteroidCount() {
      return room.state?.asteroids?.size ?? 0;
    },
    send(input) {
      room.send("input", input satisfies PlayerInput);
    },
    spawnUnit(kind = "rammer") {
      const msg: SpawnUnitMessage = { kind };
      room.send("spawn-unit", msg);
    },
    buildStructure(kind, x, y) {
      const msg: BuildStructureMessage = { kind, x, y };
      room.send("build-structure", msg);
    },
    respawn() {
      room.send("respawn");
    },
    recall() {
      room.send("recall");
    },
    dashStart() {
      room.send("dash-start");
    },
    dashEnd() {
      room.send("dash-end");
    },
    setHandlers(next) {
      handlers = next;
    },
    async leave() {
      await room.leave();
    },
  };
}

function toPlayerSnapshot(p: Player, serverTime: number): PlayerSnapshot {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    rotation: p.rotation,
    color: p.color,
    hp: p.hp,
    maxHp: p.maxHp,
    shield: p.shield,
    maxShield: p.maxShield,
    deathCount: p.deathCount,
    lastProcessedInputSeq: p.lastProcessedInputSeq,
    credits: p.credits,
    supplyCap: p.supplyCap,
    supplyUsed: p.supplyUsed,
    dashing: p.dashing,
    serverTime,
  };
}

function toWreckageSnapshot(w: Wreckage, id: string): WreckageSnapshot {
  return {
    id: id || w.id,
    x: w.x,
    y: w.y,
    color: w.color,
    ownerName: w.ownerName,
    credits: w.credits,
    halfSize: w.halfSize,
    expiresAt: w.expiresAt,
  };
}

function toStructureSnapshot(s: Structure, id: string): StructureSnapshot {
  return {
    id: id || s.id,
    ownerId: s.ownerId,
    kind: s.kind,
    color: s.color,
    x: s.x,
    y: s.y,
    hp: s.hp,
    maxHp: s.maxHp,
    shield: s.shield,
    maxShield: s.maxShield,
    rotation: s.rotation,
    cooldown: s.cooldown,
    targetId: s.targetId,
  };
}

function toAsteroidSnapshot(
  a: Asteroid,
  id: string,
  serverTime: number,
): AsteroidSnapshot {
  return {
    id: id || a.id,
    x: a.x,
    y: a.y,
    radius: a.radius,
    hp: a.hp,
    maxHp: a.maxHp,
    resourceValue: a.resourceValue,
    lastHitBy: a.lastHitBy,
    serverTime,
  };
}

function toProjectileSnapshot(
  p: Projectile,
  id: string,
  serverTime: number,
): ProjectileSnapshot {
  return {
    id: id || p.id,
    ownerId: p.ownerId,
    team: p.team,
    color: p.color,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    damage: p.damage,
    expiresAt: p.expiresAt,
    serverTime,
  };
}

function toUnitSnapshot(u: Unit, id: string, serverTime: number): UnitSnapshot {
  return {
    id: id || u.id,
    ownerId: u.ownerId,
    color: u.color,
    kind: u.kind,
    x: u.x,
    y: u.y,
    vx: u.vx,
    vy: u.vy,
    rotation: u.rotation,
    hp: u.hp,
    maxHp: u.maxHp,
    shield: u.shield,
    maxShield: u.maxShield,
    cooldown: u.cooldown,
    targetId: u.targetId,
    deactivated: u.deactivated,
    serverTime,
  };
}

function defaultEndpoint(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return import.meta.env.DEV
    ? `${protocol}://${location.hostname}:${SERVER_PORT}`
    : `${protocol}://${location.host}`;
}
