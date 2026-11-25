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

  let { onRespawn, onEmote, onPress, onRelease }: {
    onRespawn: () => void;
    onEmote: (kind: EmoteKind) => void;
    /** Press / release a game key from on-screen UI (KeyboardEvent.code). */
    onPress: (code: string) => void;
    onRelease: (code: string) => void;
  } = $props();
</script>

<PlayerList />
<StatsPanel />
<SoundToggle />
<BuildHud {onPress} {onRelease} />
<Status />
<OnboardingHint />
<EventFeed />
<DebugPanel />
<RespawnOverlay {onRespawn} />
<RadialEmoteMenu {onEmote} />
<ReconnectOverlay />
