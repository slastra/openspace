import {
  BASE_CLAIM_RADIUS_U,
  DASH_SPEED_MULTIPLIER,
  EmoteKind,
  SPAWN_BUBBLE_RADIUS_U,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  PLAYER_CONTACT_RADIUS,
  STRUCTURE_KIND_META,
  UNIT_SPAWN_COOLDOWN_MS,
  StructureKindName,
  UNIT_KIND_META,
  snapToGrid,
} from "@openspace/shared";
import { Renderer } from "./render/renderer.js";
import { InputState } from "./input.js";
import { NetClient } from "./net/client.js";
import { LocalPlayer, RemotePlayer } from "./entities/players.js";
import { Unit, renderUnits } from "./entities/units.js";
import { Asteroid, tickAsteroids } from "./entities/asteroids.js";
import { Projectile, renderProjectiles } from "./entities/projectiles.js";
import { Structure } from "./entities/structures.js";
import { Wreckage, tickWreckages } from "./entities/wreckages.js";
import { resolveRenderedPosition } from "./entities/lookup.js";
import { createPlacementGhost } from "./render/structures.js";
import { EffectManager } from "./effects/manager.js";
import { createDeathBurst } from "./effects/death.js";
import { createRespawnPulse } from "./effects/respawn.js";
import { createBeam } from "./effects/beam.js";
import { createBulletPop } from "./effects/bullet-pop.js";
import { createEmoteBubble } from "./effects/emote-bubble.js";
import { createExplosion } from "./effects/explosion.js";
import { DebugOverlay } from "./debug/overlay.js";
import { HealTetherLayer } from "./render/heal-tether.js";
import { MiningParticleLayer } from "./render/mining-particles.js";
import { Minimap } from "./render/minimap.js";
import { hud, LeaderboardEntry, DebugMetrics } from "./hud/hudState.svelte.js";

export interface GameDeps {
  renderer: Renderer;
  input: InputState;
  net: NetClient;
}

/**
 * Wires the running game together: spawns entities from net events, runs
 * the per-frame loop (predict local → send → interpolate remote → render
 * units → effects → camera → HUD).
 *
 * All gameplay (targeting, ramming, damage, respawn, kind-specific behavior)
 * is server-authoritative. The client just renders interpolated/predicted
 * snapshots, dispatches input, and emits transient FX on death/respawn.
 */
