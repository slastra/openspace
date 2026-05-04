<script lang="ts">
  import { hud } from "./hudState.svelte.js";
</script>

{#if hud.status}
  <div class="banner status">{hud.status}</div>
{/if}
{#if hud.modeHint}
  <div class="banner mode">{hud.modeHint}</div>
{/if}

<style>
  .banner {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    background: rgba(10, 14, 26, 0.7);
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    user-select: none;
    z-index: 5;
    letter-spacing: 0.08em;
  }
  .status {
    border: 1px solid rgba(248, 113, 113, 0.45);
    color: #f87171;
  }
  .mode {
    border: 1px solid rgba(250, 204, 21, 0.55);
    color: #fde68a;
    /* Shift down if both banners are visible. */
    margin-top: 36px;
  }
</style>
