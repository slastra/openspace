<script lang="ts">
  import { hud, type BlockReason } from "./hudState.svelte.js";

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
    canvas.style.width = "32px";
    canvas.style.height = "32px";
    iconHost.replaceChildren(canvas);
    installed = true;
  });

  const REASON_TEXT: Record<Exclude<BlockReason, "credits">, string> = {
    base: "No base",
    limit: "Built",
    supply: "No supply",
  };

  let count = $derived(hud.unitCounts[kind] ?? 0);
  let reason = $derived<BlockReason | undefined>(hud.blocked[kind]);
  let placing = $derived(hud.placing === kind);
</script>

<div class="card" class:blocked={reason !== undefined} class:placing>
  <span class="keycap">{hotkey}</span>
  <span class="cost" class:short={reason === "credits"}>{cost}</span>
  <div class="icon" bind:this={iconHost}></div>
  {#if count > 0}<span class="count">{count}</span>{/if}
  {#if reason && reason !== "credits"}
    <div class="footer reason reason-{reason}">{REASON_TEXT[reason]}</div>
  {:else}
    <div class="footer name">{label}</div>
  {/if}
</div>

<style>
  .card {
    position: relative;
    width: var(--card-w);
    height: var(--card-h);
    box-sizing: border-box;
    background: linear-gradient(180deg, rgba(30, 41, 66, 0.9) 0%, rgba(15, 21, 37, 0.92) 100%);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }
  .card.placing {
    border-color: var(--accent);
    box-shadow:
      inset 0 0 12px rgba(74, 222, 128, 0.18),
      0 0 14px rgba(74, 222, 128, 0.35);
    transform: translateY(-3px);
  }
  .keycap {
    position: absolute;
    top: 5px;
    left: 5px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
  }
  .count {
    position: absolute;
    left: calc(50% + 8px);
    top: calc(50% + 2px);
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: #14532d;
    border: 1px solid rgba(74, 222, 128, 0.5);
    color: var(--accent-hi);
    font-family: var(--font-num);
    font-size: 9px;
    font-weight: 700;
  }
  .icon {
    position: absolute;
    left: 50%;
    top: calc(50% - 16px);
    width: 32px;
    height: 32px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 120ms ease;
  }
  .card.blocked .icon {
    opacity: 0.35;
  }
  .card.blocked .keycap {
    opacity: 0.55;
  }
  .footer {
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 5px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .name {
    color: var(--text-dim);
  }
  .cost {
    position: absolute;
    top: 6px;
    right: 6px;
    font-family: var(--font-num);
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    color: var(--mineral);
  }
  .cost::before {
    content: "";
    display: inline-block;
    width: 5px;
    height: 6px;
    margin-right: 2px;
    background: currentColor;
    clip-path: polygon(50% 0, 100% 35%, 80% 100%, 20% 100%, 0 35%);
  }
  .cost.short {
    color: var(--danger);
  }
  .reason {
    color: var(--text-faint);
  }
  .reason-base,
  .reason-supply {
    color: var(--warn);
  }
</style>