export function startGame({ renderer, input, net }: GameDeps) {
  const remotes = new Map<string, RemotePlayer>();
  const units = new Map<string, Unit>();
  const asteroids = new Map<string, Asteroid>();
  const projectiles = new Map<string, Projectile>();
  const structures = new Map<string, Structure>();
  const wreckages = new Map<string, Wreckage>();
  let local: LocalPlayer | null = null;
  /** Active build mode: structure kind name to place on next click, or null. */
  let placing: StructureKindName | null = null;
  /** True while the player is in recycle mode (X). Click an owned structure
   *  to reclaim it for a partial refund. Esc / right-click cancels. */
  let recycling = false;

  // Incremental kind counters for the local player. Updated only on
  // entity add/remove (own units + structures), read each frame by the
  // build HUD. Replaces the per-frame walk over the AOI-trimmed local
  // state — same result, no allocation churn or filter re-traversal.
  // Other-player counts aren't tracked here; the build HUD only ever
  // shows local owned counts.
  const localUnitCounts: Record<string, number> = {};
  const localStructureCounts: Record<string, number> = {};
  let localUnitTotal = 0;

  // Effects layer lives in world space (above the entities) so explosions
  // and spawn pulses pan with the camera.
  const effects = new EffectManager(renderer.world);
  // Heal tethers sit between effects and entities — visible above ships so
  // you can clearly see who's being patched up, but under burst FX.
  const healTethers = new HealTetherLayer(renderer.world);
  const miningParticles = new MiningParticleLayer(renderer.world);
  const minimap = new Minimap(renderer.app);
  // Placement ghost lives in world space; visibility tracks `placing` state.
  const placementGhost = createPlacementGhost();
  placementGhost.container.visible = false;
  renderer.world.addChild(placementGhost.container);
  // Debug overlay sits on top of effects; F1 toggles it.
  const debug = new DebugOverlay(renderer.world);

  // Track an estimate of (clientNow - serverNow) so we can timestamp samples
  // and render in the same clock domain. Both directions are smoothed so a
  // single jittery sample doesn't snap the world relative to the camera-
  // followed local ship: attack at ~10%/sample (catches up to a sustained
  // change in ~5 samples / 250ms), decay at ~1%/sample. Late samples that
  // briefly fall behind the buffer are absorbed by capped extrapolation in
  // RemoteInterpolator. The older "forever min" approach pinned to the
  // lowest-RTT sample seen and froze entities whenever transit exceeded it.
  let serverOffset: number | null = null;
  // Diagnostic side-tables for the F1 debug panel. Cheap rolling windows;
  // sized for ~2s of history at the relevant rate.
  const offsetSamples: number[] = [];
  const frameDtSamples: number[] = [];
  const snapshotIntervals: number[] = [];
  const snapshotArrivalTimes: number[] = [];
  let lastSeenServerTime = 0;
  const updateOffset = (snapServerTime: number) => {
    const now = performance.now();
    const offset = now - snapServerTime;
    if (serverOffset === null) {
      serverOffset = offset;
    } else if (offset > serverOffset) {
      serverOffset = serverOffset * 0.9 + offset * 0.1;
    } else {
      serverOffset = serverOffset * 0.99 + offset * 0.01;
    }
    // Sample once per distinct snapshot — Colyseus delivers each entity in
    // a snapshot through its own callback, so multiple updateOffset calls
    // share the same `now` AND `snapServerTime`. Recording one sample per
    // entity collapses the variance to zero (RTT spread always shows 0).
    if (snapServerTime !== lastSeenServerTime) {
      if (lastSeenServerTime !== 0) {
        pushBounded(snapshotIntervals, snapServerTime - lastSeenServerTime, 60);
      }
      lastSeenServerTime = snapServerTime;
      pushBounded(snapshotArrivalTimes, now, 60);
      pushBounded(offsetSamples, offset, 60);
    }
  };

  // Hold-to-spawn: bindings checked per frame in the ticker. Tapping fires
  // immediately (first frame the key goes down); holding repeats at the
  // server cooldown cadence so the message rate matches what the server
  // will accept — no point firing 60Hz worth of message just to be dropped.
  const SPAWN_BINDINGS: ReadonlyArray<readonly [string, string]> = [
    ["KeyA", "rammer"],
    ["KeyS", "miner"],
    ["KeyD", "gunner"],
    ["KeyF", "laser"],
    ["KeyG", "repair"],
    ["KeyH", "shielder"],
  ];
  const lastSpawnSentAt = new Map<string, number>();
  input.onKeyTap("F1", () => debug.toggle());
  // Spacebar: tap = recall fleet AND start sustained dash thrust. Hold to
  // keep dashing — every owned unit takes engine-wash damage while held.
  // Release to stop. Local `dashHeld` drives prediction immediately so the
  // ship's boosted velocity matches what the server is about to compute.
  let dashHeld = false;
  input.onKeyTap("Space", () => {
    dashHeld = true;
    net.recall();
    net.dashStart();
  });
  input.onKeyUp("Space", () => {
    if (!dashHeld) return;
    dashHeld = false;
    net.dashEnd();
  });
  input.onKeyTap("KeyQ", () => {
    placing = placing === "base" ? null : "base";
    if (placing) {
      recycling = false;
      placementGhost.setKind(placing);
    }
    placementGhost.container.visible = placing !== null;
  });
  input.onKeyTap("KeyW", () => {
    placing = placing === "supply" ? null : "supply";
    if (placing) {
      recycling = false;
      placementGhost.setKind(placing);
    }
    placementGhost.container.visible = placing !== null;
  });
  input.onKeyTap("KeyE", () => {
    placing = placing === "turret" ? null : "turret";
    if (placing) {
      recycling = false;
      placementGhost.setKind(placing);
    }
    placementGhost.container.visible = placing !== null;
  });
  input.onKeyTap("KeyR", () => {
    placing = placing === "wall" ? null : "wall";
    if (placing) {
      recycling = false;
      placementGhost.setKind(placing);
    }
    placementGhost.container.visible = placing !== null;
  });
  input.onKeyTap("KeyT", () => {
    placing = placing === "medbay" ? null : "medbay";
    if (placing) {
      recycling = false;
      placementGhost.setKind(placing);
    }
    placementGhost.container.visible = placing !== null;
  });
  input.onKeyTap("KeyX", () => {
    recycling = !recycling;
    if (recycling) {
      placing = null;
      placementGhost.container.visible = false;
    }
  });
  const cancelModes = () => {
    placing = null;
    placementGhost.container.visible = false;
    recycling = false;
  };
  input.onKeyTap("Escape", cancelModes);
  input.onRightClick(cancelModes);
  // Right-button DOWN also opens the radial emote menu at the click
  // point. Cancel + menu-open are non-conflicting: tap with no drag
  // closes the menu silently AND fires cancel; drag-and-release fires
  // an emote AND fires cancel (whatever build mode you were in is
  // cleared either way, which feels right).
  input.onRightDown((x, y) => {
    const rect = renderer.app.canvas.getBoundingClientRect();
    hud.emoteMenu = { x: rect.left + x, y: rect.top + y };
  });
  input.onClick((sx, sy) => {
    const world = renderer.camera.screenToWorld(sx, sy);
    if (recycling) {
      const target = pickOwnedStructure(world.x, world.y, structures, net.sessionId);
      if (target) {
        net.recycleStructure(target.id);
        cancelModes();
      }
      return;
    }
    if (!placing) return;
    const snapX = snapToGrid(world.x);
    const snapY = snapToGrid(world.y);
    if (!canPlace(placing, snapX, snapY, local, remotes, structures, net.sessionId)) return;
    net.buildStructure(placing, world.x, world.y);
    cancelModes();
  });

  net.setHandlers({
    onLocalSpawn(snap) {
      updateOffset(snap.serverTime);
      // Provide a live view of asteroid positions so prediction can resolve
      // the player's ship out of overlaps the same way Rapier does on the
      // server. Without this, drift on contact triggers reconcile snaps.
      local = new LocalPlayer(snap, renderer, () =>
        worldObstacles(asteroids, structures, net.sessionId),
      );
      renderer.camera.setTarget(snap.x, snap.y);
    },
    onLocalUpdate(snap) {
      updateOffset(snap.serverTime);
      if (!local) return;
      // Split the death and respawn moments. Death fires the moment HP
      // hits zero (so the ship blows up immediately, not later when the
      // player chooses to respawn); the ship view hides for the duration
      // of the dead state. Respawn fires when deathCount increments.
      const justDied = local.hp > 0 && snap.hp <= 0;
      const justRespawned = snap.deathCount > local.deathCount;
      if (justDied) {
        effects.add(
          createDeathBurst(local.prediction.position.x, local.prediction.position.y, local.color),
        );
        local.ship.container.visible = false;
      }
      if (justRespawned) {
        effects.add(createRespawnPulse(snap.x, snap.y, snap.color));
        local.ship.container.visible = true;
      }
      local.applyServerUpdate(snap);
    },
    onRemoteAdd(snap) {
      updateOffset(snap.serverTime);
      remotes.set(snap.id, new RemotePlayer(snap, renderer));
    },
    onRemoteUpdate(snap) {
      updateOffset(snap.serverTime);
      const r = remotes.get(snap.id);
      if (!r) return;
      const justDied = r.hp > 0 && snap.hp <= 0;
      const justRespawned = snap.deathCount > r.deathCount;
      if (justDied) {
        effects.add(createDeathBurst(r.renderedX, r.renderedY, r.color));
        r.ship.container.visible = false;
      }
      if (justRespawned) {
        effects.add(createRespawnPulse(snap.x, snap.y, snap.color));
        r.ship.container.visible = true;
      }
      r.applyServerUpdate(snap);
    },
    onRemoteRemove(sessionId) {
      const r = remotes.get(sessionId);
      if (!r) return;
      // Player permanently left — fire one death burst at last seen pos.
      effects.add(createDeathBurst(r.renderedX, r.renderedY, r.color));
      r.destroy(renderer);
      remotes.delete(sessionId);
    },
    onUnitAdd(snap) {
      updateOffset(snap.serverTime);
      units.set(snap.id, new Unit(snap, renderer));
      if (snap.ownerId === net.sessionId) {
        localUnitCounts[snap.kind] = (localUnitCounts[snap.kind] ?? 0) + 1;
        localUnitTotal++;
      }
    },
    onUnitUpdate(snap) {
      updateOffset(snap.serverTime);
      const u = units.get(snap.id);
      if (!u) return;
      // fireCount increase = the server just fired this unit's ability.
      // For hitscan kinds (laser) we render a beam; projectile kinds (gunner)
      // already get their visual via the projectile snapshot stream, so we
      // skip the beam to avoid drawing both.
      const meta = UNIT_KIND_META[u.kind];
      const isHitscan = !!meta && meta.abilityRange !== undefined && !meta.projectileSpeed;
      if (isHitscan && snap.fireCount !== u.lastFireCount && snap.targetId) {
        const tgt = resolveRenderedPosition(
          snap.targetId,
          local,
          net.sessionId,
          remotes,
          units,
          structures,
        );
        if (tgt) {
          // Fade beam alpha with shot distance so edge-of-range shots look
          // wispy and point-blank shots look full-strength. Floor at 0.3
          // so a max-range hit is still visible.
          const range = meta.abilityRange ?? 0;
          const dx = tgt.x - u.view.container.x;
          const dy = tgt.y - u.view.container.y;
          const dist = Math.hypot(dx, dy);
          const intensity =
            range > 0 ? Math.max(0.3, 1 - 0.7 * (dist / range)) : 1;
          effects.add(
            createBeam(
              u.view.container.x,
              u.view.container.y,
              tgt.x,
              tgt.y,
              u.color,
              intensity,
            ),
          );
        }
      }
      u.applyServerUpdate(snap);
      u.lastFireCount = snap.fireCount;
    },
    onUnitRemove(id) {
      const u = units.get(id);
      if (!u) return;
      // Visual explosion sized to the kind's actual AOE radius — players can
      // see exactly how much area each death threatens.
      const radius = UNIT_KIND_META[u.kind]?.explodeRadius ?? 0;
      effects.add(createExplosion(u.view.container.x, u.view.container.y, radius, u.color));
      if (u.ownerId === net.sessionId) {
        const next = (localUnitCounts[u.kind] ?? 0) - 1;
        if (next > 0) localUnitCounts[u.kind] = next;
        else delete localUnitCounts[u.kind];
        localUnitTotal--;
      }
      u.destroy(renderer);
      units.delete(id);
    },
    onAsteroidAdd(snap) {
      updateOffset(snap.serverTime);
      asteroids.set(snap.id, new Asteroid(snap, renderer));
    },
    onAsteroidUpdate(snap) {
      updateOffset(snap.serverTime);
      asteroids.get(snap.id)?.applyServerUpdate(snap);
    },
    onAsteroidRemove(id) {
      const a = asteroids.get(id);
      if (!a) return;
      // Asteroid colour palette differs from player colours; pick a warm
      // earthy hex so the burst looks like dust+rock, not team paint.
      effects.add(createDeathBurst(a.view.container.x, a.view.container.y, "#b8a07a"));
      a.destroy(renderer);
      asteroids.delete(id);
    },
    onProjectileAdd(snap) {
      updateOffset(snap.serverTime);
      projectiles.set(snap.id, new Projectile(snap, renderer));
    },
    onProjectileUpdate(snap) {
      updateOffset(snap.serverTime);
      projectiles.get(snap.id)?.applyServerUpdate(snap);
    },
    onProjectileRemove(id) {
      const p = projectiles.get(id);
      if (!p) return;
      // Compute position at the current server time so the pop lands where
      // the server actually killed the projectile (the view's x/y is from
      // the previous render frame and could be a tick behind).
      const serverNow = serverOffset !== null ? performance.now() - serverOffset : performance.now();
      const pos = p.positionAt(serverNow);
      effects.add(createBulletPop(pos.x, pos.y, "#ffd166"));
      p.destroy(renderer);
      projectiles.delete(id);
    },
    onStructureAdd(snap) {
      structures.set(snap.id, new Structure(snap, renderer));
      if (snap.ownerId === net.sessionId) {
        localStructureCounts[snap.kind] = (localStructureCounts[snap.kind] ?? 0) + 1;
      }
    },
    onStructureUpdate(snap) {
      const s = structures.get(snap.id);
      if (!s) return;
      // fireCount increase = the server just fired this turret. Same mechanic
      // as the laser unit (see onUnitUpdate); spawn the beam at the
      // structure's current position to the target's rendered spot.
      if (snap.fireCount !== s.lastFireCount && snap.targetId) {
        const tgt = resolveRenderedPosition(
          snap.targetId,
          local,
          net.sessionId,
          remotes,
          units,
          structures,
        );
        if (tgt) {
          const meta = STRUCTURE_KIND_META[s.kind];
          const range = meta?.abilityRange ?? 0;
          const dx = tgt.x - s.view.container.x;
          const dy = tgt.y - s.view.container.y;
          const dist = Math.hypot(dx, dy);
          const intensity =
            range > 0 ? Math.max(0.3, 1 - 0.7 * (dist / range)) : 1;
          effects.add(
            createBeam(
              s.view.container.x,
              s.view.container.y,
              tgt.x,
              tgt.y,
              s.color,
              intensity,
            ),
          );
        }
      }
      s.applyServerUpdate(snap);
      s.lastFireCount = snap.fireCount;
    },
    onStructureRemove(id) {
      const s = structures.get(id);
      if (!s) return;
      // Bigger pop than a unit — structures take a beating to fall.
      effects.add(createExplosion(s.view.container.x, s.view.container.y, 50, s.color));
      if (s.ownerId === net.sessionId) {
        const next = (localStructureCounts[s.kind] ?? 0) - 1;
        if (next > 0) localStructureCounts[s.kind] = next;
        else delete localStructureCounts[s.kind];
      }
      s.destroy(renderer);
      structures.delete(id);
    },
    onWreckageAdd(snap) {
      wreckages.set(snap.id, new Wreckage(snap, renderer));
    },
    onWreckageUpdate(snap) {
      wreckages.get(snap.id)?.applyServerUpdate(snap);
    },
    onWreckageRemove(id) {
      const w = wreckages.get(id);
      if (!w) return;
      // Small pop on claim/expiry — clear visual feedback that it's gone.
      effects.add(createBulletPop(w.view.container.x, w.view.container.y, "#facc15"));
      w.destroy(renderer);
      wreckages.delete(id);
    },
    onDisconnect(code) {
      hud.status = `disconnected (${code})`;
    },
    onError(code, message) {
      console.error("[room error]", code, message);
    },
    onEvent(event) {
      // Translate the wire event into a feed entry. The local-player
      // highlight is computed here (NetClient handler is the only place
      // we both have the event AND know the local sessionId).
      if (event.kind === "kill") {
        hud.pushFeedEntry({
          kind: "kill",
          killerName: event.killerName,
          killerColor: event.killerColor,
          victimName: event.victimName,
          victimColor: event.victimColor,
          involvesLocal:
            event.killerId === net.sessionId ||
            event.victimId === net.sessionId,
        });
      } else if (event.kind === "emote") {
        hud.pushFeedEntry({
          kind: "emote",
          senderName: event.senderName,
          senderColor: event.senderColor,
          emote: event.emote,
        });
        // World-space bubble above the sender's ship — only renders if
        // the sender is in our AOI (we have their ship position). When
        // they're not, the toast in the feed is the universal cue.
        const glyph = EMOTE_GLYPHS[event.emote];
        if (glyph) {
          const senderId = event.senderId;
          const anchor = () => {
            if (senderId === net.sessionId && local) {
              return { x: local.ship.container.x, y: local.ship.container.y };
            }
            const r = remotes.get(senderId);
            if (r) return { x: r.renderedX, y: r.renderedY };
            return null;
          };
          if (anchor()) effects.add(createEmoteBubble(glyph, anchor));
        }
      } else if (event.kind === "base-attack") {
        hud.pushFeedEntry({ kind: "base-attack" });
      }
    },
  });

  let lastFrame = performance.now();
  let lastCredits = -1;
  let lastDebugPush = 0;
  renderer.app.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const serverNow = serverOffset !== null ? now - serverOffset : now;

    // Held-key spawn: tap fires immediately (lastSent at 0); holding repeats
    // at server cooldown cadence so we don't flood with messages the server
    // would just drop.
    for (const [key, kind] of SPAWN_BINDINGS) {
      if (!input.isKeyDown(key)) continue;
      const last = lastSpawnSentAt.get(key) ?? 0;
      if (now - last < UNIT_SPAWN_COOLDOWN_MS) continue;
      net.spawnUnit(kind);
      lastSpawnSentAt.set(key, now);
    }

    if (local) {
      if (local.hp > 0) {
        // While in placement or recycle mode the cursor is the targeting
        // reticle, not a steering input; freeze the ship by pointing input
        // at its own current location (inside the input deadzone → zero
        // desired velocity).
        const target = placing || recycling
          ? local.prediction.position
          : cursorTarget(local, input, renderer);
        // Local key state drives prediction immediately for snappy feel; the
        // schema's `dashing` mirror is updated by the server within a tick.
        // Both converge — prediction never disagrees with authority once the
        // round-trip completes.
        const speedMultiplier = dashHeld || local.dashing ? DASH_SPEED_MULTIPLIER : 1;
        const stepped = local.step(dt, target, speedMultiplier, serverNow);
        for (const i of stepped.inputs) net.send(i);
        renderer.camera.setTarget(stepped.x, stepped.y);
      } else {
        // Dead: keep the camera anchored on the wreckage so the player can
        // see what happened (and where to come back to claim it themselves).
        renderer.camera.setTarget(local.prediction.position.x, local.prediction.position.y);
      }
    }
    renderer.camera.apply();

    for (const r of remotes.values()) r.render(serverNow);
    renderUnits(units, serverNow);
    renderProjectiles(projectiles, serverNow);
    tickAsteroids(asteroids, dt);
    tickWreckages(wreckages, dt);
    healTethers.render(units, structures, local, remotes, net.sessionId, now / 1000);
    miningParticles.render(asteroids, units, local, remotes.values(), dt);
    minimap.render(
      asteroids.values(),
      structures.values(),
      units.values(),
      local,
      net.sessionId,
      remotes.values(),
    );
    effects.update(dt);
    debug.render(local, remotes, units, asteroids, structures, net.sessionId);

    // F1 debug metrics: only refresh the panel when the overlay is on, and
    // throttle to 4Hz so the numbers are readable instead of vibrating.
    pushBounded(frameDtSamples, dt * 1000, 60);
    if (debug.isEnabled()) {
      if (now - lastDebugPush > 250) {
        lastDebugPush = now;
        hud.debug = collectDebugMetrics({
          frameDtSamples,
          snapshotIntervals,
          snapshotArrivalTimes: snapshotArrivalTimes.slice(),
          offsetSamples,
          serverOffset,
          local,
          unitsCount: units.size,
          asteroidsCount: asteroids.size,
          projectilesCount: projectiles.size,
          playersCount: remotes.size + (local ? 1 : 0),
          now,
        });
      }
    } else if (hud.debug !== null) {
      hud.debug = null;
    }

    if (local && local.credits !== lastCredits) {
      hud.setMinerals(local.credits);
      lastCredits = local.credits;
    }

    if (placing) {
      const cursor = input.active
        ? renderer.camera.screenToWorld(input.screenX, input.screenY)
        : (local ? local.prediction.position : { x: 0, y: 0 });
      const sx = snapToGrid(cursor.x);
      const sy = snapToGrid(cursor.y);
      placementGhost.setPos(sx, sy);
      placementGhost.setValid(canPlace(placing, sx, sy, local, remotes, structures, net.sessionId));
    }

    // Recycle-mode visuals: pulse owned structures to make them obvious targets.
    // Pulse uses a sin wave so it's a soft strobe rather than a hard flash.
    if (recycling) {
      const pulse = 0.55 + 0.35 * Math.sin(now / 140);
      for (const s of structures.values()) {
        s.view.container.alpha = s.ownerId === net.sessionId ? pulse : 0.35;
      }
    } else {
      // Restore default alpha on exit. Cheap to set every frame; only matters
      // for one frame after the mode flips off.
      for (const s of structures.values()) s.view.container.alpha = 1;
    }
    hud.modeHint = recycling ? "RECYCLE — click a structure to reclaim" : "";

    pushHudUpdates(localUnitCounts, localStructureCounts, localUnitTotal, local, placing);
    pushLeaderboard(net);
    hud.isDead = local !== null && local.hp <= 0;
    hud.pruneFeed(now);
  });
}

