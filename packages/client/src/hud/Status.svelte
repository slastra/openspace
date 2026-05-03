<script lang="ts">
  import { hud } from "./hudState.svelte.js";
</script>

{#if hud.status}
  <div class="status">{hud.status}</div>
{/if}

<style>
  .status {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    background: rgba(10, 14, 26, 0.7);
    border: 1px solid rgba(248, 113, 113, 0.45);
    border-radius: 4px;
    font-size: 12px;
    color: #f87171;
    pointer-events: none;
    user-select: none;
    z-index: 5;
  }
</style>
