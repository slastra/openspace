<script lang="ts">
  import { hud } from "./hudState.svelte.js";
  import { parseHexColor } from "../render/colors.js";

  function tint(hex: string): string {
    return `#${parseHexColor(hex).toString(16).padStart(6, "0")}`;
  }
</script>

<div class="player-list hud-panel">
  <div class="hud-label heading">Pilots <span class="n">{hud.players.length}</span></div>
  {#each hud.players as p, i (p.id)}
    <div
      class="row"
      class:self={p.isLocal}
      class:dead={p.isDead}
      style:color={tint(p.color)}
    >
      <span class="pos">{i + 1}</span>
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
    padding: 10px 10px 8px;
    pointer-events: none;
    user-select: none;
    width: 210px;
    box-sizing: border-box;
  }
  .heading {
    display: flex;
    justify-content: space-between;
    padding: 0 4px 6px;
  }
  .n {
    font-family: var(--font-num);
    letter-spacing: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 22px;
    padding: 0 6px 0 4px;
    border-radius: 4px;
    border-left: 2px solid transparent;
  }
  .row.self {
    background: rgba(255, 255, 255, 0.06);
    border-left-color: currentColor;
  }
  .row.dead .name,
  .row.dead .rank,
  .row.dead .swatch {
    opacity: 0.4;
  }
  .pos {
    width: 1.6ch;
    font-family: var(--font-num);
    font-size: 10px;
    color: var(--text-faint);
    text-align: right;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    transform: rotate(45deg);
    flex-shrink: 0;
    box-shadow: 0 0 6px currentColor;
  }
  .name {
    flex: 1;
    font-family: var(--font-ui);
    font-weight: 500;
    font-size: 13px;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rank {
    font-family: var(--font-num);
    font-size: 12px;
    font-weight: 700;
    color: var(--text-strong);
    min-width: 2ch;
    text-align: right;
  }
  .dead-mark {
    font-size: 10px;
    color: var(--danger);
  }
</style>
