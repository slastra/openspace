<script lang="ts">
  import { hud } from "./hudState.svelte.js";
  import { onMount } from "svelte";

  let mineralEl: HTMLSpanElement;
  let bumpTimer: number | null = null;

  // Re-fire the gold-pulse animation on every mineral increase. We toggle
  // a class off→on with a forced reflow between, so consecutive bumps each
  // restart the animation instead of merging.
  $effect(() => {
    void hud.mineralBumpToken;
    if (!mineralEl) return;
    mineralEl.classList.remove("bump");
    void mineralEl.offsetWidth;
    mineralEl.classList.add("bump");
    if (bumpTimer !== null) window.clearTimeout(bumpTimer);
    bumpTimer = window.setTimeout(() => mineralEl.classList.remove("bump"), 360);
  });

  onMount(() => () => {
    if (bumpTimer !== null) window.clearTimeout(bumpTimer);
  });
</script>

<div class="stats">
  <div class="row rank">
    <span class="label">Rank</span>
    <span class="value rank">{hud.rank}</span>
  </div>
  <div class="row divider">
    <span class="label">Minerals</span>
    <span class="value mineral" bind:this={mineralEl}>{hud.minerals}</span>
  </div>
  <div class="row">
    <span class="label">HP</span>
    <span class="value">{Math.max(0, Math.round(hud.hp))}/{hud.maxHp}</span>
  </div>
  <div class="row">
    <span class="label">Supply</span>
    <span class="value">{hud.supplyUsed}/{hud.supplyCap}</span>
  </div>
</div>

<style>
  .stats {
    position: absolute;
    top: 14px;
    right: 18px;
    padding: 10px 14px;
    background: rgba(10, 14, 26, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    pointer-events: none;
    user-select: none;
    min-width: 180px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .row + .row {
    margin-top: 4px;
  }
  .label {
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #e2e8f0;
  }
  .row.rank .label {
    color: #cbd5e1;
    font-size: 12px;
  }
  .value.rank {
    font-size: 28px;
    line-height: 1;
    color: #ffffff;
  }
  .row.divider {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .value.mineral {
    color: #facc15;
    font-size: 18px;
    text-shadow: 0 0 6px rgba(250, 204, 21, 0.35);
  }
  .value.mineral:global(.bump) {
    animation: mineralPulse 320ms ease-out;
  }
  @keyframes mineralPulse {
    0% {
      color: #ffffff;
      text-shadow: 0 0 12px rgba(250, 204, 21, 0.9);
    }
    100% {
      color: #facc15;
    }
  }
</style>
