<script lang="ts">
  import { STRUCTURE_KIND_META, UNIT_KIND_META } from "@openspace/shared";
  import BuildCard from "./BuildCard.svelte";

  /**
   * Hardcoded display order + hotkey labels — driven by what the game.ts
   * key bindings actually do, so renaming a kind here doesn't drift from
   * the input wiring.
   */
  const STRUCTURE_CARDS = [
    { kind: "base", label: "Base", hotkey: "Q" },
    { kind: "supply", label: "Supply", hotkey: "W" },
    { kind: "turret", label: "Turret", hotkey: "E" },
    { kind: "wall", label: "Wall", hotkey: "R" },
    { kind: "medbay", label: "Medbay", hotkey: "T" },
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

<div class="build-hud hud-panel">
  <div class="group">
    <span class="hud-label group-label build">Build</span>
    <div class="cards">
      {#each STRUCTURE_CARDS as c (c.kind)}
        <BuildCard
          kind={c.kind}
          label={c.label}
          hotkey={c.hotkey}
          cost={STRUCTURE_KIND_META[c.kind]?.cost ?? 0}
        />
      {/each}
    </div>
  </div>
  <div class="divider"></div>
  <div class="group">
    <span class="hud-label group-label units">Units</span>
    <div class="cards">
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
</div>

<style>
  .build-hud {
    /* Card size scales down on short or narrow windows so the bar never
     * crowds the ship's formation or the minimap. */
    --card-w: clamp(56px, 4.6vw, 68px);
    --card-h: clamp(66px, 8.4vh, 76px);
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    display: flex;
    align-items: stretch;
    gap: 10px;
    padding: 6px 10px 8px;
    pointer-events: none;
    user-select: none;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .group-label {
    font-size: 9px;
    padding-left: 2px;
  }
  .group-label.build {
    color: var(--build);
  }
  .group-label.units {
    color: var(--accent);
  }
  .cards {
    display: flex;
    gap: 4px;
  }
  .divider {
    width: 1px;
    margin: 18px 0 4px;
    background: linear-gradient(180deg, transparent, rgba(148, 163, 184, 0.3), transparent);
  }
</style>
