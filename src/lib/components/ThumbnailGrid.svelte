<script lang="ts">
  import { fileState, IGNORED_DIRS } from '$/util/fileState.svelte';
  import { readTextFile, readDir } from '$/util/fileSystem';
  import { render } from '$/util/mermaid';
  import { thumbnailCache } from '$/util/thumbnailState.svelte';
  import { validatedState } from '$/util/state.svelte';
  import EditIcon from '~icons/material-symbols/edit-outline-rounded';
  import DeleteIcon from '~icons/material-symbols/delete-outline-rounded';
  import type { MermaidConfig } from 'mermaid';

  const getThumbnailConfig = (): MermaidConfig => {
    try {
      const config = JSON.parse(validatedState.current.mermaid || '{}') as MermaidConfig;
      return { ...config, securityLevel: 'loose' };
    } catch {
      return { securityLevel: 'loose' };
    }
  };

  async function collectAllFiles(dirPath: string): Promise<string[]> {
    const entries = await readDir(dirPath).catch(() => []);
    const result: string[] = [];
    for (const e of entries) {
      if (e.isDirectory) {
        if (!IGNORED_DIRS.has(e.name)) {
          result.push(...(await collectAllFiles(e.path)));
        }
      } else if (/\.(mmd|mermaid)$/i.test(e.name)) {
        result.push(e.path);
      }
    }
    return result;
  }

  let flatFiles = $state<string[]>([]);

  $effect(() => {
    const root = fileState.rootPath;
    // Re-scan when tree changes (new file/folder created, file deleted, etc.)
    void fileState.tree;
    if (!root) {
      flatFiles = [];
      return;
    }
    void collectAllFiles(root).then((files) => {
      const last = thumbnailCache.lastCreated;
      if (last && files.includes(last)) {
        flatFiles = [last, ...files.filter((f) => f !== last)];
      } else {
        flatFiles = files;
      }
    });
  });

  const isActive = (path: string) =>
    fileState.tabs.find((t) => t.id === fileState.activeTabId)?.path === path;

  // Rendering queue — plain variables, not $state
  let queue: string[] = [];
  let rendering = false;

  async function processQueue() {
    if (rendering) return;
    rendering = true;
    while (queue.length > 0) {
      const path = queue.shift()!;
      try {
        const code = await readTextFile(path);
        const cached = thumbnailCache.get(path);
        if (cached?.code === code) continue;
        const id = `mmc_${path.replace(/\W/g, '_')}`.slice(0, 64);
        const { svg } = await render(getThumbnailConfig(), code, id);
        thumbnailCache.set(path, { svg, code });
      } catch (e) {
        console.error('[ThumbnailGrid] render failed for', path, e);
        await readTextFile(path).catch(() => '');
        thumbnailCache.set(path, { svg: '', code: '' });
      }
    }
    rendering = false;
  }

  let cardEls: Record<string, HTMLDivElement | undefined> = $state({});
  let containerEl: HTMLDivElement | undefined = $state();
  let containerWidth = $state(0);

  $effect(() => {
    if (!containerEl) return;
    const observer = new ResizeObserver((entries) => {
      containerWidth = entries[0].contentRect.width;
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  const basename = (p: string) => p.split(/[/\\]/).pop() ?? p;

  // Inline rename state
  let renamingPath = $state<string | null>(null);
  let renameValue = $state('');

  const startRename = (path: string, e: Event) => {
    e.stopPropagation();
    renamingPath = path;
    renameValue = basename(path);
  };

  const commitRename = async (path: string) => {
    let newName = renameValue.trim();
    if (!newName) {
      renamingPath = null;
      return;
    }
    const name = basename(path);
    const origExt = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (origExt && !newName.includes('.')) newName = newName + origExt;
    if (newName !== name) await fileState.renameNode(path, newName);
    renamingPath = null;
  };

  const focus = (el: HTMLElement) => {
    const input = el as HTMLInputElement;
    input.focus();
    const value = input.value;
    const dotIndex = value.lastIndexOf('.');
    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : value.length);
  };

  $effect(() => {
    const files = flatFiles;

    const observer = new IntersectionObserver(
      (entries) => {
        let needsProcess = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const path = (entry.target as HTMLElement).dataset.path!;
          if (!thumbnailCache.get(path) && !queue.includes(path)) {
            queue.push(path);
            needsProcess = true;
          }
        }
        if (needsProcess) void processQueue();
      },
      { threshold: 0.1 }
    );

    for (const path of files) {
      const el = cardEls[path];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  });
</script>

<svelte:window
  onclick={() => {
    renamingPath = null;
  }} />

<div
  bind:this={containerEl}
  class={['grid gap-2 overflow-y-auto p-2', containerWidth >= 240 ? 'grid-cols-2' : 'grid-cols-1']}>
  {#each flatFiles as path (path)}
    {@const entry = thumbnailCache.get(path)}
    <div
      class={[
        'group relative cursor-pointer rounded border p-1 text-left hover:bg-muted/60',
        isActive(path) && 'ring-2 ring-primary'
      ]}
      data-path={path}
      bind:this={cardEls[path]}
      role="button"
      tabindex="0"
      title={path}
      onclick={() => fileState.openFile(path)}
      onkeydown={(e) => e.key === 'Enter' && fileState.openFile(path)}>
      <div class="aspect-video w-full overflow-hidden rounded bg-muted/30">
        {#if entry?.svg}
          <div class="pointer-events-none h-full w-full [&>svg]:h-full [&>svg]:w-full">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html entry.svg}
          </div>
        {:else}
          <div class="h-full w-full animate-pulse rounded bg-muted/50"></div>
        {/if}
      </div>

      <!-- Filename / rename input -->
      <div class="mt-1 px-0.5">
        {#if renamingPath === path}
          <input
            class="w-full rounded bg-background px-1 text-xs outline-none ring-1 ring-primary"
            bind:value={renameValue}
            onclick={(e) => e.stopPropagation()}
            onblur={() => commitRename(path)}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(path);
              if (e.key === 'Escape') renamingPath = null;
              e.stopPropagation();
            }}
            use:focus />
        {:else}
          <div class="flex items-center gap-0.5">
            <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{basename(path)}</p>
            <div
              class="w-0 shrink-0 overflow-hidden group-hover:w-auto"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.stopPropagation()}
              role="toolbar"
              tabindex="-1">
              <div class="flex items-center gap-0.5">
                <button
                  class="cursor-pointer rounded bg-background p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Rename"
                  onclick={(e) => startRename(path, e)}>
                  <EditIcon class="size-3" />
                </button>
                <button
                  class="cursor-pointer rounded bg-background p-0.5 text-destructive hover:bg-muted"
                  title="Delete"
                  onclick={(e) => {
                    e.stopPropagation();
                    void fileState.deleteNode(path, false);
                  }}>
                  <DeleteIcon class="size-3" />
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
