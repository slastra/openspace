<script lang="ts">
  import { hud } from "./hudState.svelte.js";
</script>

{#if hud.hint}
  {#key hud.hint}
    <div class="hint">
      <span class="dot"></span>
      <span>{hud.hint}</span>
    </div>
  {/key}
{/if}

<style>
  .hint {
    position: absolute;
    left: 50%;
    bottom: calc(var(--build-bar-h, 112px) + 26px);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(560px, calc(100vw - 32px));
    padding: 9px 16px;
    background: var(--panel-bg);
    border: 1px solid rgba(74, 222, 128, 0.4);
    border-radius: 8px;
    box-shadow:
      var(--panel-shadow),
      0 0 18px rgba(74, 222, 128, 0.12);
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 500;
    color: var(--text-strong);
    pointer-events: none;
    user-select: none;
    animation: hint-in 260ms ease-out;
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
    animation: blink 1.4s ease-in-out infinite;
  }
  @keyframes hint-in {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }
  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }
</style>
