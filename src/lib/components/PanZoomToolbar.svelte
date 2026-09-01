<script lang="ts">
  import { m } from '$/paraglide/messages';
  import FloatingToolbar from '$/components/FloatingToolbar.svelte';
  import { Button } from '$/components/ui/button';
  import { Separator } from '$/components/ui/separator';
  import type { PanZoomState } from '$/util/panZoom';
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
    onPresentationToggle: () => void;
    isPresentationMode?: boolean;
  } = $props();
</script>

<FloatingToolbar>
  <Button variant="ghost" size="icon" title={m.reset_view()} onclick={() => panZoomState.reset()}>
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
    title={isPresentationMode ? m.exit_full_screen() : m.full_screen()}
    onclick={() => onPresentationToggle()}>
    {#if isPresentationMode}
      <CloseFullscreenIcon />
    {:else}
      <ExpandIcon />
    {/if}
  </Button>
</FloatingToolbar>
