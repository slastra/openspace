<script lang="ts">
  import type { EmoteKind } from "@openspace/shared";
  import StatsPanel from "./StatsPanel.svelte";
  import PlayerList from "./PlayerList.svelte";
  import BuildHud from "./BuildHud.svelte";
  import RespawnOverlay from "./RespawnOverlay.svelte";
  import Status from "./Status.svelte";
  import DebugPanel from "./DebugPanel.svelte";
  import EventFeed from "./EventFeed.svelte";
  import RadialEmoteMenu from "./RadialEmoteMenu.svelte";
  import ReconnectOverlay from "./ReconnectOverlay.svelte";
  import OnboardingHint from "./OnboardingHint.svelte";
  import SoundToggle from "./SoundToggle.svelte";
  import TouchControls from "./TouchControls.svelte";
  import { isTouch } from "./device.js";

  let { onRespawn, onEmote, onPress, onRelease }: {
    onRespawn: () => void;
    onEmote: (kind: EmoteKind) => void;
    /** Press / release a game key from on-screen UI (KeyboardEvent.code). */
    onPress: (code: string) => void;
    onRelease: (code: string) => void;
  } = $props();
</script>

<!-- Layout anchor for the Pixi minimap: CSS decides where it goes and how
     big it is per breakpoint; render/minimap.ts follows this box. -->
<div class="minimap-slot" aria-hidden="true"></div>
<PlayerList />
<StatsPanel />
<SoundToggle />
{#if isTouch}
  <TouchControls {onPress} {onRelease} />
{/if}
<BuildHud {onPress} {onRelease} />
<Status />
<OnboardingHint />
<EventFeed />
<DebugPanel />
<RespawnOverlay {onRespawn} />
<RadialEmoteMenu {onEmote} />
<ReconnectOverlay />
