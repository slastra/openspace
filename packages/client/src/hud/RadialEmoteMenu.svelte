<script lang="ts">
  import { EMOTE_KINDS, type EmoteKind } from "@openspace/shared";
  import { hud } from "./hudState.svelte.js";

  let { onEmote }: { onEmote: (kind: EmoteKind) => void } = $props();

  // Visual + label per emote. Keep this client-side — server only ships
  // the enum kind.
  const EMOTE_PRESENTATION: Record<EmoteKind, { glyph: string; label: string }> = {
    greet: { glyph: "👋", label: "Greet" },
    help: { glyph: "⚠️", label: "Help" },
    attack: { glyph: "⚔️", label: "Attack" },
    truce: { glyph: "🤝", label: "Truce" },
    thanks: { glyph: "👍", label: "Thanks" },
    love: { glyph: "❤️", label: "Love" },
    laugh: { glyph: "😂", label: "Laugh" },
    cry: { glyph: "😢", label: "Cry" },
    rip: { glyph: "💀", label: "RIP" },
  };

  const RADIUS = 80;
  const WEDGE_RADIUS = 26;
  /** Cursor must move at least this far from origin to count as a
   *  selection. Releasing inside the dead zone closes the menu without
   *  sending — matches "right-tap to cancel" muscle memory. */
  const DEAD_ZONE = 18;

  let cursorX = $state(0);
  let cursorY = $state(0);

  let selected = $derived.by<EmoteKind | null>(() => {
    if (!hud.emoteMenu) return null;
    const dx = cursorX - hud.emoteMenu.x;
    const dy = cursorY - hud.emoteMenu.y;
    const dist = Math.hypot(dx, dy);
    if (dist < DEAD_ZONE) return null;
    // -π/2 offset puts wedge 0 (Greet) at the top.
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const idx = Math.floor((angle / (Math.PI * 2)) * EMOTE_KINDS.length);
    return EMOTE_KINDS[idx % EMOTE_KINDS.length] ?? null;
  });

  $effect(() => {
    if (!hud.emoteMenu) return;
    cursorX = hud.emoteMenu.x;
    cursorY = hud.emoteMenu.y;
    const onMove = (ev: PointerEvent) => {
      cursorX = ev.clientX;
      cursorY = ev.clientY;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 2) return;
      // Capture selected at release time (Svelte derived may not be
      // fully settled across event loops, but reading hud.emoteMenu is
      // safe — clear AFTER reading the selection).
      const pick = selected;
      hud.emoteMenu = null;
      if (pick) onEmote(pick);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  function wedgePos(idx: number): { x: number; y: number } {
    // Same -π/2 offset so wedge 0 appears at top.
    const angle = (idx / EMOTE_KINDS.length) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * RADIUS, y: Math.sin(angle) * RADIUS };
  }
</script>

{#if hud.emoteMenu}
  <div
    class="radial"
    style="left: {hud.emoteMenu.x}px; top: {hud.emoteMenu.y}px"
  >
    <div class="center" class:armed={selected !== null}></div>
    {#each EMOTE_KINDS as kind, i (kind)}
      {@const pos = wedgePos(i)}
      {@const pres = EMOTE_PRESENTATION[kind]}
      <div
        class="wedge"
        class:hot={selected === kind}
        style="transform: translate({pos.x - WEDGE_RADIUS}px, {pos.y - WEDGE_RADIUS}px)"
        title={pres.label}
      >
        <span class="glyph">{pres.glyph}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .radial {
    position: fixed;
    pointer-events: none;
    user-select: none;
    z-index: 50;
  }
  .center {
    position: absolute;
    left: -6px;
    top: -6px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    transition: background 80ms;
  }
  .center.armed {
    background: rgba(255, 255, 255, 0.85);
  }
  .wedge {
    position: absolute;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(10, 14, 26, 0.85);
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 80ms ease, background 80ms, border-color 80ms;
  }
  .wedge.hot {
    background: rgba(40, 60, 100, 0.95);
    border-color: rgba(255, 255, 255, 0.7);
  }
  .glyph {
    font-size: 24px;
  }
</style>
