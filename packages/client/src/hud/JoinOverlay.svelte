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
    padding: 24px 32px;
    background: rgba(20, 27, 45, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    text-align: center;
    min-width: 280px;
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
</style>
