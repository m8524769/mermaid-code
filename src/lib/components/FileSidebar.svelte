<script lang="ts">
  import { fileState, autoSaveTick } from '$/util/fileState.svelte';
  import { isTauri } from '$/util/fileSystem';
  import { persisted } from '$/util/persist.svelte';
  import FileTree from '$/components/FileTree.svelte';
  import ThumbnailGrid from '$/components/ThumbnailGrid.svelte';
  import FolderOpenIcon from '~icons/material-symbols/folder-open-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import FolderAddIcon from '~icons/material-symbols/create-new-folder-outline-rounded';
  import ViewListIcon from '~icons/material-symbols/view-list-rounded';
  import GridViewIcon from '~icons/material-symbols/grid-view-rounded';
  import { onMount } from 'svelte';

  const viewMode = persisted<'tree' | 'grid'>('mermaid-sidebar-view', 'grid');
  let renderContainer: HTMLDivElement | undefined = $state();
  let searchQuery = $state('');

  // Clear search when folder changes
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    fileState.rootPath;
    searchQuery = '';
  });

  const pathLabel = $derived(
    fileState.rootPath
      ? (fileState.rootPath.split(/[/\\]/).filter(Boolean).pop() ?? fileState.rootPath)
      : null
  );

  onMount(() => {
    if (isTauri()) {
      // Delay restore to after full component tree mount
      setTimeout(() => void fileState.restoreLastFolder(), 0);
    }
  });

  // Auto-save: re-runs whenever activeTabId or isDirty changes
  $effect(() => {
    return autoSaveTick();
  });
</script>

<div class="flex h-full flex-col overflow-hidden border-r">
  <div class="flex items-center gap-1 border-b px-2 py-1.5">
    <span
      class="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      title={fileState.rootPath ?? undefined}>
      {pathLabel ?? 'Explorer'}
    </span>
    {#if isTauri() && fileState.rootPath}
      <button
        class={[
          'rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground',
          viewMode.value === 'tree' && 'bg-muted'
        ]}
        title="Tree view"
        onclick={() => (viewMode.value = 'tree')}>
        <ViewListIcon class="size-4" />
      </button>
      <button
        class={[
          'rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground',
          viewMode.value === 'grid' && 'bg-muted'
        ]}
        title="Thumbnail grid"
        onclick={() => (viewMode.value = 'grid')}>
        <GridViewIcon class="size-4" />
      </button>
      <div class="mx-0.5 h-3.5 w-px bg-border"></div>
      <button
        class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="New File"
        onclick={() => fileState.createFile(fileState.rootPath!)}>
        <AddIcon class="size-4" />
      </button>
      <button
        class={[
          'rounded p-0.5',
          viewMode.value === 'grid'
            ? 'pointer-events-none text-muted-foreground/40'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        ]}
        title={viewMode.value === 'grid'
          ? 'New Folder (not available in thumbnail view)'
          : 'New Folder'}
        disabled={viewMode.value === 'grid'}
        onclick={() => fileState.createDir(fileState.rootPath!)}>
        <FolderAddIcon class="size-4" />
      </button>
    {/if}
    {#if isTauri()}
      <button
        class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Open Folder"
        onclick={() => fileState.openFolder()}>
        <FolderOpenIcon class="size-4" />
      </button>
    {/if}
  </div>

  {#if fileState.rootPath}
    <div class="px-2 py-1">
      <input
        class="w-full rounded bg-muted/50 px-2 py-0.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary"
        placeholder="Search files..."
        bind:value={searchQuery} />
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto py-1">
    {#if !fileState.rootPath}
      {#if isTauri()}
        <div class="flex flex-col items-center gap-3 px-4 py-8">
          <p class="text-center text-xs text-muted-foreground">
            Open a folder to start editing your diagrams.
          </p>
          <button
            class="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/70"
            onclick={() => fileState.openFolder()}>
            <FolderOpenIcon class="size-4" />
            Open Folder
          </button>
        </div>
      {:else}
        <p class="px-3 py-4 text-xs text-muted-foreground">
          File manager requires the desktop app.
        </p>
      {/if}
    {:else if fileState.tree.length === 0}
      <p class="px-3 py-4 text-center text-xs text-muted-foreground">This folder is empty.</p>
    {:else if viewMode.value === 'grid' && renderContainer}
      <ThumbnailGrid query={searchQuery} />
    {:else}
      <FileTree nodes={fileState.tree} query={searchQuery} />
    {/if}
  </div>

  {#if fileState.activeTabId}
    <div class="flex items-center justify-between border-t px-2 py-1 text-xs text-muted-foreground">
      <span>Auto-save</span>
      <button
        class={[
          'rounded px-1.5 py-0.5 text-xs',
          fileState.isAutoSave
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        ]}
        onclick={() => fileState.toggleAutoSave()}>
        {fileState.isAutoSave ? 'ON' : 'OFF'}
      </button>
    </div>
  {/if}

  <div
    bind:this={renderContainer}
    style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0"
    aria-hidden="true">
  </div>
</div>
