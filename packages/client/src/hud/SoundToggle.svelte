<script lang="ts">
  import { sfx } from "../audio.js";
  import { hud } from "./hudState.svelte.js";

  function toggle(ev: PointerEvent) {
    ev.preventDefault();
    sfx.unlock();
    hud.muted = sfx.toggleMute();
  }
</script>

<button
  type="button"
  class="sound hud-panel"
  class:muted={hud.muted}
  aria-label={hud.muted ? "Unmute sound (M)" : "Mute sound (M)"}
  title={hud.muted ? "Unmute (M)" : "Mute (M)"}
  onpointerdown={toggle}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    {#if hud.muted}
      <path class="stroke" d="M16 9l5 6M21 9l-5 6" />
    {:else}
      <path class="stroke" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    {/if}
  </svg>
</button>

<style>
  .sound {
    position: absolute;
    top: calc(var(--gutter-top) + 216px);
    right: var(--gutter-x);
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    color: var(--text);
    touch-action: none;
  }
  .sound:hover {
    color: var(--text-strong);
  }
  .sound.muted {
    color: var(--text-faint);
  }
  svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  .stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  @media (max-width: 719px), (max-height: 500px) {
    .sound {
      top: calc(var(--gutter-top) + 146px);
      width: 32px;
      height: 32px;
    }
  }
</style>
