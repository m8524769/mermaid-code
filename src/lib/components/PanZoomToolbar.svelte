<script lang="ts">
  import FloatingToolbar from '$/components/FloatingToolbar.svelte';
  import { Button } from '$/components/ui/button';
  import { Separator } from '$/components/ui/separator';
  import type { PanZoomState } from '$/util/panZoom';
  import { isTauri } from '$/util/fileSystem';
  import { urls } from '$/util/state.svelte';
  import ExpandIcon from '~icons/material-symbols/open-in-full-rounded';
  import CloseFullscreenIcon from '~icons/material-symbols/close-fullscreen-rounded';
  import ArrowsToCircleIcon from '~icons/material-symbols/screenshot-frame-2';
  import MagnifyingGlassPlusIcon from '~icons/material-symbols/zoom-in';
  import MagnifyingGlassMinusIcon from '~icons/material-symbols/zoom-out';

  let {
    panZoomState,
    onPresentationToggle,
    isPresentationMode = false
  }: {
    panZoomState: PanZoomState;
    onPresentationToggle?: () => void;
    isPresentationMode?: boolean;
  } = $props();

  const openFullScreen = async () => {
    const viewUrl = urls.current.view;
    if (isTauri()) {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      new WebviewWindow('view', {
        url: viewUrl,
        title: 'Mermaid Code — View',
        fullscreen: true,
        resizable: true,
        center: true
      });
    } else {
      window.open(viewUrl, '_blank');
    }
  };
</script>

<FloatingToolbar>
  <Button variant="ghost" size="icon" title="Reset view" onclick={() => panZoomState.reset()}>
    <ArrowsToCircleIcon />
  </Button>
  <Separator orientation="vertical" />
  <Button
    variant="ghost"
    size="icon"
    class="hidden sm:block"
    onclick={() => panZoomState.zoomOut()}>
    <MagnifyingGlassMinusIcon />
  </Button>
  <Button variant="ghost" size="icon" class="hidden sm:block" onclick={() => panZoomState.zoomIn()}>
    <MagnifyingGlassPlusIcon />
  </Button>
  <Separator orientation="vertical" class="hidden sm:block" />
  <Button
    variant="ghost"
    size="icon"
    title={isPresentationMode ? 'Exit Full Screen' : 'Full Screen'}
    onclick={() => (onPresentationToggle ? onPresentationToggle() : openFullScreen())}>
    {#if isPresentationMode}
      <CloseFullscreenIcon />
    {:else}
      <ExpandIcon />
    {/if}
  </Button>
</FloatingToolbar>
