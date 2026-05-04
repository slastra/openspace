<script lang="ts">
  import { hud } from "./hudState.svelte.js";

  const fmt = (v: number, digits = 1) =>
    v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
</script>

{#if hud.debug}
  {@const d = hud.debug}
  <div class="debug">
    <div class="title">F1 Debug</div>

    <div class="section">
      <div class="row"><span>FPS</span><span>{fmt(d.fps, 0)}</span></div>
      <div class="row"><span>Frame dt</span><span>{fmt(d.frameDtMeanMs)} / p99 {fmt(d.frameDtP99Ms)} ms</span></div>
    </div>

    <div class="section">
      <div class="row"><span>Snapshots</span><span>{fmt(d.snapshotsPerSec, 1)}/s</span></div>
      <div class="row"><span>Snap interval</span><span>{fmt(d.snapshotIntervalMeanMs)} / p99 {fmt(d.snapshotIntervalP99Ms)} ms</span></div>
      <div class="row"><span>Server offset</span><span>{fmt(d.serverOffsetMs)} ms</span></div>
      <div class="row"><span>RTT spread</span><span>{fmt(d.rttSpreadMs)} ms</span></div>
    </div>

    <div class="section">
      <div class="row"><span>Reconcile drift</span><span>{fmt(d.reconcileDriftU, 2)} u</span></div>
      <div class="row"><span>Prediction error</span><span>{fmt(d.predictionErrorU, 2)} u</span></div>
      <div class="row"><span>Pending inputs</span><span>{d.pendingInputs}</span></div>
    </div>

    <div class="section">
      <div class="row"><span>Players</span><span>{d.players}</span></div>
      <div class="row"><span>Units</span><span>{d.units}</span></div>
      <div class="row"><span>Asteroids</span><span>{d.asteroids}</span></div>
      <div class="row"><span>Projectiles</span><span>{d.projectiles}</span></div>
    </div>
  </div>
{/if}

<style>
  .debug {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 36px;
    padding: 8px 12px;
    background: rgba(10, 14, 26, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: #cbd5e1;
    pointer-events: none;
    user-select: none;
    min-width: 260px;
  }
  .title {
    color: #94a3b8;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .section {
    padding: 4px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .section:first-of-type {
    border-top: none;
    padding-top: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    line-height: 1.5;
  }
  .row span:last-child {
    color: #e2e8f0;
    font-variant-numeric: tabular-nums;
  }
</style>
