import { mount, unmount } from "svelte";
import { createRenderer } from "./render/renderer.js";
import { buildGrid, buildStarfield } from "./render/background.js";
import { generateBuildIcons } from "./render/build-icons.js";
import { createInput } from "./input.js";
import { connectToArena } from "./net/client.js";
import { startGame } from "./game.js";
import { hud } from "./hud/hudState.svelte.js";
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
  buildStarfield(renderer.background);
  buildGrid(renderer.world);
  renderer.world.setChildIndex(renderer.entities, renderer.world.children.length - 1);

  // Snapshot every build-card's in-game art once. Components pull from
  // `hud.buildIcons` when their per-kind canvas becomes available.
  hud.buildIcons = generateBuildIcons(renderer.app);

  const input = createInput(renderer.app);

  const name = await promptForName(joinRoot);

  const net = await connectToArena({ name }).catch((err) => {
    hud.status = `failed to join: ${(err as Error).message}`;
    throw err;
  });

  // Mount the live HUD now that we have a net handle for the respawn callback.
  mount(Hud, {
    target: hudRoot,
    props: { onRespawn: () => net.respawn() },
  });

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
