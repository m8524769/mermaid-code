<script lang="ts">
  import { fileState, type Tab } from '$/util/fileState.svelte';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import CloseIcon from '~icons/material-symbols/close-rounded';

  let dragSrcId = $state<string | null>(null);

  const onDragStart = (tab: Tab) => {
    dragSrcId = tab.id;
  };

  const onDrop = (targetTab: Tab) => {
    if (!dragSrcId || dragSrcId === targetTab.id) return;
    const srcIdx = fileState.tabs.findIndex((t) => t.id === dragSrcId);
    const tgtIdx = fileState.tabs.findIndex((t) => t.id === targetTab.id);
    if (srcIdx === -1 || tgtIdx === -1) return;

    // Reorder array and reassign to trigger $state reactivity
    const reordered = [...fileState.tabs];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);

    // Clear and reassign all elements to trigger reactivity
    fileState.tabs.length = 0;
    reordered.forEach((t) => fileState.tabs.push(t));

    dragSrcId = null;
  };

  const handleClose = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    void fileState.closeTab(id);
  };

  const handleNew = () => {
    if (fileState.rootPath) {
      void fileState.createFile(fileState.rootPath);
    }
  };
</script>

{#if fileState.tabs.length > 0}
  <div class="flex h-8 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30">
    {#each fileState.tabs as tab (tab.id)}
      <div
        class={[
          'group flex min-w-0 max-w-40 cursor-pointer items-center gap-1 border-r px-2 text-xs',
          tab.id === fileState.activeTabId
            ? 'bg-background font-medium'
            : 'hover:bg-muted/60 text-muted-foreground'
        ]}
        role="tab"
        tabindex="0"
        draggable="true"
        ondragstart={() => onDragStart(tab)}
        ondragover={(e) => e.preventDefault()}
        ondrop={() => onDrop(tab)}
        onclick={() => fileState.switchTab(tab.id)}
        onkeydown={(e) => e.key === 'Enter' && fileState.switchTab(tab.id)}>
        <span class="min-w-0 flex-1 truncate">{tab.name}</span>
        {#if tab.isDirty}
          <span class="shrink-0 text-orange-400">●</span>
        {/if}
        <button
          class={[
            'shrink-0 rounded p-0.5 hover:bg-muted',
            !tab.isDirty && 'opacity-0 group-hover:opacity-100'
          ]}
          onclick={(e) => handleClose(e, tab.id)}
          title={tab.isDirty ? 'Close (unsaved)' : 'Close'}>
          <CloseIcon class="size-3 {tab.isDirty ? 'text-muted-foreground' : ''}" />
        </button>
      </div>
    {/each}
    {#if fileState.rootPath}
      <button
        class="flex shrink-0 items-center px-2 hover:bg-muted/60 text-muted-foreground"
        onclick={handleNew}
        title="New File">
        <AddIcon class="size-4" />
      </button>
    {/if}
  </div>
{/if}
