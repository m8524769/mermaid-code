<script lang="ts">
  import { m } from '$/paraglide/messages';
  import { fileState, IGNORED_DIRS } from '$/util/fileState.svelte';
  import { readTextFile, readDir, confirmDialog } from '$/util/fileSystem';
  import { render } from '$/util/mermaid';
  import { thumbnailCache } from '$/util/thumbnailState.svelte';
  import { validatedState } from '$/util/state.svelte';
  import EditIcon from '~icons/material-symbols/edit-outline-rounded';
  import DeleteIcon from '~icons/material-symbols/delete-outline-rounded';
  import type { MermaidConfig } from 'mermaid';

  interface Props {
    query?: string;
  }
  let { query = '' }: Props = $props();

  const getThumbnailConfig = (): MermaidConfig => {
    try {
      const config = JSON.parse(validatedState.current.mermaid || '{}') as MermaidConfig;
      return { ...config, securityLevel: 'strict' };
    } catch {
      return { securityLevel: 'strict' };
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

  // Tracks files whose thumbnails are stale due to config change
  const staleList = new Set<string>();

  // When config changes: invalidate + re-render current file immediately,
  // mark all others as stale (re-rendered on next click)
  let lastMermaid = validatedState.current.mermaid;
  $effect(() => {
    const current = validatedState.current.mermaid;
    if (current === lastMermaid) return;
    lastMermaid = current;
    const activePath = fileState.tabs.find((t) => t.id === fileState.activeTabId)?.path;
    for (const p of flatFiles) {
      if (p === activePath) {
        thumbnailCache.invalidate(p);
        if (!queue.includes(p)) {
          queue.push(p);
          void processQueue();
        }
      } else {
        staleList.add(p);
      }
    }
  });

  // When the active file is saved, its thumbnail is stale. Track the last-seen
  // saved content per path and enqueue on change; processQueue's disk-code
  // comparison then re-renders only if the content actually differs (no blank
  // flash). Keying by path means tab switches don't re-enqueue an unchanged file.
  const seenSavedCode = new Map<string, string>();
  $effect(() => {
    const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
    const savedCode = activeTab?.savedCode;
    const path = activeTab?.path;
    if (!path || activeTab?.isDraft || savedCode === undefined) return;
    if (seenSavedCode.get(path) === savedCode) return;
    seenSavedCode.set(path, savedCode);
    if (!queue.includes(path)) {
      queue.push(path);
      void processQueue();
    }
  });

  $effect(() => {
    const root = fileState.rootPath;
    // Re-scan when tree changes (new file/folder created, file deleted, etc.)
    void fileState.tree;
    if (!root) {
      flatFiles = [];
      return;
    }
    void collectAllFiles(root).then((files) => {
      const sorted = files.sort((a, b) => a.localeCompare(b));
      const last = thumbnailCache.lastCreated;
      if (last && sorted.includes(last)) {
        flatFiles = [last, ...sorted.filter((f) => f !== last)];
      } else {
        flatFiles = sorted;
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
    renamingPath = null;
    if (!newName) return;
    const name = basename(path);
    const origExt = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (origExt && !newName.includes('.')) newName = newName + origExt;
    if (newName !== name) {
      if (!/\.(mmd|mermaid)$/i.test(newName)) {
        const ok = await confirmDialog(m.rename_unsupported_confirm({ name: newName }));
        if (!ok) return;
      }
      await fileState.renameNode(path, newName);
    }
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
  {#each flatFiles.filter((p) => !query || basename(p)
        .toLowerCase()
        .includes(query.toLowerCase())) as path (path)}
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
      onclick={() => {
        if (staleList.has(path)) {
          staleList.delete(path);
          thumbnailCache.invalidate(path);
          if (!queue.includes(path)) {
            queue.push(path);
            void processQueue();
          }
        }
        fileState.openFile(path, { recordRecent: false });
      }}
      onkeydown={(e) => e.key === 'Enter' && fileState.openFile(path, { recordRecent: false })}>
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
            class="w-full rounded bg-background px-1 text-xs ring-1 ring-primary outline-none"
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
            {#if fileState.tabs.find((t) => t.path === path)?.isDirty}
              <span class="mr-0.5 size-[5px] shrink-0 rounded-full bg-orange-400"></span>
            {/if}
            <div
              class="w-0 shrink-0 overflow-hidden group-hover:w-auto"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.stopPropagation()}
              role="toolbar"
              tabindex="-1">
              <div class="flex items-center gap-0.5">
                <button
                  class="cursor-pointer rounded bg-background p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={m.action_rename()}
                  onclick={(e) => startRename(path, e)}>
                  <EditIcon class="size-3" />
                </button>
                <button
                  class="cursor-pointer rounded bg-background p-0.5 text-destructive hover:bg-muted"
                  title={m.action_delete()}
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
