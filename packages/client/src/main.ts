import { mount, unmount } from "svelte";
import type { Ticker } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@openspace/shared";
import "./hud/theme.css";
import { createRenderer } from "./render/renderer.js";
import { buildGrid, buildSpawnBubble } from "./render/background.js";
import { generateBuildIcons } from "./render/build-icons.js";
import { createInput } from "./input.js";
import { connectToArena } from "./net/client.js";
import { startGame } from "./game.js";
import { hud } from "./hud/hudState.svelte.js";
import { sfx } from "./audio.js";
import Hud from "./hud/Hud.svelte";
import JoinOverlay from "./hud/JoinOverlay.svelte";

const NAME_STORAGE_KEY = "openspace.name";

async function main() {
  const host = document.getElementById("game");
  const hudRoot = document.getElementById("hud-root");
  const joinRoot = document.getElementById("join-root");
  if (!host || !hudRoot || !joinRoot) {
    throw new Error("missing required mount points");
  }

  const renderer = await createRenderer(host);
  buildGrid(renderer.world);
  buildSpawnBubble(renderer.world);
  renderer.world.setChildIndex(renderer.entities, renderer.world.children.length - 1);

  // Snapshot every build-card's in-game art once. Components pull from
  // `hud.buildIcons` when their per-kind canvas becomes available.
  hud.buildIcons = generateBuildIcons(renderer.app);

  const input = createInput(renderer.app);

  // Behind the join screen, drift the camera slowly around the arena so
  // the starfield and grid read as a live backdrop.
  const drift = (t: Ticker) => {
    const s = t.lastTime / 1000;
    renderer.camera.setTarget(
      WORLD_WIDTH / 2 + Math.cos(s * 0.05) * 900,
      WORLD_HEIGHT / 2 + Math.sin(s * 0.05) * 600,
    );
    renderer.camera.apply();
  };
  renderer.app.ticker.add(drift);
  const name = await promptForName(joinRoot);
  renderer.app.ticker.remove(drift);

  const net = await connectToArena({ name }).catch((err) => {
    hud.status = `failed to join: ${(err as Error).message}`;
    throw err;
  });

  // Mount the live HUD now that we have a net handle for the respawn callback.
  mount(Hud, {
    target: hudRoot,
    props: {
      onRespawn: () => net.respawn(),
      onEmote: (kind) => net.emote(kind),
      onPress: (code) => input.press(code),
      onRelease: (code) => input.release(code),
    },
  });

  hud.muted = sfx.muted;
  // Browsers can suspend audio (tab switch, iOS lock); any later gesture
  // resumes it.
  window.addEventListener("pointerdown", () => sfx.unlock());
  window.addEventListener("keydown", () => sfx.unlock());
  startGame({ renderer, input, net });
  console.log("[client] joined as", net.sessionId, "name=", name);
}

/**
 * Mount the JoinOverlay component, await the user's name submission, then
 * tear it down. Resolves with a sanitized name (already trimmed + capped
 * inside the component). Persists in localStorage for the next session.
 */
function promptForName(target: HTMLElement): Promise<string> {
  return new Promise<string>((resolve) => {
    const initialName = localStorage.getItem(NAME_STORAGE_KEY) ?? "";
    const overlay = mount(JoinOverlay, {
      target,
      props: {
        initialName,
        onSubmit(name: string) {
          // Inside the submit gesture: the only moment audio may start.
          sfx.unlock();
          localStorage.setItem(NAME_STORAGE_KEY, name);
          unmount(overlay);
          resolve(name);
        },
      },
    });
  });
}

main().catch((err) => {
  console.error(err);
});
