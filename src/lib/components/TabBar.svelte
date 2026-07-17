<script lang="ts">
  import { fileState } from '$/util/fileState.svelte';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import CloseIcon from '~icons/material-symbols/close-rounded';

  const handleClose = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    void fileState.closeTab(id);
  };

  const handleNew = () => {
    if (fileState.rootPath) void fileState.createFile(fileState.rootPath);
  };
</script>

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
      title={tab.isDraft ? 'Unsaved draft' : tab.path}
      onclick={() => fileState.switchTab(tab.id)}
      onkeydown={(e) => e.key === 'Enter' && fileState.switchTab(tab.id)}>
      <span class="min-w-0 flex-1 truncate">{tab.name}</span>
      {#if tab.isDirty}
        <span class="size-[5px] shrink-0 rounded-full bg-orange-400"></span>
      {/if}
      {#if !tab.isDraft}
        <button
          class={[
            'shrink-0 rounded p-0.5 hover:text-foreground',
            tab.id === fileState.activeTabId
              ? 'text-muted-foreground hover:bg-muted'
              : 'hover:bg-background',
            !tab.isDirty && 'opacity-0 group-hover:opacity-100'
          ]}
          onclick={(e) => handleClose(e, tab.id)}
          title={tab.isDirty ? 'Close (unsaved)' : 'Close'}>
          <CloseIcon class="size-3 {tab.isDirty ? 'text-muted-foreground' : ''}" />
        </button>
      {/if}
    </div>
  {/each}
  {#if fileState.rootPath}
    <button
      class="flex shrink-0 items-center px-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      onclick={handleNew}
      title="New File">
      <AddIcon class="size-4" />
    </button>
  {/if}
</div>
