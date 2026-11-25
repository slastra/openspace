<script lang="ts">
  import { untrack } from "svelte";
  import { isTouch } from "./device.js";

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
    ["Click", "Focus a target"],
    ["Hold Space", "Recall + dash"],
    ["Right-drag", "Emote wheel"],
    ["X", "Recycle structure"],
    ["Esc", "Cancel placement"],
    ["Wheel", "Zoom"],
    ["M", "Mute sound"],
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
  const TOUCH_CONTROLS: ReadonlyArray<readonly [string, string]> = [
    ["Hold", "Touch and hold anywhere to steer toward your finger"],
    ["Tap", "Tap an enemy or asteroid to focus your drones on it"],
    ["Pinch", "Zoom in and out"],
    ["Cards", "Tap a building, then tap or drag-and-lift to place it. Hold a unit card to keep spawning."],
    ["Dash", "Hold to recall your drones and boost"],
  ];
  const BUILD_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["Q", "Base (free, max 1)"],
    ["W", "Supply depot"],
    ["E", "Turret"],
    ["R", "Wall"],
    ["T", "Medbay"],
  ];
</script>

<div class="scrim join">
  <form class="modal panel" onsubmit={submit}>
    <div class="brand">
      <h1 class="wordmark">open<span>space</span></h1>
      <p class="tagline">Build a base. Grow a swarm. Take the arena.</p>
    </div>

    <label class="hud-label field-label" for="pilot-name">Pilot name</label>
    <div class="join-row">
      <input
        id="pilot-name"
        type="text"
        maxlength="16"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="Pilot"
        bind:value={name}
        bind:this={inputEl}
      />
      <button type="submit" class="btn btn-primary">Launch <span class="keycap">↵</span></button>
    </div>

    {#if isTouch}
      <div class="touch-help">
        {#each TOUCH_CONTROLS as [k, label] (k)}
          <div class="touch-row">
            <span class="keycap wide">{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
    {:else}
    <div class="controls">
      <div class="col col-pilot">
        <div class="hud-label heading">Pilot</div>
        {#each MOVE_KEYS as [k, label] (k)}
          <div class="row">
            <span class="keycap" class:wide={k.length > 1}>{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
      <div class="col col-build">
        <div class="hud-label heading">Build</div>
        {#each BUILD_KEYS as [k, label] (k)}
          <div class="row">
            <span class="keycap">{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
      <div class="col col-spawn">
        <div class="hud-label heading">Spawn</div>
        {#each SPAWN_KEYS as [k, label] (k)}
          <div class="row">
            <span class="keycap">{k}</span>
            <span class="label">{label}</span>
          </div>
        {/each}
      </div>
    </div>
    {/if}
    <p class="hint">Place a base first, then hold a spawn key to grow your swarm.</p>
  </form>
</div>

<style>
  .join {
    background: radial-gradient(ellipse at center, rgba(10, 14, 26, 0.15) 0%, rgba(10, 14, 26, 0.7) 100%);
    /* Short screens (landscape phones): scroll instead of clipping. */
    overflow-y: auto;
    align-items: safe center;
    padding: 16px 0;
    box-sizing: border-box;
    touch-action: pan-y;
  }
  .touch-help {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 22px -36px 0;
    padding: 18px 36px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  .touch-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .panel {
    padding: 30px 36px 22px;
    width: min(620px, calc(100vw - 32px));
    box-sizing: border-box;
  }
  .brand {
    text-align: center;
    margin-bottom: 26px;
  }
  .wordmark {
    margin: 0;
    font-family: var(--font-ui);
    font-weight: 700;
    font-size: clamp(30px, 9vw, 44px);
    line-height: 1;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--text-strong);
    /* Letter-spacing pads the right edge; pull it back so the word centers. */
    margin-right: -0.22em;
    text-shadow: 0 0 24px rgba(148, 163, 184, 0.25);
  }
  .wordmark span {
    color: var(--accent);
    text-shadow: 0 0 22px rgba(74, 222, 128, 0.55);
  }
  .tagline {
    margin: 10px 0 0;
    font-family: var(--font-ui);
    font-size: 14px;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .field-label {
    display: block;
    margin-bottom: 6px;
  }
  .join-row {
    display: flex;
    gap: 10px;
  }
  input {
    -webkit-user-select: text;
    user-select: text;
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
    background: var(--inset-bg);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 6px;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-weight: 500;
    font-size: 16px;
    letter-spacing: 0.04em;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.15);
  }
  .controls {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr;
    gap: 22px;
    margin: 26px -36px 0;
    padding: 20px 36px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    text-align: left;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .heading {
    padding-bottom: 6px;
    margin-bottom: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .col-pilot .heading {
    color: var(--text);
  }
  .col-build .heading {
    color: var(--build);
    border-bottom-color: rgba(251, 146, 60, 0.28);
  }
  .col-spawn .heading {
    color: var(--accent);
    border-bottom-color: rgba(74, 222, 128, 0.28);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .keycap {
    min-width: 22px;
    height: 22px;
  }
  .keycap.wide {
    min-width: 72px;
  }
  .col-build .keycap {
    border-color: rgba(251, 146, 60, 0.4);
  }
  .col-spawn .keycap {
    border-color: rgba(74, 222, 128, 0.4);
  }
  .label {
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--text);
  }
  .hint {
    margin: 18px 0 0;
    text-align: center;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--text-faint);
  }
  @media (max-width: 640px) {
    .panel {
      padding: 22px 20px 18px;
    }
    .controls,
    .touch-help {
      margin-left: -20px;
      margin-right: -20px;
      padding-left: 20px;
      padding-right: 20px;
    }
    .controls {
      grid-template-columns: 1fr 1fr;
    }
    .col-pilot {
      grid-column: 1 / -1;
    }
    .tagline {
      font-size: 13px;
    }
  }
</style>
