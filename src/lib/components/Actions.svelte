<script lang="ts">
  import Card from '$/components/Card/Card.svelte';
  import CopyButton from '$/components/CopyButton.svelte';
  import ExternalLinkWrapper from '$/components/ExternalLinkWrapper.svelte';
  import { Button } from '$/components/ui/button';
  import { Input } from '$/components/ui/input';
  import { Separator } from '$/components/ui/separator';
  import * as ToggleGroup from '$/components/ui/toggle-group';
  import { onMount } from 'svelte';
  import { getDomain } from '$/util/util';
  import { fileState } from '$/util/fileState.svelte';
  import { customDownloadDir } from '$/util/downloadDir.svelte';
  import { openFolderDialog, writeBinaryFile, confirmDialog } from '$/util/fileSystem';
  import { m } from '$/paraglide/messages';
  import { toast } from 'svelte-sonner';
  import { waitForRender } from '$lib/util/autoSync';
  import { inputState, updateCodeStore, urls, validatedState } from '$lib/util/state.svelte';
  import { version as FAVersion } from '@fortawesome/fontawesome-free/package.json';
  import dayjs from 'dayjs';
  import { toBase64, toUint8Array } from 'js-base64';
  import DownloadIcon from '~icons/material-symbols/download';
  import ExternalLinkIcon from '~icons/material-symbols/open-in-new-rounded';
  import WidthIcon from '~icons/material-symbols/width-rounded';
  import FolderIcon from '~icons/material-symbols/folder-open-outline-rounded';
  import ResetIcon from '~icons/material-symbols/restart-alt';

  const FONT_AWESOME_URL = `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${FAVersion}/css/all.min.css`;

  type Exporter = (context: CanvasRenderingContext2D, image: HTMLImageElement) => () => void;

  const getFileName = (extension: string) => {
    const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
    if (activeTab) {
      const stem = activeTab.name.replace(/\.(mmd|mermaid)$/i, '');
      return `${stem}.${extension}`;
    }
    return `mermaid-diagram-${dayjs().format('YYYY-MM-DD-HHmmss')}.${extension}`;
  };

  /**
   * Fix text clipping in exported SVG for hand-drawn (rough) mode.
   * svg2roughjs copies foreignObject elements but their height is often insufficient,
   * causing text bottom edges to be cut off regardless of language.
   */
  const fixForeignObjectClipping = (svg: HTMLElement) => {
    const foreignObjects = svg.querySelectorAll('foreignObject');
    foreignObjects.forEach((foreignObj) => {
      const currentHeight = parseFloat(foreignObj.getAttribute('height') || '0');
      if (currentHeight <= 0) return;

      const currentY = parseFloat(foreignObj.getAttribute('y') || '0');
      const newHeight = currentHeight * 1.5;
      const heightDiff = newHeight - currentHeight;

      foreignObj.setAttribute('height', newHeight.toString());
      foreignObj.setAttribute('y', (currentY - heightDiff / 2).toString());

      // Ensure inner HTML elements are vertically centered within the expanded area
      const htmlElements = foreignObj.querySelectorAll('div, span, p');
      htmlElements.forEach((htmlEl) => {
        const el = htmlEl as HTMLElement;
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.height = '100%';
      });
    });
  };

  const getSvgElement = () => {
    const svgElement = document.querySelector('#container svg')?.cloneNode(true) as HTMLElement;
    svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    return svgElement;
  };

  const getBase64SVG = (
    svg?: HTMLElement,
    width?: number,
    height?: number,
    forCanvas = false
  ): string => {
    if (svg) {
      // Prevents the SVG size of the interface from being changed
      svg = svg.cloneNode(true) as HTMLElement;
    }
    if (height) {
      svg?.setAttribute('height', `${height}px`);
    }
    if (width) {
      svg?.setAttribute('width', `${width}px`);
    }
    // Workaround https://stackoverflow.com/questions/28690643/firefox-error-rendering-an-svg-image-to-html5-canvas-with-drawimage

    if (!svg) {
      svg = getSvgElement();
    }

    if (validatedState.current.rough) {
      fixForeignObjectClipping(svg);
    }

    if (forCanvas) {
      // Remove external hrefs from <a> tags to prevent canvas taint
      svg.querySelectorAll('a').forEach((a) => {
        a.removeAttribute('href');
        a.removeAttribute('xlink:href');
        a.removeAttribute('target');
      });
    }

    svg.style.backgroundColor = window
      .getComputedStyle(document.body)
      .getPropertyValue('--background');

    const svgString = svg.outerHTML
      .replaceAll('<br>', '<br/>')
      .replaceAll(/<img([^>]*)>/g, (m, g: string) => `<img ${g} />`);

    return forCanvas
      ? toBase64(`<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`)
      : toBase64(
          `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet href="${FONT_AWESOME_URL}" type="text/css"?>\n${svgString}`
        );
  };

  // Save export bytes to the download directory (the user-chosen one, or the
  // resolved system download folder by default), prompting before overwriting
  // an existing file. Notifies on success; a cancelled overwrite is a no-op;
  // any failure surfaces an error toast (no silent fallback).
  const saveExport = async (filename: string, bytes: Uint8Array): Promise<void> => {
    try {
      const { downloadDir: sysDownloadDir, join } = await import('@tauri-apps/api/path');
      const { exists } = await import('@tauri-apps/plugin-fs');
      const dir = customDownloadDir.value || defaultDownloadDir || (await sysDownloadDir());
      const target = await join(dir, filename);
      if (await exists(target)) {
        const ok = await confirmDialog(m.actions_overwrite_confirm({ name: filename }));
        if (!ok) return;
      }
      await writeBinaryFile(target, bytes);
      void notifyDownload(dir, target);
    } catch (error) {
      console.error('[Actions] export failed', error);
      toast.error(m.actions_download_failed({ name: filename }));
    }
  };

  const exportImage = async (event: Event, exporter: Exporter) => {
    updateCodeStore({ panZoom: false });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await waitForRender();
    const canvas = document.createElement('canvas');
    const svg = document.querySelector<HTMLElement>('#container svg');
    if (!svg) {
      throw new Error('svg not found');
    }

    const box = svg.getBoundingClientRect();

    // In rough mode, SVG has width/height="100%" so getBoundingClientRect returns
    // the container size, not the actual diagram size. Use viewBox dimensions instead.
    const svgEl = svg as unknown as SVGSVGElement;
    const viewBox = svgEl.viewBox?.baseVal;
    const contentWidth = viewBox && viewBox.width > 0 ? viewBox.width : box.width;
    const contentHeight = viewBox && viewBox.height > 0 ? viewBox.height : box.height;

    if (imageSizeMode === 'width') {
      const ratio = contentHeight / contentWidth;
      canvas.width = imageSize;
      canvas.height = imageSize * ratio;
    } else if (imageSizeMode === 'height') {
      const ratio = contentWidth / contentHeight;
      canvas.width = imageSize * ratio;
      canvas.height = imageSize;
    } else {
      const multiplier = 2;
      canvas.width = contentWidth * multiplier;
      canvas.height = contentHeight * multiplier;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('context not found');
    }

    context.fillStyle = window.getComputedStyle(document.body).getPropertyValue('--background');
    context.fillRect(0, 0, canvas.width, canvas.height);

    const image = new Image();
    image.addEventListener('load', () => {
      exporter(context, image)();
      updateCodeStore({ panZoom: true });
    });
    image.src = `data:image/svg+xml;base64,${getBase64SVG(svg, canvas.width, canvas.height, true)}`;
    // Fallback to set panZoom to true after 2 seconds
    // This is a workaround for the case when the image is not loaded
    setTimeout(() => {
      if (!inputState.panZoom) {
        updateCodeStore({ panZoom: true });
      }
    }, 2000);
    event.stopPropagation();
    event.preventDefault();
  };

  const downloadImage: Exporter = (context, image) => {
    return () => {
      const { canvas } = context;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      void saveExport(getFileName('png'), toUint8Array(dataUrl.split(',')[1]));
    };
  };

  const isClipboardAvailable = (): boolean => {
    return Object.prototype.hasOwnProperty.call(window, 'ClipboardItem');
  };

  const clipboardCopy: Exporter = (context, image) => {
    return () => {
      const { canvas } = context;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Use custom Tauri command: canvas → base64 PNG (~100KB) → Rust decodes → arboard
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('copy_image_to_clipboard', { pngBase64: base64 })
      );
    };
  };

  const onCopyClipboard = async (event?: Event) => {
    if (!event) {
      return;
    }
    try {
      await exportImage(event, clipboardCopy);
    } catch (error) {
      console.error('[Actions] copy failed', error);
      toast.error(m.copy_failed());
    }
  };

  const notifyDownload = async (dir: string, filePath: string) => {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    toast(m.downloaded_to({ dir }), {
      duration: 6000,
      action: { label: m.toast_view(), onClick: () => void revealItemInDir(filePath) }
    });
  };

  const onDownloadPNG = async (event: Event) => {
    try {
      await exportImage(event, downloadImage);
    } catch (error) {
      console.error('[Actions] PNG export failed', error);
      toast.error(m.actions_export_failed());
    }
  };

  const onDownloadSVG = async () => {
    try {
      const base64 = getBase64SVG();
      await saveExport(getFileName('svg'), toUint8Array(base64));
    } catch (error) {
      console.error('[Actions] SVG export failed', error);
      toast.error(m.actions_export_failed());
    }
  };

  const chooseDownloadDir = async () => {
    const dir = await openFolderDialog();
    if (dir) customDownloadDir.value = dir;
  };

  const resetDownloadDir = () => {
    customDownloadDir.value = null;
  };

  let imageSizeMode: 'auto' | 'width' | 'height' = $state('auto');

  $effect(() => {
    if (!imageSizeMode) {
      imageSizeMode = 'auto';
    }
  });

  let imageSize = $state(1080);

  // Resolve the real system download folder once, so the picker shows an actual
  // path by default instead of a generic placeholder. When a custom directory
  // is set it takes precedence.
  let defaultDownloadDir = $state('');
  onMount(async () => {
    try {
      const { downloadDir: sysDownloadDir } = await import('@tauri-apps/api/path');
      defaultDownloadDir = await sysDownloadDir();
    } catch (error) {
      // downloadDir() can reject on Linux when XDG user-dirs aren't configured.
      // Leave defaultDownloadDir empty; saveExport still resolves a target lazily.
      console.error('[Actions] failed to resolve system download folder', error);
    }
  });
  const activeDownloadDir = $derived(customDownloadDir.value ?? defaultDownloadDir);
