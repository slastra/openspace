<script lang="ts">
  import { WRECKAGE_LIFETIME_MS } from "@openspace/shared";
  import { hud } from "./hudState.svelte.js";

  let { onRespawn }: { onRespawn: () => void } = $props();

  let now = $state(performance.now());

  // While dead: tick the wreck countdown and accept Enter/Space to respawn.
  $effect(() => {
    if (!hud.isDead) return;
    now = performance.now();
    const timer = window.setInterval(() => (now = performance.now()), 250);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      if (ev.code === "Enter" || ev.code === "Space") {
        ev.preventDefault();
        onRespawn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  });

  let wreckSecondsLeft = $derived(
    Math.max(0, Math.ceil((WRECKAGE_LIFETIME_MS - (now - hud.diedAt)) / 1000)),
  );
</script>

{#if hud.isDead}
  <div class="scrim death">
    <div class="modal panel">
      <div class="kicker">Ship destroyed</div>
      {#if hud.killedBy}
        <div class="by">
          by <span class="killer" style:color={hud.killedBy.color}>{hud.killedBy.name}</span>
        </div>
      {/if}
      {#if hud.wreckCredits > 0 && wreckSecondsLeft > 0}
        <p class="wreck">
          Your wreck holds <span class="minerals">{hud.wreckCredits.toLocaleString("en-US")}</span>
          minerals and any surviving drones. Fly back within
          <span class="secs">{wreckSecondsLeft}s</span> to reclaim it.
        </p>
      {:else}
        <p class="wreck">Respawn at the center of the arena.</p>
      {/if}
      <button type="button" class="btn btn-primary" onclick={onRespawn}>
        Respawn <span class="keycap">↵</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .death {
    background: radial-gradient(ellipse at center, rgba(40, 6, 10, 0.2) 0%, rgba(20, 4, 8, 0.72) 100%);
  }
  .panel {
    padding: 26px 34px 24px;
    width: min(380px, calc(100vw - 32px));
    box-sizing: border-box;
    text-align: center;
    border-color: rgba(248, 113, 113, 0.3);
  }
  .kicker {
    font-family: var(--font-ui);
    font-weight: 700;
    font-size: 20px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--danger);
    text-shadow: 0 0 18px rgba(248, 113, 113, 0.45);
  }
  .by {
    margin-top: 6px;
    font-family: var(--font-ui);
    font-size: 14px;
    color: var(--text-dim);
  }
  .killer {
    font-weight: 700;
  }
  .wreck {
    margin: 16px 0 20px;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
  }
  .minerals {
    font-family: var(--font-num);
    font-weight: 700;
    color: var(--mineral);
  }
  .secs {
    font-family: var(--font-num);
    font-weight: 700;
    color: var(--text-strong);
  }
</style>
