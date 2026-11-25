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
    top: calc(var(--gutter-top) + 2px);
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
    padding: 5px 14px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    box-shadow: var(--panel-shadow);
    font-family: var(--font-ui);
    font-size: 13px;
    letter-spacing: 0.03em;
    color: var(--text);
    transition: opacity 120ms ease;
    white-space: nowrap;
    animation: toast-in 180ms ease-out;
  }
  @keyframes toast-in {
    from {
      transform: translateY(-6px);
    }
  }
  .toast.involves-local {
    border-color: rgba(74, 222, 128, 0.45);
    box-shadow:
      var(--panel-shadow),
      0 0 12px rgba(74, 222, 128, 0.15);
  }
  .toast.base-attack {
    background: linear-gradient(180deg, rgba(80, 16, 22, 0.95), rgba(45, 8, 12, 0.95));
    border-color: rgba(248, 113, 113, 0.75);
    padding: 7px 18px;
    animation:
      toast-in 180ms ease-out,
      alarm 900ms ease-in-out infinite;
  }
  @keyframes alarm {
    50% {
      box-shadow: 0 0 22px rgba(248, 113, 113, 0.55);
    }
  }
  .name {
    font-weight: 700;
  }
  .sep {
    margin: 0 7px;
    color: var(--text-dim);
  }
  .sep.dim {
    color: var(--text-faint);
  }
  .emote {
    margin-left: 8px;
    font-size: 15px;
  }
  .alert {
    color: #fecaca;
    font-weight: 700;
    letter-spacing: 0.16em;
  }
  @media (max-width: 719px) {
    /* Left column under the player list, clear of the minimap. */
    .feed {
      top: calc(var(--gutter-top) + 126px);
      left: var(--gutter-x);
      transform: none;
      align-items: flex-start;
    }
    .toast {
      font-size: 12px;
      padding: 4px 10px;
    }
    .toast:nth-child(n + 4) {
      display: none;
    }
  }
</style>
