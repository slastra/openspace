<script lang="ts">
  import { STRUCTURE_KIND_META, UNIT_KIND_META } from "@openspace/shared";
  import BuildCard from "./BuildCard.svelte";

  /**
   * Hardcoded display order + hotkey labels — driven by what the game.ts
   * key bindings actually do, so renaming a kind here doesn't drift from
   * the input wiring.
   */
  const STRUCTURE_CARDS = [
    { kind: "supply", label: "Supply", hotkey: "Q" },
    { kind: "turret", label: "Turret", hotkey: "W" },
  ];
  const UNIT_CARDS = [
    { kind: "rammer", label: "Rammer", hotkey: "A" },
    { kind: "miner", label: "Miner", hotkey: "S" },
    { kind: "gunner", label: "Gunner", hotkey: "D" },
    { kind: "laser", label: "Laser", hotkey: "F" },
    { kind: "repair", label: "Repair", hotkey: "G" },
    { kind: "shielder", label: "Shield", hotkey: "H" },
  ];
</script>

<div class="build-hud">
  <div class="row">
    <span class="row-label">Build</span>
    {#each STRUCTURE_CARDS as c (c.kind)}
      <BuildCard
        kind={c.kind}
        label={c.label}
        hotkey={c.hotkey}
        cost={STRUCTURE_KIND_META[c.kind]?.cost ?? 0}
      />
    {/each}
  </div>
  <div class="row">
    <span class="row-label">Units</span>
    {#each UNIT_CARDS as c (c.kind)}
      <BuildCard
        kind={c.kind}
        label={c.label}
        hotkey={c.hotkey}
        cost={UNIT_KIND_META[c.kind]?.cost ?? 0}
      />
    {/each}
  </div>
</div>

<style>
  .build-hud {
    position: absolute;
    left: 18px;
    bottom: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: rgba(10, 14, 26, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    pointer-events: none;
    user-select: none;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .row-label {
    align-self: center;
    width: 64px;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #64748b;
    padding-left: 4px;
  }
</style>
