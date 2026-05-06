<script lang="ts">
  import { hud, FEED_TTL_MS } from "./hudState.svelte.js";

  // Map emote ids to display glyphs. Kept here (not in shared) so the
  // visual choice is a client concern; server only ships the enum kind.
  const EMOTE_GLYPHS: Record<string, string> = {
    greet: "👋",
    help: "⚠️",
    attack: "⚔️",
    truce: "🤝",
    thanks: "👍",
    love: "❤️",
    laugh: "😂",
    cry: "😢",
    rip: "💀",
  };

  // Re-derive each frame so the fade-out keys off elapsed time. The
  // ticker also calls hud.pruneFeed which removes expired entries; this
  // just animates the alpha during their final ~500ms.
  let now = $state(performance.now());
  $effect(() => {
    let raf = 0;
    const tick = () => {
      now = performance.now();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  function ageFraction(pushedAt: number): number {
    const age = now - pushedAt;
    return Math.max(0, Math.min(1, age / FEED_TTL_MS));
  }

  function alphaFor(pushedAt: number): number {
    const f = ageFraction(pushedAt);
    // Fade in over the first 80ms, hold opaque, fade out the last 500ms.
    const age = now - pushedAt;
    if (age < 80) return age / 80;
    if (f > 0.9) return Math.max(0, (1 - f) / 0.1);
    return 1;
  }
</script>

<div class="feed">
  {#each hud.events as entry (entry.pushedAt)}
    <div
      class="toast"
      class:involves-local={entry.kind === "kill" && entry.involvesLocal}
      class:base-attack={entry.kind === "base-attack"}
      style="opacity: {alphaFor(entry.pushedAt)}"
    >
      {#if entry.kind === "kill"}
        {#if entry.killerName}
          <span class="name" style="color: {entry.killerColor}"
            >{entry.killerName}</span
          >
          <span class="sep">☠</span>
          <span class="name" style="color: {entry.victimColor}"
            >{entry.victimName}</span
          >
        {:else}
          <span class="sep dim">☠</span>
          <span class="name" style="color: {entry.victimColor}"
            >{entry.victimName}</span
          >
        {/if}
      {:else if entry.kind === "emote"}
        <span class="name" style="color: {entry.senderColor}"
          >{entry.senderName}</span
        >
        <span class="emote">{EMOTE_GLYPHS[entry.emote] ?? "•"}</span>
      {:else if entry.kind === "base-attack"}
        <span class="alert">⚠ BASE UNDER ATTACK</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .feed {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
    user-select: none;
    z-index: 6;
  }
  .toast {
    padding: 4px 12px;
    background: rgba(10, 14, 26, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    font-size: 12px;
    letter-spacing: 0.06em;
    color: #cbd5e1;
    transition: opacity 120ms ease;
    white-space: nowrap;
  }
  .toast.involves-local {
    border-color: rgba(255, 255, 255, 0.4);
    background: rgba(20, 28, 50, 0.85);
  }
  .toast.base-attack {
    background: rgba(50, 10, 14, 0.92);
    border-color: rgba(248, 113, 113, 0.7);
    padding: 6px 16px;
    font-size: 13px;
    letter-spacing: 0.12em;
  }
  .name {
    font-weight: 600;
  }
  .sep {
    margin: 0 6px;
    color: #94a3b8;
  }
  .sep.dim {
    color: #64748b;
  }
  .emote {
    margin-left: 8px;
    font-size: 14px;
  }
  .alert {
    color: #fda4af;
    font-weight: 700;
  }
</style>