/** Wire emote enums to their world-space glyph. The HUD feed uses its
 *  own copy with labels; this one is just the glyph-by-kind lookup
 *  used to spawn the floating bubble effect. */
const EMOTE_GLYPHS: Record<EmoteKind, string> = {
  greet: "👋",
  help: "⚠️",
  attack: "⚔️",
  truce: "🤝",
  thanks: "👍",
  rip: "💀",
};

/**
 * Build the rank list from the server-broadcast leaderboard map. Counts are
 * authoritative on the server and survive AOI filtering — without that we'd
 * miss every unit a far-away player owns. Walk is O(players) per frame
 * (≤ MAX_PLAYERS_PER_ROOM), so re-allocating each frame is fine.
 */
function pushLeaderboard(net: NetClient) {
  const board = net.getLeaderboard();
  const entries: LeaderboardEntry[] = board.map((e) => ({
    id: e.id,
    name: e.name,
    color: e.color,
    rank: e.unitCount,
    isLocal: e.id === net.sessionId,
    isDead: e.isDead,
  }));
  entries.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  hud.players = entries;
}

/**
 * Per-frame: push owned counts (kept incrementally up-to-date by the
 * onUnitAdd/Remove + onStructureAdd/Remove listeners), affordability,
 * and stats into the HUD. No state-map walks here — the side-tables are
 * authoritative for the local player's totals.
 */
