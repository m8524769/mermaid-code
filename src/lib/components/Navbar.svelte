<script lang="ts">
  import MainMenu from '$/components/MainMenu.svelte';
  import { Separator } from '$/components/ui/separator';
  import { updateState } from '$/util/updateState.svelte';
  import { fileState } from '$/util/fileState.svelte';
  import { m } from '$/paraglide/messages';
  import { type Snippet } from 'svelte';
  import MermaidIcon from '~icons/custom/mermaid';
  import { version as appVersion } from '../../../package.json';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  const activeFileName = $derived.by(() => {
    const tab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
    if (!tab) return null;
    return tab.isDraft ? m.draft() : tab.name.replace(/\.(mmd|mermaid)$/i, '');
  });
</script>

<nav class="z-50 flex p-4 sm:p-6">
  <div class="flex flex-1 items-center gap-2">
    <MainMenu />
    <MermaidIcon class="size-6" />
    <div class="flex items-baseline gap-1.5">
      <span class="whitespace-nowrap text-accent"> Mermaid Code </span>
      <span class="text-xs text-muted-foreground">v{appVersion}</span>
      {#if updateState.pendingVersion}
        {#if updateState.downloadProgress === null}
          <button
            class="text-xs text-accent hover:underline"
            title={m.update_available({ version: updateState.pendingVersion })}
            onclick={() => void updateState.download()}>
            ↑ v{updateState.pendingVersion}
          </button>
        {:else if updateState.downloadProgress === 101}
          <button
            class="text-xs text-accent hover:underline"
            title={m.update_ready({ version: updateState.pendingVersion })}
            onclick={() => void updateState.installDownloaded()}>
            ↑ v{updateState.pendingVersion} — {m.update_install_restart()}
          </button>
        {:else}
          <span class="text-xs text-muted-foreground">
            ↑ v{updateState.pendingVersion} ({updateState.downloadProgress}%)
          </span>
        {/if}
      {:else if updateState.isLatest}
        <span class="text-xs text-muted-foreground/60">{m.update_latest()}</span>
      {/if}
    </div>
  </div>
  <div
    id="menu"
    class="hidden flex-nowrap items-center justify-between gap-3 overflow-hidden md:flex">
    {#if activeFileName}
      <span class="max-w-64 truncate text-sm text-muted-foreground" title={activeFileName}>
        {activeFileName}
      </span>
    {/if}
    <Separator orientation="vertical" />
    {@render children()}
  </div>
</nav>
