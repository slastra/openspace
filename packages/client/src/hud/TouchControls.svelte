<script lang="ts">
  import { hud } from "./hudState.svelte.js";

  let { onPress, onRelease }: { onPress: (code: string) => void; onRelease: (code: string) => void } =
    $props();

  // Each button drives the same key path as the keyboard (see input.ts).
  function hold(code: string) {
    return {
      down(ev: PointerEvent) {
        ev.preventDefault();
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
        onPress(code);
      },
      up() {
        onRelease(code);
      },
    };
  }
  const dash = hold("Space");
  function tap(code: string) {
    return (ev: PointerEvent) => {
      ev.preventDefault();
      onPress(code);
      onRelease(code);
    };
  }
  function openEmotes(ev: PointerEvent) {
    ev.preventDefault();
    hud.emoteMenu = { x: window.innerWidth / 2, y: window.innerHeight / 2, tap: true };
  }
</script>

<div class="touch-controls">
  {#if hud.inMode}
    <button type="button" class="btn-round cancel" onpointerdown={tap("Escape")} aria-label="Cancel">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      <span>Cancel</span>
    </button>
  {/if}
  <button
    type="button"
    class="btn-round dash"
    onpointerdown={dash.down}
    onpointerup={dash.up}
    onpointercancel={dash.up}
    onlostpointercapture={dash.up}
    aria-label="Recall and dash (hold)"
  >
    <svg viewBox="0 0 24 24"><path d="M5 12h9M10 7l5 5-5 5M17 7l5 5-5 5" /></svg>
    <span>Dash</span>
  </button>
  <button type="button" class="btn-round" onpointerdown={tap("KeyX")} aria-label="Recycle a structure">
    <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4" /></svg>
    <span>Recycle</span>
  </button>
  <button type="button" class="btn-round" onpointerdown={openEmotes} aria-label="Emote">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M9 14.5a4 4 0 0 0 6 0M9 10h.01M15 10h.01" /></svg>
    <span>Emote</span>
  </button>
</div>

<style>
  .touch-controls {
    position: absolute;
    left: var(--gutter-x);
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .btn-round {
    width: 52px;
    height: 52px;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 50%;
    box-shadow: var(--panel-shadow);
    color: var(--text);
    touch-action: none;
  }
  .btn-round:active {
    border-color: var(--accent);
    color: var(--accent-hi);
    box-shadow:
      var(--panel-shadow),
      0 0 14px rgba(74, 222, 128, 0.35);
  }
  .btn-round.dash {
    width: 60px;
    height: 60px;
    border-color: rgba(74, 222, 128, 0.45);
    color: var(--accent-hi);
  }
  .btn-round.cancel {
    border-color: rgba(248, 113, 113, 0.55);
    color: var(--danger);
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  span {
    font-family: var(--font-ui);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