function pushHudUpdates(
  unitCounts: Record<string, number>,
  structureCounts: Record<string, number>,
  totalUnits: number,
  local: LocalPlayer | null,
  placing: StructureKindName | null,
) {
  const ownedByKind: Record<string, number> = { ...unitCounts, ...structureCounts };

  const credits = local?.credits ?? 0;
  const supplyUsed = local?.supplyUsed ?? 0;
  const supplyCap = local?.supplyCap ?? 0;
  // Base-gated production: without an owned base, no unit can be spawned
  // regardless of credits/supply. Mirrors the server gate so the HUD
  // greys out unit cards that would be rejected on submit.
  const hasBase = (structureCounts.base ?? 0) > 0;
  const affordable: Record<string, boolean> = {};
  for (const [kind, meta] of Object.entries(UNIT_KIND_META)) {
    affordable[kind] =
      hasBase &&
      credits >= meta.cost &&
      supplyUsed + meta.supplyCost <= supplyCap;
  }
  for (const [kind, meta] of Object.entries(STRUCTURE_KIND_META)) {
    // Per-kind cap (e.g. base capped at 1) — a structure at its limit
    // greys out even if the player has the credits.
    const atLimit =
      meta.maxPerPlayer !== undefined &&
      (structureCounts[kind] ?? 0) >= meta.maxPerPlayer;
    affordable[kind] = !atLimit && credits >= meta.cost;
  }

  hud.unitCounts = ownedByKind;
  hud.affordable = affordable;
  hud.placing = placing;
  hud.rank = totalUnits;
  if (local) {
    hud.hp = local.hp;
    hud.maxHp = local.maxHp;
    hud.supplyUsed = local.supplyUsed;
    hud.supplyCap = local.supplyCap;
  }
}