</script>

{#snippet dualActionButton(text: string, download: (event: Event) => unknown, url?: string)}
  <div class="flex flex-grow gap-0.5">
    <Button
      class={['flex-grow', url && 'rounded-r-none']}
      onclick={download}
      data-testid="download-{text}">
      <DownloadIcon />
      {text}
    </Button>
    <ExternalLinkWrapper domain={getDomain(url)} isVisible={!!url}>
      <Button class="rounded-l-none" href={url} target="_blank" rel="noreferrer noopener">
        <ExternalLinkIcon />
      </Button>
    </ExternalLinkWrapper>
  </div>
{/snippet}

<Card title={m.actions_title()} isStackable icon={{ component: DownloadIcon, class: 'rotate-180' }}>
  <div class="flex min-w-fit flex-col gap-2 p-2">
    <div class="flex w-full items-center gap-2 whitespace-nowrap">
      {m.actions_png_size()}
      <ToggleGroup.Root type="single" variant="outline" bind:value={imageSizeMode}>
        <ToggleGroup.Item value="auto">{m.actions_size_auto()}</ToggleGroup.Item>
        <ToggleGroup.Item value="width">{m.actions_size_width()}</ToggleGroup.Item>
        <ToggleGroup.Item value="height">{m.actions_size_height()}</ToggleGroup.Item>
      </ToggleGroup.Root>
      {#if imageSizeMode !== 'auto'}
        <WidthIcon
          class={['size-6 shrink-0 transition-all', imageSizeMode === 'width' && 'rotate-90']} />
      {/if}
      <Input
        type="number"
        min="3"
        max="10000"
        disabled={imageSizeMode === 'auto'}
        bind:value={imageSize} />
    </div>
    <div class="flex w-full items-center gap-2 whitespace-nowrap">
      <span class="shrink-0">{m.actions_download_to()}</span>
      <Button
        variant="outline"
        class="h-9 min-w-0 flex-grow justify-start gap-1 bg-transparent px-2 font-normal shadow-none hover:bg-primary/80 hover:text-primary-foreground [&_svg]:size-4"
        title={activeDownloadDir || m.actions_choose_folder()}
        onclick={chooseDownloadDir}>
        <FolderIcon />
        <span class="min-w-0 flex-grow truncate">{activeDownloadDir}</span>
      </Button>
      {#if customDownloadDir.value}
        <Button
          variant="outline"
          size="icon"
          class="size-9 shrink-0 bg-transparent shadow-none hover:bg-primary/80 hover:text-primary-foreground"
          title={m.actions_reset_folder()}
          onclick={resetDownloadDir}>
          <ResetIcon />
        </Button>
      {/if}
    </div>
    <div class="flex gap-2">
      {@render dualActionButton('PNG', onDownloadPNG, urls.current.png)}
      {@render dualActionButton('SVG', onDownloadSVG, urls.current.svg)}
    </div>
    <Separator />
    {#if isClipboardAvailable()}
      <CopyButton onclick={onCopyClipboard} label={m.actions_copy_image()} />
    {/if}
  </div>
</Card>
