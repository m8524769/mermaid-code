<script lang="ts">
  import { Toaster } from '$/components/ui/sonner/index.js';
  import { loadingState } from '$/util/loading.svelte';
  import { fileState } from '$/util/fileState.svelte';
  import { isTauri, saveFileAs } from '$/util/fileSystem';
  import { notify } from '$/util/notify';
  import { updateState } from '$/util/updateState.svelte';
  import { toggleDarkTheme } from '$/util/state.svelte';
  import { initHandler } from '$/util/util';
  import { base } from '$app/paths';
  import { mode, ModeWatcher } from 'mode-watcher';
  import { onMount, type Snippet } from 'svelte';
  import '../app.css';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // This can be removed once https://github.com/sveltejs/kit/issues/1612 is fixed.
  // Then move it into src and vite will bundle it automatically.
  onMount(() => {
    window.addEventListener('hashchange', () => {
      void initHandler();
    });

    // Disable native browser/webview context menu so bits-ui ContextMenu can work.
    // bits-ui sets data-context-menu-trigger on ContextMenu.Trigger elements —
    // only suppress the native menu outside those elements.
    if (isTauri()) {
      document.addEventListener('contextmenu', (e) => {
        const target = e.target as Element | null;
        if (!target?.closest('[data-context-menu-trigger]')) {
          e.preventDefault();
        }
      });
    }

    if (isTauri()) {
      void (async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        await appWindow.onCloseRequested(async (event) => {
          const draft = fileState.tabs.find((t) => t.isDraft && t.code.trim() !== '');
          const dirtyTabs = fileState.tabs.filter((t) => t.isDirty && !t.isDraft);
          const { confirm } = await import('@tauri-apps/plugin-dialog');

          // Check unsaved real files first
          if (dirtyTabs.length > 0) {
            const names = dirtyTabs.map((t) => t.name).join(', ');
            const ok = await confirm(
              `You have unsaved changes in: ${names}\n\nQuit without saving?`
            );
            if (!ok) {
              event.preventDefault();
              return;
            }
          }

          // Then check draft
          if (draft) {
            event.preventDefault();
            const save = await confirm('You have an unsaved draft. Save before closing?', {
              title: 'Unsaved Draft',
              okLabel: 'Save',
              cancelLabel: 'Discard'
            });
            if (save) {
              const now = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
              const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
              await saveFileAs(draft.code, `Diagram ${date} at ${time}.mmd`);
              fileState.clearDraft();
            }
          }

          fileState.stopWatching();
          await appWindow.destroy();
        });
      })();

      // Check for updates in background
      void (async () => {
        try {
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check();
          if (update) {
            updateState.set(update.version, update);
            const { confirm } = await import('@tauri-apps/plugin-dialog');
            const ok = await confirm(
              `Mermaid Code ${update.version} is available.\n\nDownload now?`,
              { title: 'Update Available' }
            );
            if (ok) {
              void updateState.download();
            }
          } else {
            updateState.setLatest();
          }
        } catch {
          // ignore update errors silently
        }
      })();
    }
  });

  $effect(() => {
    toggleDarkTheme(mode.current === 'dark');
  });
</script>

<ModeWatcher />
<Toaster />

<main class="h-dvh">
  {@render children()}
</main>

{#if loadingState.loading}
  <div
    class="absolute top-0 left-0 z-50 flex h-screen w-screen justify-center bg-gray-600 align-middle opacity-50">
    <div class="my-auto text-4xl font-bold text-indigo-100">
      <div class="loader mx-auto"></div>
      <div>{loadingState.message}</div>
    </div>
  </div>
{/if}

<style>
  .loader {
    border: 0.45em solid #f3f3f3;
    border-radius: 50%;
    border-top: 0.45em solid #6365f1;
    width: 3em;
    height: 3em;
    -webkit-animation: spin 2s linear infinite; /* Safari */
    animation: spin 2s linear infinite;
  }

  /* Safari */
  @-webkit-keyframes spin {
    0% {
      -webkit-transform: rotate(0deg);
    }
    100% {
      -webkit-transform: rotate(360deg);
    }
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
