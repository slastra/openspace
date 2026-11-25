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
  <div class="scrim">
    <div class="modal panel reconnect">
      <div class="spinner"></div>
      <div class="title">Reconnecting</div>
      <div class="subtitle">The server may be updating.</div>
    </div>
  </div>
{:else if hud.connectionState === "update-available" && hud.serverBuildInfo}
  <div class="scrim">
    <div class="modal panel update">
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
        <button type="button" class="btn btn-ghost" onclick={stay} disabled={!countdownActive}>
          {#if countdownActive}Stay{:else}Staying…{/if}
        </button>
        <button type="button" class="btn btn-primary" onclick={refresh}>
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
  .scrim {
    z-index: 12;
  }
  .panel {
    padding: 28px 36px;
    text-align: center;
    min-width: 320px;
    max-width: min(520px, calc(100vw - 32px));
    box-sizing: border-box;
  }
  .reconnect {
    min-width: 280px;
  }
  .spinner {
    width: 28px;
    height: 28px;
    margin: 0 auto 14px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .title {
    font-family: var(--font-ui);
    font-size: 16px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--text-strong);
  }
  .subtitle {
    margin-top: 8px;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--text-dim);
  }
  .update {
    text-align: left;
  }
  .update .title {
    font-size: 18px;
    margin-bottom: 4px;
  }
  .kicker {
    font-family: var(--font-ui);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 700;
    margin-bottom: 6px;
  }
  .notes-label {
    margin-top: 18px;
    font-family: var(--font-ui);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--text-dim);
    font-weight: 700;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding-bottom: 6px;
  }
  .notes {
    list-style: none;
    padding: 10px 0 0;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
  }
  .notes li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 1px 0;
  }
  .note-sha {
    flex: 0 0 auto;
    font-family: var(--font-num);
    font-size: 10px;
    color: var(--text-faint);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .btn {
    font-size: 12px;
    padding: 9px 18px;
  }
</style>