function cursorTarget(
  local: LocalPlayer,
  input: InputState,
  renderer: Renderer,
): { x: number; y: number } {
  if (!input.active) return local.prediction.position;
  return renderer.camera.screenToWorld(input.screenX, input.screenY);
}

/**
 * Mirrors the server's `build-structure` validation so the placement ghost
 * (and click) reject tiles that would either cost more than the player has,
 * stack on another structure, or trap a live ship inside the new collider.
 * Keeping this in lockstep with `ArenaRoom.onMessage("build-structure")`
 * avoids the player ever firing a click the server then ignores.
 */
function canPlace(
  kind: StructureKindName,
  snapX: number,
  snapY: number,
  local: LocalPlayer | null,
  remotes: Map<string, RemotePlayer>,
  structures: Map<string, Structure>,
  localSessionId: string,
): boolean {
  const meta = STRUCTURE_KIND_META[kind];
  if (!meta) return false;
  if (local && local.credits < meta.cost) return false;
  // Per-kind cap check (mirrors server). Walk own structures of the chosen
  // kind and reject if at the limit.
  if (meta.maxPerPlayer !== undefined) {
    let ownedOfKind = 0;
    for (const s of structures.values()) {
      if (s.ownerId === localSessionId && s.kind === kind) ownedOfKind++;
    }
    if (ownedOfKind >= meta.maxPerPlayer) return false;
  }
  for (const s of structures.values()) {
    if (s.view.container.x === snapX && s.view.container.y === snapY) return false;
  }
  const reach = meta.halfExtent + PLAYER_CONTACT_RADIUS;
  const reachSq = reach * reach;
  if (local && local.hp > 0) {
    const dx = local.prediction.position.x - snapX;
    const dy = local.prediction.position.y - snapY;
    if (dx * dx + dy * dy < reachSq) return false;
  }
  for (const r of remotes.values()) {
    if (r.hp <= 0) continue;
    const dx = r.renderedX - snapX;
    const dy = r.renderedY - snapY;
    if (dx * dx + dy * dy < reachSq) return false;
  }
  // No-build bubble around the world-center spawn point. Mirrors the
  // server-side check so the ghost reads red while the cursor is over
  // the spawn zone.
  {
    const cx = WORLD_WIDTH / 2;
    const cy = WORLD_HEIGHT / 2;
    const dx = snapX - cx;
    const dy = snapY - cy;
    if (dx * dx + dy * dy < SPAWN_BUBBLE_RADIUS_U * SPAWN_BUBBLE_RADIUS_U) return false;
  }
  // Mirror server base-claim check so the placement ghost reads red over
  // enemy claimed territory before the click ever fires. Own base doesn't
  // block — you build freely inside your own claim.
  const claimSq = BASE_CLAIM_RADIUS_U * BASE_CLAIM_RADIUS_U;
  for (const s of structures.values()) {
    if (s.kind !== "base") continue;
    if (s.ownerId === localSessionId) continue;
    const dx = s.view.container.x - snapX;
    const dy = s.view.container.y - snapY;
    if (dx * dx + dy * dy < claimSq) return false;
  }
  return true;
}

