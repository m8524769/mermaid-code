<script lang="ts">
  import { fileState, autoSaveTick } from '$/util/fileState.svelte';
  import { isTauri } from '$/util/fileSystem';
  import FileTree from '$/components/FileTree.svelte';
  import FolderOpenIcon from '~icons/material-symbols/folder-open-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import FolderAddIcon from '~icons/material-symbols/create-new-folder-outline-rounded';
  import { onMount } from 'svelte';

  const pathLabel = $derived(
    fileState.rootPath ? fileState.rootPath.split(/[/\\]/).filter(Boolean).pop() ?? fileState.rootPath : null
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
    <span class="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {pathLabel ?? 'Explorer'}
    </span>
    {#if isTauri() && fileState.rootPath}
      <button
        class="rounded p-0.5 hover:bg-muted"
        title="New File"
        onclick={() => fileState.createFile(fileState.rootPath!)}>
        <AddIcon class="size-4" />
      </button>
      <button
        class="rounded p-0.5 hover:bg-muted"
        title="New Folder"
        onclick={() => fileState.createDir(fileState.rootPath!)}>
        <FolderAddIcon class="size-4" />
      </button>
    {/if}
    {#if isTauri()}
      <button
        class="rounded p-0.5 hover:bg-muted"
        title="Open Folder"
        onclick={() => fileState.openFolder()}>
        <FolderOpenIcon class="size-4" />
      </button>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto py-1">
    {#if fileState.tree.length === 0}
      {#if isTauri()}
        <div class="flex flex-col items-center gap-3 px-4 py-8">
          <p class="text-center text-xs text-muted-foreground">
            Open a folder to start editing your diagrams.
          </p>
          <button
            class="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
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
    {:else}
      <FileTree nodes={fileState.tree} />
    {/if}
  </div>

  <div class="flex items-center justify-between border-t px-2 py-1 text-xs text-muted-foreground">
    <span>Auto-save</span>
    <button
      class={[
        'rounded px-1.5 py-0.5 text-xs',
        fileState.isAutoSave ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
      ]}
      onclick={() => fileState.toggleAutoSave()}>
      {fileState.isAutoSave ? 'ON' : 'OFF'}
    </button>
  </div>
</div>
