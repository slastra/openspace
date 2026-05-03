# openspace

Live demo: <https://space.lastra.us>

Multiplayer top-down arena. You pilot a ship, build a fleet of AI escort
drones, mine asteroids, drop supply depots and turrets, and brawl other
players. Server-authoritative physics via Rapier2D, geometric Pixi.js
rendering, Colyseus state sync, Svelte HUD.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173> in two browser tabs, pick a name, fly with
the cursor.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Steer toward cursor |
| **Space** (hold) | Recall fleet + dash — burns your own units while held |
| **A / S / D / F / G / H** | Spawn rammer / miner / gunner / laser / repair / shielder |
| **Q / W** | Toggle supply depot / turret placement (click to place, Esc to cancel) |
| **F1** | Debug overlay (hitboxes, target lines, prediction divergence) |

Mine asteroids with miners (per-tick drip while attached). Spend credits
on units and structures. Lose your ship and you drop a gold wreckage
square that holds your credits + orphaned units — first player to touch
it claims everything.

## Commands

| Command | Effect |
| --- | --- |
| `pnpm dev` | Server (2567) + client (5173) with hot reload |
| `pnpm typecheck` | Strict TS across all packages (incl. svelte-check) |
| `pnpm lint` | ESLint over the repo |
| `pnpm test` | Vitest for shared pure helpers |
| `pnpm build` | Production builds (shared → server → client) |

## Architecture

```
packages/shared/      cross-process source of truth
  schema.ts           Colyseus Schema (ArenaState, Player, Unit, Structure, Wreckage, Projectile, Asteroid)
  constants.ts        world dims, tick rate, gameplay tunables
  kinds.ts            UNIT_KIND_META — per-kind stats
  structures.ts       STRUCTURE_KIND_META — supply depot, turret
  combat.ts           Combatant union; type guards; targeting helpers
  formation.ts        multi-ring orbit slot math (server + client agree)
  movement.ts         stepPlayer (used by client prediction; server uses Rapier)
  types.ts            wire message types

packages/server/
  rooms/ArenaRoom.ts  Colyseus room; message handlers; SimContext
  physics.ts          Rapier wrapper (bodies, colliders, contact draining)
  simulation.ts       per-tick orchestrator: input → AI → step → collisions →
                      mining → abilities → repairs → shields → projectiles →
                      dash burn → explosions → wreckage claim → cull/respawn
  behaviors.ts        per-kind targeting + desired-velocity registry

packages/client/
  main.ts             bootstrap: renderer, net, HUD, join overlay
  game.ts             frame loop, input, placement, FX wiring
  net/client.ts       Colyseus wrapper exposing typed snapshots
  prediction.ts       client-side prediction for the local ship
  interpolation.ts    snapshot interpolation for remote entities
  entities/           LocalPlayer, RemotePlayer, Unit, Structure, Asteroid, Projectile, Wreckage
  render/             Pixi views (ships, units, structures, minimap, background, wreckages)
  effects/            death burst, respawn pulse, explosions, mining beams
  hud/                Svelte 5 components (StatsPanel, PlayerList, BuildHud, JoinOverlay, RespawnOverlay)
  debug/overlay.ts    F1 toggleable
```

### Authority + physics

- **Server runs Rapier.** Players, units, structures, asteroids are all
  rigid bodies (ball colliders). Each tick: write desired velocities,
  step, drain contact events for damage, read positions back into the
  schema.
- **Client predicts the local ship** kinematically (no Rapier in the
  browser bundle) using `stepPlayer` from shared. Reconcile snaps to
  authority when drift exceeds threshold.
- **Remote ships and units interpolate** server snapshots ~150ms behind
  server time. Bullets *extrapolate* from the latest snapshot anchor so
  hits land where the server saw them, with no interpolation lag.
- **Density-based mass**: ship density 12 vs unit density 1 — heavy
  ships glide through unit clusters without jitter.

### Combat + economy

- Every Combatant has hp/maxHp and (optionally) shield/maxShield.
  Damage drains shield first.
- Collision damage scales with relative velocity (engine-wash from a
  dashing ship melts your own fleet too).
- Units acquire nearest enemy in `aggroRadius` (sticky to
  `releaseRadius`). Behaviors: ram, kite-and-shoot, hitscan laser,
  repair beam, shield aura, mine.
- Per-player **supply cap** from depots. Excess units flip to a
  deactivated state and inertly orbit until cap returns.
- **Wreckage**: dying drops a gold square sized by your credit pile,
  holding your credits and orphaned units. Touch to claim. Expires
  after 30s.
- Click-to-respawn: dying leaves you gone until you press the button.

## Adding a unit kind

The simulation tick, network layer, and HUD don't change.

1. **`packages/shared/src/kinds.ts`** — register stats in `UNIT_KIND_META`.
2. **`packages/server/src/behaviors.ts`** — register a behavior in `kindBehaviors`.
3. **`packages/client/src/render/units.ts`** — add a `case` in `createUnitView`.
4. Bind a key in `game.ts` (`net.spawnUnit("yourkind")`).

`pnpm test && pnpm typecheck && pnpm lint` should stay green.

## Known landmines

- **Schema decorator emit**: TS class-field initializers shadow
  `defineTypes` getters. Use constructor-init pattern with
  `useDefineForClassFields: false`.
- **DPR drift**: camera math uses `app.canvas.getBoundingClientRect()`,
  not `renderer.width / resolution` (Firefox disagrees).
- **Server time monotonic**: `state.serverTime = performance.now()`.
- **Rapier init is async** — cached at process scope, shared across
  rooms.
- **Body cleanup is mandatory**: `removeRigidBody` on every destroy,
  `world.free()` on room dispose. WASM heap leaks otherwise.
