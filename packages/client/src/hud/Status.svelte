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
    top: var(--gutter-top);
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 16px;
    background: var(--panel-bg);
    border-radius: 6px;
    box-shadow: var(--panel-shadow);
    font-family: var(--font-ui);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    pointer-events: none;
    user-select: none;
    z-index: 5;
  }
  .status {
    border: 1px solid rgba(248, 113, 113, 0.5);
    color: var(--danger);
  }
  .mode {
    border: 1px solid rgba(250, 204, 21, 0.55);
    color: #fde68a;
    /* Shift down if both banners are visible. */
    margin-top: 36px;
  }
  @media (max-width: 719px) {
    /* Left column under the player list, clear of the minimap. */
    .banner {
      top: calc(var(--gutter-top) + 126px);
      left: var(--gutter-x);
      transform: none;
      width: max-content;
      max-width: calc(100vw - 2 * var(--gutter-x) - 120px);
      box-sizing: border-box;
      white-space: normal;
      text-align: left;
      font-size: 11px;
    }
  }
</style>
