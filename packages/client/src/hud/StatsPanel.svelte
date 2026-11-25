<script lang="ts">
  import { hud } from "./hudState.svelte.js";
  import { onMount } from "svelte";

  let mineralEl: HTMLSpanElement;
  let hpEl: HTMLDivElement;
  let bumpTimer: number | null = null;
  let hitTimer: number | null = null;
  let lastHp = 0;

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

  // Same trick for the hull bar: flash red whenever HP drops.
  $effect(() => {
    const hp = hud.hp;
    const dropped = hp < lastHp && hp > 0;
    lastHp = hp;
    if (!dropped || !hpEl) return;
    hpEl.classList.remove("hit");
    void hpEl.offsetWidth;
    hpEl.classList.add("hit");
    if (hitTimer !== null) window.clearTimeout(hitTimer);
    hitTimer = window.setTimeout(() => hpEl.classList.remove("hit"), 420);
  });

  onMount(() => () => {
    if (bumpTimer !== null) window.clearTimeout(bumpTimer);
    if (hitTimer !== null) window.clearTimeout(hitTimer);
  });

  const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) * 100 : 0);

  let hpPct = $derived(pct(hud.hp, hud.maxHp));
  let shieldPct = $derived(pct(hud.shield, hud.maxShield));
  let supplyPct = $derived(pct(hud.supplyUsed, hud.supplyCap));
  let supplyState = $derived(
    hud.supplyCap > 0 && hud.supplyUsed >= hud.supplyCap ? "full" : supplyPct >= 90 ? "high" : "ok",
  );
  let place = $derived(hud.players.findIndex((p) => p.isLocal) + 1);
</script>

<div class="stats hud-panel">
  <div class="top">
    <div class="place">
      <span class="hud-label">Rank</span>
      <span class="place-value">
        {#if place > 0}#{place}<span class="of">/{hud.players.length}</span>{:else}–{/if}
      </span>
    </div>
    <div class="fleet">
      <span class="hud-label">Fleet</span>
      <span class="fleet-value">{hud.fleetSize}</span>
    </div>
  </div>

  <div class="minerals">
    <svg class="crystal" viewBox="0 0 12 14" aria-hidden="true">
      <path d="M6 0 L12 4.5 L9.5 14 L2.5 14 L0 4.5 Z" />
      <path class="facet" d="M6 0 L8 4.5 L6 14 L4 4.5 Z" />
    </svg>
    <span class="mineral-value" bind:this={mineralEl}>{hud.minerals.toLocaleString("en-US")}</span>
  </div>

  <div class="meter">
    <div class="meter-head">
      <span class="hud-label">Hull</span>
      <span class="num">
        {Math.max(0, Math.round(hud.hp))}<span class="dim">/{hud.maxHp}</span>
        {#if hud.maxShield > 0}<span class="shield-num"> +{Math.round(hud.shield)}</span>{/if}
      </span>
    </div>
    <div class="track" bind:this={hpEl}>
      <div
        class="fill hp"
        class:warn={hpPct <= 50}
        class:crit={hpPct <= 25}
        style:width="{hpPct}%"
      ></div>
      {#if hud.maxShield > 0}
        <div class="fill shield" style:width="{shieldPct}%"></div>
      {/if}
    </div>
  </div>

  <div class="meter">
    <div class="meter-head">
      <span class="hud-label">Supply</span>
      <span class="num">{hud.supplyUsed}<span class="dim">/{hud.supplyCap}</span></span>
    </div>
    <div class="track thin">
      <div class="fill supply {supplyState}" style:width="{supplyPct}%"></div>
    </div>
  </div>
</div>

<style>
  .stats {
    position: absolute;
    top: 14px;
    right: 18px;
    width: 208px;
    padding: 12px 14px 14px;
    box-sizing: border-box;
    pointer-events: none;
    user-select: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .place,
  .fleet {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fleet {
    align-items: flex-end;
  }
  .place-value {
    font-family: var(--font-num);
    font-weight: 700;
    font-size: 26px;
    line-height: 1;
    color: var(--text-strong);
  }
  .of {
    font-size: 13px;
    color: var(--text-faint);
    margin-left: 2px;
  }
  .fleet-value {
    font-family: var(--font-num);
    font-weight: 700;
    font-size: 26px;
    line-height: 1;
    color: var(--accent);
  }
  .minerals {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    background: var(--inset-bg);
    border: 1px solid rgba(250, 204, 21, 0.18);
    border-radius: 6px;
  }
  .crystal {
    width: 12px;
    height: 14px;
    fill: var(--mineral);
    filter: drop-shadow(0 0 4px rgba(250, 204, 21, 0.5));
  }
  .crystal .facet {
    fill: #fde68a;
  }
  .mineral-value {
    font-family: var(--font-num);
    font-weight: 700;
    font-size: 18px;
    color: var(--mineral);
    text-shadow: 0 0 8px rgba(250, 204, 21, 0.3);
    font-variant-numeric: tabular-nums;
  }
  .mineral-value:global(.bump) {
    animation: mineral-pulse 320ms ease-out;
  }
  @keyframes mineral-pulse {
    0% {
      color: #ffffff;
      text-shadow: 0 0 14px rgba(250, 204, 21, 0.95);
    }
  }
  .meter {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .meter-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .num {
    font-family: var(--font-num);
    font-size: 12px;
    font-weight: 700;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
  }
  .dim {
    color: var(--text-faint);
    font-weight: 500;
  }
  .shield-num {
    color: var(--shield);
  }
  .track {
    position: relative;
    height: 8px;
    background: var(--inset-bg);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
  }
  .track.thin {
    height: 5px;
  }
  .track:global(.hit) {
    animation: hull-hit 420ms ease-out;
  }
  @keyframes hull-hit {
    0% {
      border-color: var(--danger);
      box-shadow: 0 0 10px rgba(248, 113, 113, 0.7);
    }
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: 3px;
    transition: width 180ms ease-out;
  }
  .fill.hp {
    background: linear-gradient(90deg, #22c55e, var(--accent));
  }
  .fill.hp.warn {
    background: linear-gradient(90deg, #eab308, var(--warn));
  }
  .fill.hp.crit {
    background: linear-gradient(90deg, #dc2626, var(--danger));
  }
  .fill.shield {
    top: auto;
    height: 3px;
    background: var(--shield);
    box-shadow: 0 0 6px var(--shield);
  }
  .fill.supply {
    background: #64748b;
  }
  .fill.supply.high {
    background: var(--warn);
  }
  .fill.supply.full {
    background: var(--danger);
  }
</style>
