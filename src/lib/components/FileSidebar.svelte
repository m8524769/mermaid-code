<script lang="ts">
  import { fileState, autoSaveTick, IGNORED_DIRS } from '$/util/fileState.svelte';
  import { persisted } from '$/util/persist.svelte';
  import { mcpState } from '$/util/mcpState.svelte';
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
    // Delay restore to after full component tree mount
    setTimeout(async () => {
      await fileState.restoreLastFolder();
      // After restoring last folder, open any files passed via "Open with" on startup
      const { invoke } = await import('@tauri-apps/api/core');
      const startupFiles = await invoke<string[]>('get_opened_files').catch(() => [] as string[]);
      for (const path of startupFiles) {
        await fileState.openFile(path);
      }
    }, 0);
  });

  function collectMmdFiles(nodes: typeof fileState.tree): { path: string; name: string }[] {
    return nodes.flatMap((n) => {
      if (n.isDir) return n.loaded && !IGNORED_DIRS.has(n.name) ? collectMmdFiles(n.children) : [];
      return n.name.endsWith('.mmd') || n.name.endsWith('.mermaid')
        ? [{ path: n.path, name: n.name }]
        : [];
    });
  }
  $effect(() => {
    if (!mcpState.enabled) return;
    const activeTabId = fileState.activeTabId;
    const rootPath = fileState.rootPath;
    void fileState.tree; // track tree changes

    const activeTab = fileState.tabs.find((t) => t.id === activeTabId);

    const context = {
      folder: rootPath ?? null,
      files: collectMmdFiles(fileState.tree),
      active_tab: activeTab
        ? {
            path: activeTab.isDraft ? null : activeTab.path,
            name: activeTab.name,
            is_draft: activeTab.isDraft ?? false
          }
        : null
    };
    void import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('update_mcp_context', { context }).catch(() => {})
    );
  });

  // Auto-save: re-runs whenever activeTabId or isDirty changes
  $effect(() => {
    return autoSaveTick();
  });
</script>

<div class="flex h-full flex-col overflow-hidden border-r">
  <div class="flex h-8 items-center gap-1 border-b px-2">
    <span
      class="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      title={fileState.rootPath ?? undefined}>
      {pathLabel ?? 'Explorer'}
    </span>
    {#if fileState.rootPath}
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
    <button
      class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Open Folder"
      onclick={() => fileState.openFolder()}>
      <FolderOpenIcon class="size-4" />
    </button>
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
