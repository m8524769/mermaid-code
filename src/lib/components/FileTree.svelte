<script lang="ts">
  import { fileState, type FileTreeNode } from '$/util/fileState.svelte';
  import { confirmDialog } from '$/util/fileSystem';
  import FileTree from '$/components/FileTree.svelte';
  import FolderIcon from '~icons/material-symbols/folder-rounded';
  import FolderOpenIcon from '~icons/material-symbols/folder-open-rounded';
  import FileIcon from '~icons/material-symbols/description-outline-rounded';
  import ChevronIcon from '~icons/material-symbols/chevron-right-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import FolderAddIcon from '~icons/material-symbols/create-new-folder-outline-rounded';
  import EditIcon from '~icons/material-symbols/edit-outline-rounded';
  import DeleteIcon from '~icons/material-symbols/delete-outline-rounded';

  interface Props {
    nodes: FileTreeNode[];
    depth?: number;
    query?: string;
  }

  let { nodes, depth = 0, query = '' }: Props = $props();

  function nodeMatchesQuery(node: FileTreeNode, q: string): boolean {
    if (!q) return true;
    const lq = q.toLowerCase();
    if (!node.isDir) return node.name.toLowerCase().includes(lq);
    return (
      node.name.toLowerCase().includes(lq) || node.children.some((c) => nodeMatchesQuery(c, lq))
    );
  }

  let renamingPath = $state<string | null>(null);
  let renameValue = $state('');
  let menuPath = $state<string | null>(null);

  const startRename = (node: FileTreeNode) => {
    renamingPath = node.path;
    renameValue = node.name;
    menuPath = null;
  };

  const commitRename = async (node: FileTreeNode) => {
    let newName = renameValue.trim();
    renamingPath = null;
    if (!newName) return;
    if (!node.isDir) {
      const origExt = node.name.includes('.') ? node.name.slice(node.name.lastIndexOf('.')) : '';
      if (origExt && !newName.includes('.')) {
        newName = newName + origExt;
      }
    }
    if (newName !== node.name) {
      if (!node.isDir && !/\.(mmd|mermaid)$/i.test(newName)) {
        const ok = await confirmDialog(
          `"${newName}" is not a supported file type (.mmd or .mermaid). Rename anyway?`
        );
        if (!ok) return;
      }
      await fileState.renameNode(node.path, newName);
    }
  };

  const isActive = (path: string) =>
    fileState.tabs.find((t) => t.id === fileState.activeTabId)?.path === path;

  const focus = (el: HTMLElement, isDir: boolean) => {
    const input = el as HTMLInputElement;
    input.focus();
    const value = input.value;
    const dotIndex = !isDir ? value.lastIndexOf('.') : -1;
    const end = dotIndex > 0 ? dotIndex : value.length;
    input.setSelectionRange(0, end);
  };
</script>

<svelte:window
  onclick={() => {
    menuPath = null;
  }}
  onkeydown={(e) => e.key === 'Escape' && (menuPath = null)} />

{#each nodes.filter((n) => nodeMatchesQuery(n, query)) as node (node.path)}
  <div class="group relative">
    <div
      class={[
        'flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
        isActive(node.path) &&
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
      ]}
      style:padding-left="{depth * 12 + 4}px"
      role="button"
      tabindex="0"
      title={node.name}
      onclick={() => {
        if (node.isDir) fileState.toggleDir(node.path);
        else fileState.openFile(node.path, { recordRecent: false });
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          if (node.isDir) fileState.toggleDir(node.path);
          else fileState.openFile(node.path, { recordRecent: false });
        }
      }}>
      {#if node.isDir}
        <ChevronIcon
          class={['size-3 shrink-0 transition-transform', node.expanded && 'rotate-90']} />
        {#if node.expanded}
          <FolderOpenIcon class="size-4 shrink-0 text-yellow-500" />
        {:else}
          <FolderIcon class="size-4 shrink-0 text-yellow-500" />
        {/if}
      {:else}
        <span class="w-3 shrink-0"></span>
        <FileIcon class="size-4 shrink-0 text-blue-400" />
      {/if}

      {#if renamingPath === node.path}
        <input
          class="min-w-0 flex-1 rounded bg-background px-1 text-sm ring-1 ring-primary outline-none"
          bind:value={renameValue}
          onclick={(e) => e.stopPropagation()}
          onblur={() => commitRename(node)}
          onkeydown={(e) => {
            if (e.key === 'Enter') commitRename(node);
            if (e.key === 'Escape') renamingPath = null;
            e.stopPropagation();
          }}
          use:focus={node.isDir} />
      {:else}
        <span class="min-w-0 flex-1 truncate">{node.name}</span>
        {#if !node.isDir && fileState.tabs.find((t) => t.path === node.path)?.isDirty}
          <span class="mr-0.5 size-[5px] shrink-0 rounded-full bg-orange-400"></span>
        {/if}
      {/if}

      <!-- Hover action buttons -->
      <div
        class="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="toolbar"
        tabindex="-1">
        {#if node.isDir}
          <button
            class="cursor-pointer rounded bg-background p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="New File"
            onclick={() => fileState.createFile(node.path)}>
            <AddIcon class="size-3.5" />
          </button>
          <button
            class="cursor-pointer rounded bg-background p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="New Folder"
            onclick={() => fileState.createDir(node.path)}>
            <FolderAddIcon class="size-3.5" />
          </button>
        {/if}
        <button
          class="cursor-pointer rounded bg-background p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Rename"
          onclick={() => startRename(node)}>
          <EditIcon class="size-3.5" />
        </button>
        <button
          class="cursor-pointer rounded bg-background p-0.5 text-destructive hover:bg-muted"
          title="Delete"
          onclick={() => fileState.deleteNode(node.path, node.isDir)}>
          <DeleteIcon class="size-3.5" />
        </button>
      </div>
    </div>
  </div>

  {#if node.isDir && (node.expanded || query) && node.children.length > 0}
    <FileTree nodes={node.children} depth={depth + 1} {query} />
  {/if}
{/each}
