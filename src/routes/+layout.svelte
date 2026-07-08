<script lang="ts">
  import { Toaster } from '$/components/ui/sonner/index.js';
  import { loadingState } from '$/util/loading.svelte';
  import { fileState } from '$/util/fileState.svelte';
  import { isTauri } from '$/util/fileSystem';
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
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register(`${base}/service-worker.js`, { scope: `${base}/` })
        .then(function (registration) {
          console.log('Registration successful, scope is:', registration.scope);
        })
        .catch(function (error) {
          console.log('Service worker registration failed, error:', error);
        });
    }

    if (isTauri()) {
      void (async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        await appWindow.onCloseRequested(async (event) => {
          const dirtyTabs = fileState.tabs.filter((t) => t.isDirty);
          if (dirtyTabs.length > 0) {
            const names = dirtyTabs.map((t) => t.name).join(', ');
            const { confirm } = await import('@tauri-apps/plugin-dialog');
            const ok = await confirm(
              `You have unsaved changes in: ${names}\n\nQuit without saving?`
            );
            if (!ok) event.preventDefault();
            else fileState.stopWatching();
          } else {
            fileState.stopWatching();
          }
        });
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