/**
 * Stream every solid obstacle the client knows about so the local-player
 * predictor can resolve overlap before drift triggers a snap-back. Structures
 * use ball colliders server-side (matches the asteroid model) so we hand
 * the predictor the exact same radius — predictor and server agree on where
 * the ship stops, no jitter.
 */
function* worldObstacles(
  asteroids: Map<string, Asteroid>,
  structures: Map<string, Structure>,
  localSessionId: string,
): Iterable<{ x: number; y: number; radius: number }> {
  for (const a of asteroids.values()) {
    yield { x: a.view.container.x, y: a.view.container.y, radius: a.radius };
  }
  for (const s of structures.values()) {
    const meta = STRUCTURE_KIND_META[s.kind];
    if (!meta) continue;
    // Server gives our walls (cuboid + owner-passthrough filter) a free
    // pass for our own ship — mirror that here so the local predictor
    // doesn't bounce the ship off a wall the server is letting it through.
    // Only walls have the passthrough filter; supplies/turrets/bases keep
    // the default collide-with-everyone group.
    if (
      meta.colliderShape === "cuboid" &&
      s.ownerId === localSessionId
    ) {
      continue;
    }
    yield {
      x: s.view.container.x,
      y: s.view.container.y,
      radius: meta.halfExtent,
    };
  }
}

