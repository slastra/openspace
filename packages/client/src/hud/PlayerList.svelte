<script lang="ts">
  import { hud } from "./hudState.svelte.js";
  import { parseHexColor } from "../render/colors.js";

  function tint(hex: string): string {
    return `#${parseHexColor(hex).toString(16).padStart(6, "0")}`;
  }
</script>

<div class="player-list">
  <div class="heading">Players</div>
  {#each hud.players as p (p.id)}
    <div
      class="row"
      class:self={p.isLocal}
      class:dead={p.isDead}
      style:color={tint(p.color)}
    >
      <span class="swatch" style:background={tint(p.color)}></span>
      <span class="name">{p.name}</span>
      <span class="rank">{p.rank}</span>
      {#if p.isDead}
        <span class="dead-mark">✕</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .player-list {
    position: absolute;
    top: 14px;
    left: 18px;
    padding: 8px 10px;
    background: rgba(10, 14, 26, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    pointer-events: none;
    user-select: none;
    min-width: 200px;
  }
  .heading {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    border-radius: 3px;
  }
  .row.self {
    background: rgba(255, 255, 255, 0.06);
    border-left: 2px solid currentColor;
    padding-left: 2px;
  }
  .row.dead .name,
  .row.dead .rank,
  .row.dead .swatch {
    opacity: 0.4;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    font-size: 12px;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rank {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    color: #ffffff;
    min-width: 2ch;
    text-align: right;
  }
  .dead-mark {
    font-size: 10px;
    color: #f87171;
    margin-left: 4px;
  }
</style>
