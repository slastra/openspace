<script lang="ts">
  import { hud } from "./hudState.svelte.js";
  import { BUILD_INFO } from "@openspace/shared";

  /** Seconds the auto-refresh countdown gives the player to read the
   *  notes. The Stay button cancels the countdown — they can click
   *  Refresh whenever they're ready. */
  const COUNTDOWN_SECONDS = 10;

  let countdown = $state(COUNTDOWN_SECONDS);
  let countdownActive = $state(true);
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Drive the countdown only while the update modal is showing AND the
  // player hasn't tapped Stay. Restarts on every transition into the
  // update-available state.
  $effect(() => {
    if (hud.connectionState !== "update-available" || !countdownActive) return;
    countdown = COUNTDOWN_SECONDS;
    countdownTimer = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) location.reload();
    }, 1000);
    return () => {
      if (countdownTimer !== null) clearInterval(countdownTimer);
      countdownTimer = null;
    };
  });

  function refresh() {
    location.reload();
  }

  function stay() {
    countdownActive = false;
  }

  // Filter server's recent notes down to the ones this client hasn't
  // already shipped with. Keeps the modal's "what's new" list tight
  // for users who reload often. If the SHA sets don't intersect (e.g.
  // big jump or dev mode), fall back to showing everything the server
  // returned.
  let newNotes = $derived.by(() => {
    if (!hud.serverBuildInfo) return [];
    const seen = new Set(BUILD_INFO.notes.map((n) => n.sha));
    const filtered = hud.serverBuildInfo.notes.filter((n) => !seen.has(n.sha));
    return filtered.length > 0 ? filtered : hud.serverBuildInfo.notes;
  });
</script>

{#if hud.connectionState === "reconnecting"}
  <div class="overlay">
    <div class="panel reconnect">
      <div class="spinner"></div>
      <div class="title">Reconnecting</div>
      <div class="subtitle">The server may be updating.</div>
    </div>
  </div>
{:else if hud.connectionState === "update-available" && hud.serverBuildInfo}
  <div class="overlay">
    <div class="panel update">
      <div class="kicker">openspace updated</div>
      <div class="title">A new build is ready</div>
      {#if newNotes.length > 0}
        <div class="notes-label">What's new</div>
        <ul class="notes">
          {#each newNotes.slice(0, 8) as note (note.sha)}
            <li><span class="note-sha">{note.sha}</span> {note.subject}</li>
          {/each}
        </ul>
      {/if}
      <div class="actions">
        <button type="button" class="ghost" onclick={stay} disabled={!countdownActive}>
          {#if countdownActive}Stay{:else}Staying…{/if}
        </button>
        <button type="button" class="primary" onclick={refresh}>
          {#if countdownActive}
            Refresh now ({countdown}s)
          {:else}
            Refresh now
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 14, 26, 0.78);
    backdrop-filter: blur(2px);
    z-index: 12;
  }
  .panel {
    padding: 28px 36px;
    background:
      radial-gradient(120% 80% at 50% 0%, rgba(74, 222, 128, 0.06), transparent 60%),
      rgba(20, 27, 45, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    box-shadow:
      0 24px 72px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(74, 222, 128, 0.08);
    color: #cbd5e1;
    text-align: center;
    min-width: 320px;
    max-width: 520px;
  }
  .reconnect {
    min-width: 280px;
  }
  .spinner {
    width: 28px;
    height: 28px;
    margin: 0 auto 14px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: #4ade80;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .title {
    font-size: 16px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-weight: 700;
    color: #f1f5f9;
  }
  .subtitle {
    margin-top: 8px;
    font-size: 12px;
    color: #94a3b8;
    letter-spacing: 0.04em;
  }
  .update {
    text-align: left;
  }
  .update .title {
    text-align: left;
    font-size: 18px;
    margin-bottom: 4px;
  }
  .kicker {
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #4ade80;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .notes-label {
    margin-top: 18px;
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #94a3b8;
    font-weight: 700;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding-bottom: 6px;
  }
  .notes {
    list-style: none;
    padding: 10px 0 0;
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    color: #cbd5e1;
  }
  .notes li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 1px 0;
  }
  .note-sha {
    flex: 0 0 auto;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    color: #64748b;
    letter-spacing: 0.04em;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  button {
    display: inline-block;
    padding: 9px 18px;
    border: none;
    border-radius: 4px;
    font: inherit;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background 120ms ease,
      opacity 120ms ease;
  }
  .primary {
    background: #4ade80;
    color: #0a0e1a;
  }
  .primary:hover {
    background: #6ee7a0;
  }
  .ghost {
    background: rgba(255, 255, 255, 0.08);
    color: #cbd5e1;
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
  .ghost:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
  }
  .ghost:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
