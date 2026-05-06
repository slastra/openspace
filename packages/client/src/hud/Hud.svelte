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

  let { onRespawn, onEmote }: {
    onRespawn: () => void;
    onEmote: (kind: EmoteKind) => void;
  } = $props();
</script>

<PlayerList />
<StatsPanel />
<BuildHud />
<Status />
<EventFeed />
<DebugPanel />
<RespawnOverlay {onRespawn} />
<RadialEmoteMenu {onEmote} />
<ReconnectOverlay />
