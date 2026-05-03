<script lang="ts">
  import { hud } from "./hudState.svelte.js";

  let {
    kind,
    label,
    hotkey,
    cost,
  }: { kind: string; label: string; hotkey: string; cost: number } = $props();

  let iconHost: HTMLDivElement;
  let installed = false;

  // The build-card art is a Pixi-extracted canvas keyed by kind. Inject it
  // into our slot once it's available; the canvas is created at startup.
  $effect(() => {
    if (installed || !iconHost) return;
    const canvas = hud.buildIcons.get(kind);
    if (!canvas) return;
    canvas.style.width = "36px";
    canvas.style.height = "36px";
    iconHost.replaceChildren(canvas);
    installed = true;
  });

  let count = $derived(hud.unitCounts[kind] ?? 0);
  let unaffordable = $derived(!(hud.affordable[kind] ?? false));
  let placing = $derived(hud.placing === kind);
</script>

<div class="card" class:unaffordable class:placing>
  <span class="hotkey">{hotkey}</span>
  <span class="cost">{cost}</span>
  <div class="icon" bind:this={iconHost}></div>
  <div class="footer">
    <span class="name">{label}</span>
    <span class="count">{count}</span>
  </div>
</div>

<style>
  .card {
    position: relative;
    width: 84px;
    height: 90px;
    background: rgba(20, 27, 45, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    transition: border-color 120ms ease, opacity 120ms ease;
  }
  .card.unaffordable {
    opacity: 0.45;
  }
  .card.placing {
    border-color: #4ade80;
    box-shadow: 0 0 10px rgba(74, 222, 128, 0.4);
  }
  .hotkey {
    position: absolute;
    top: 4px;
    left: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border: 1px solid rgba(184, 192, 210, 0.45);
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
    color: #cbd5e1;
    background: rgba(10, 14, 26, 0.6);
  }
  .cost {
    position: absolute;
    top: 4px;
    right: 6px;
    font-size: 11px;
    color: #facc15;
    font-variant-numeric: tabular-nums;
  }
  .icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .footer {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 6px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .name {
    color: #94a3b8;
  }
  .count {
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }
</style>
