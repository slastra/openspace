<script lang="ts">
  import { untrack } from "svelte";

  let { initialName = "", onSubmit }: { initialName?: string; onSubmit: (name: string) => void } =
    $props();

  // Capture initialName exactly once at mount — the overlay is created fresh
  // per session, so prop reactivity would never matter here.
  let name = $state(untrack(() => initialName));
  let inputEl: HTMLInputElement;

  $effect(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  function submit(ev: Event) {
    ev.preventDefault();
    const trimmed = name.trim().slice(0, 16);
    onSubmit(trimmed.length > 0 ? trimmed : "Pilot");
  }

  // Static reference card. Two columns: movement/utility on the left,
  // build + spawn keys on the right. Single source of truth for the
  // controls a new player needs before their first match.
  const MOVE_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["Mouse", "Steer"],
    ["Space (hold)", "Recall + dash"],
    ["Right-drag", "Emote wheel"],
    ["X", "Recycle structure"],
    ["Esc", "Cancel placement"],
    ["F1", "Debug overlay"],
  ];
  const SPAWN_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["A", "Rammer"],
    ["S", "Miner"],
    ["D", "Gunner"],
    ["F", "Laser"],
    ["G", "Repair"],
    ["H", "Shielder"],
  ];
  const BUILD_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["Q", "Base (free, max 1)"],
    ["W", "Supply depot"],
    ["E", "Turret"],
    ["R", "Wall"],
    ["T", "Medbay"],
  ];
</script>

<div class="overlay">
  <form class="panel" onsubmit={submit}>
    <div class="title">Pilot Name</div>
    <input
      type="text"
      maxlength="16"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      placeholder="Enter your name"
      bind:value={name}
      bind:this={inputEl}
    />
    <button type="submit">Join</button>

    <div class="controls">
      <div class="col col-pilot">
        <div class="heading">Pilot</div>
        {#each MOVE_KEYS as [k, label] (k)}
          <div class="row">
            <span class="key" class:wide={k.length > 1}>{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
      <div class="col col-build">
        <div class="heading">Build</div>
        {#each BUILD_KEYS as [k, label] (k)}
          <div class="row">
            <span class="key">{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
      <div class="col col-spawn">
        <div class="heading">Spawn</div>
        {#each SPAWN_KEYS as [k, label] (k)}
          <div class="row">
            <span class="key">{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
    </div>
  </form>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 14, 26, 0.55);
    z-index: 10;
  }
  .panel {
    padding: 28px 36px 24px;
    background:
      radial-gradient(120% 80% at 50% 0%, rgba(74, 222, 128, 0.06), transparent 60%),
      rgba(20, 27, 45, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    text-align: center;
    min-width: 580px;
    box-shadow:
      0 24px 72px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(74, 222, 128, 0.08);
  }
  .title {
    font-size: 14px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #cbd5e1;
    margin-bottom: 14px;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    margin-bottom: 12px;
    background: rgba(10, 14, 26, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    color: #ffffff;
    font: inherit;
    font-size: 14px;
  }
  input:focus {
    outline: none;
    border-color: #4ade80;
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
  .controls {
    display: grid;
    grid-template-columns: 1.25fr 1fr 1fr;
    gap: 22px;
    /* Bleed the top border to the panel edges by negating the panel's
     *  horizontal padding (28 36 24). The grid content itself stays
     *  inset via the re-added padding so columns line up with the form
     *  fields above. */
    margin: 24px -36px 0;
    padding: 20px 36px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    text-align: left;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .heading {
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    font-weight: 700;
    color: #94a3b8;
    padding-bottom: 6px;
    margin-bottom: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .col-pilot .heading {
    color: #cbd5e1;
    border-bottom-color: rgba(203, 213, 225, 0.18);
  }
  .col-build .heading {
    color: #fb923c;
    border-bottom-color: rgba(251, 146, 60, 0.28);
  }
  .col-spawn .heading {
    color: #4ade80;
    border-bottom-color: rgba(74, 222, 128, 0.28);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    line-height: 1;
  }
  .key {
    flex: 0 0 auto;
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, #2a3553 0%, #1a2238 100%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-bottom-color: rgba(0, 0, 0, 0.45);
    border-radius: 4px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 1px 0 rgba(0, 0, 0, 0.5),
      0 2px 4px rgba(0, 0, 0, 0.35);
    color: #f1f5f9;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-align: center;
    white-space: nowrap;
  }
  .key.wide {
    min-width: 64px;
  }
  .col-build .key {
    border-color: rgba(251, 146, 60, 0.35);
    border-bottom-color: rgba(0, 0, 0, 0.5);
    box-shadow:
      inset 0 1px 0 rgba(251, 146, 60, 0.18),
      0 1px 0 rgba(0, 0, 0, 0.5),
      0 2px 4px rgba(0, 0, 0, 0.35);
  }
  .col-spawn .key {
    border-color: rgba(74, 222, 128, 0.35);
    border-bottom-color: rgba(0, 0, 0, 0.5);
    box-shadow:
      inset 0 1px 0 rgba(74, 222, 128, 0.18),
      0 1px 0 rgba(0, 0, 0, 0.5),
      0 2px 4px rgba(0, 0, 0, 0.35);
  }
  .label {
    color: #cbd5e1;
    letter-spacing: 0.02em;
  }
</style>
