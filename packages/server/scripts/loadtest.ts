/**
 * Headless multi-client load harness. Spins up N Colyseus clients, has each
 * fly toward the world center while spamming spawn-unit requests, and prints
 * a periodic summary of connection state, snapshot frequency, and entity
 * counts. Pair with a real browser client as the (N+1)th seat to feel the
 * room under load.
 *
 * Usage:
 *   pnpm --filter @openspace/server loadtest         # 14 bots, default endpoint
 *   CLIENTS=8 ENDPOINT=ws://localhost:2567 pnpm ... loadtest
 *
 * The bot loop is intentionally simple: every BOT_TICK_MS the bot picks a
 * cursor target near the center, sends an input message, and (every
 * SPAWN_INTERVAL_MS) a spawn-unit message. No prediction, no rendering —
 * just enough traffic to mimic a busy player.
 */
import * as Colyseus from "colyseus.js";
import {
  ROOM_NAME,
  SERVER_PORT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  TICK_RATE_HZ,
  UNIT_SPAWN_COOLDOWN_MS,
} from "@openspace/shared";

const N_CLIENTS = parseInt(process.env.CLIENTS ?? "14", 10);
const ENDPOINT = process.env.ENDPOINT ?? `ws://localhost:${SERVER_PORT}`;
// One SIGINT/SIGTERM listener per bot — bump above default 10 cap.
process.setMaxListeners(N_CLIENTS + 4);
const REPORT_INTERVAL_MS = 2000;
const BOT_TICK_MS = 1000 / TICK_RATE_HZ;
const SPAWN_INTERVAL_MS = UNIT_SPAWN_COOLDOWN_MS;
const KINDS = ["rammer", "miner", "gunner", "laser", "repair", "shielder"] as const;

interface BotStats {
  id: number;
  name: string;
  connected: boolean;
  snapshots: number;
  lastSnapshotAt: number;
  inputsSent: number;
  spawnsSent: number;
  err?: string;
}

async function spawnBot(id: number): Promise<BotStats> {
  const stats: BotStats = {
    id,
    name: `Bot${id}`,
    connected: false,
    snapshots: 0,
    lastSnapshotAt: 0,
    inputsSent: 0,
    spawnsSent: 0,
  };
  const client = new Colyseus.Client(ENDPOINT);
  try {
    const room = await client.joinOrCreate(ROOM_NAME, { name: stats.name });
    stats.connected = true;

    room.onStateChange(() => {
      stats.snapshots++;
      stats.lastSnapshotAt = Date.now();
    });
    room.onLeave(() => {
      stats.connected = false;
    });
    room.onError((code, msg) => {
      stats.err = `${code}: ${msg}`;
    });

    // Pick a wandering target — circle the center at a slow rate so the bots
    // distribute around the arena instead of stacking at one point.
    const orbitRadius = 600 + id * 20;
    const orbitSpeed = 0.4 + (id % 3) * 0.1; // rad/s
    const phaseOffset = (id / N_CLIENTS) * Math.PI * 2;
    let seq = 0;
    let lastSpawn = 0;
    const inputTimer = setInterval(() => {
      const t = Date.now() / 1000;
      const angle = phaseOffset + t * orbitSpeed;
      const targetX = WORLD_WIDTH / 2 + Math.cos(angle) * orbitRadius;
      const targetY = WORLD_HEIGHT / 2 + Math.sin(angle) * orbitRadius;
      seq++;
      room.send("input", { seq, targetX, targetY });
      stats.inputsSent++;

      const now = Date.now();
      if (now - lastSpawn >= SPAWN_INTERVAL_MS) {
        const kind = KINDS[Math.floor(Math.random() * KINDS.length)]!;
        room.send("spawn-unit", { kind });
        stats.spawnsSent++;
        lastSpawn = now;
      }
    }, BOT_TICK_MS);

    process.on("SIGINT", () => clearInterval(inputTimer));
    process.on("SIGTERM", () => clearInterval(inputTimer));
  } catch (e) {
    stats.err = e instanceof Error ? e.message : String(e);
  }
  return stats;
}

async function main() {
  console.log(
    `[loadtest] connecting ${N_CLIENTS} bots → ${ENDPOINT}/${ROOM_NAME}`,
  );
  const bots: BotStats[] = [];
  // Stagger joins to avoid hammering the matchmaker simultaneously.
  for (let i = 0; i < N_CLIENTS; i++) {
    bots.push(await spawnBot(i));
    await new Promise((r) => setTimeout(r, 60));
  }
  const failed = bots.filter((b) => !b.connected);
  console.log(
    `[loadtest] connected=${bots.length - failed.length}/${bots.length} failed=${failed.length}`,
  );
  for (const f of failed) {
    console.warn(`  bot ${f.id}: ${f.err ?? "unknown error"}`);
  }

  // Periodic report.
  let lastTotalSnapshots = 0;
  setInterval(() => {
    const live = bots.filter((b) => b.connected);
    const totalSnapshots = bots.reduce((s, b) => s + b.snapshots, 0);
    const snapsPerSec =
      ((totalSnapshots - lastTotalSnapshots) / live.length) *
      (1000 / REPORT_INTERVAL_MS);
    lastTotalSnapshots = totalSnapshots;
    const totalInputs = bots.reduce((s, b) => s + b.inputsSent, 0);
    const totalSpawns = bots.reduce((s, b) => s + b.spawnsSent, 0);
    console.log(
      `[loadtest] live=${live.length} snaps/sec/bot=${snapsPerSec.toFixed(1)} ` +
        `total inputs=${totalInputs} spawns=${totalSpawns}`,
    );
  }, REPORT_INTERVAL_MS);
}

main().catch((e) => {
  console.error("[loadtest] fatal", e);
  process.exit(1);
});