/** Find the owned structure whose footprint contains (x, y). Used for the
 *  recycle-mode click — picks any structure (regardless of HP) so the
 *  player can also reclaim partially-damaged ones. Returns the first match;
 *  structures don't overlap so there's at most one. */
function pickOwnedStructure(
  x: number,
  y: number,
  structures: Map<string, Structure>,
  ownerId: string,
): Structure | null {
  for (const s of structures.values()) {
    if (s.ownerId !== ownerId) continue;
    const meta = STRUCTURE_KIND_META[s.kind];
    if (!meta) continue;
    const dx = s.view.container.x - x;
    const dy = s.view.container.y - y;
    if (dx * dx + dy * dy <= meta.halfExtent * meta.halfExtent) return s;
  }
  return null;
}

function pushBounded(arr: number[], v: number, max: number) {
  arr.push(v);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function meanOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function p99Of(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!;
}

interface DebugInputs {
  frameDtSamples: number[];
  snapshotIntervals: number[];
  snapshotArrivalTimes: number[];
  offsetSamples: number[];
  serverOffset: number | null;
  local: LocalPlayer | null;
  unitsCount: number;
  asteroidsCount: number;
  projectilesCount: number;
  playersCount: number;
  now: number;
}

function collectDebugMetrics(d: DebugInputs): DebugMetrics {
  const frameMean = meanOf(d.frameDtSamples);
  // Snapshots/sec: count arrivals in the last 1000ms window.
  const cutoff = d.now - 1000;
  let snapshotsLastSec = 0;
  for (const t of d.snapshotArrivalTimes) {
    if (t >= cutoff) snapshotsLastSec++;
  }
  const offsetMin = d.offsetSamples.length === 0 ? 0 : Math.min(...d.offsetSamples);
  const offsetMax = d.offsetSamples.length === 0 ? 0 : Math.max(...d.offsetSamples);
  return {
    fps: frameMean > 0 ? 1000 / frameMean : 0,
    frameDtMeanMs: frameMean,
    frameDtP99Ms: p99Of(d.frameDtSamples),
    snapshotIntervalMeanMs: meanOf(d.snapshotIntervals),
    snapshotIntervalP99Ms: p99Of(d.snapshotIntervals),
    snapshotsPerSec: snapshotsLastSec,
    serverOffsetMs: d.serverOffset ?? 0,
    rttSpreadMs: offsetMax - offsetMin,
    reconcileDriftU: d.local?.prediction.lastReconcileDrift ?? 0,
    predictionErrorU: d.local?.prediction.errorMagnitude ?? 0,
    pendingInputs: d.local?.prediction.pendingInputCount ?? 0,
    units: d.unitsCount,
    asteroids: d.asteroidsCount,
    projectiles: d.projectilesCount,
    players: d.playersCount,
  };
}
