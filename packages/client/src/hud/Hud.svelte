<script lang="ts">
  import StatsPanel from "./StatsPanel.svelte";
  import PlayerList from "./PlayerList.svelte";
  import BuildHud from "./BuildHud.svelte";
  import RespawnOverlay from "./RespawnOverlay.svelte";
  import Status from "./Status.svelte";
  import DebugPanel from "./DebugPanel.svelte";

  let { onRespawn }: { onRespawn: () => void } = $props();
</script>

<PlayerList />
<StatsPanel />
<BuildHud />
<Status />
<DebugPanel />
<RespawnOverlay {onRespawn} />
