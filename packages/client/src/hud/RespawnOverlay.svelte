<script lang="ts">
  import { hud } from "./hudState.svelte.js";

  let { onRespawn }: { onRespawn: () => void } = $props();
</script>

{#if hud.isDead}
  <div class="overlay">
    <div class="panel">
      <div class="death-msg">You were destroyed</div>
      <button type="button" onclick={onRespawn}>Respawn</button>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 14, 26, 0.35);
    z-index: 10;
  }
  .panel {
    padding: 24px 32px;
    background: rgba(20, 27, 45, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    text-align: center;
    min-width: 280px;
  }
  .death-msg {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #f87171;
    margin-bottom: 14px;
  }
  button {
    display: inline-block;
    padding: 10px 24px;
    background: #4ade80;
    border: none;
    border-radius: 4px;
    color: #0a0e1a;
    font: inherit;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 120ms ease;
  }
  button:hover {
    background: #6ee7a0;
  }
</style>
