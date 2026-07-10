<script lang="ts">
  import Actions from '$/components/Actions.svelte';
  import Card from '$/components/Card/Card.svelte';
  import DiagramDocButton from '$/components/DiagramDocumentationButton.svelte';
  import Editor from '$/components/Editor.svelte';
  import EnhancedEditsButton from '$/components/EnhancedEditsButton.svelte';
  import FileSidebar from '$/components/FileSidebar.svelte';
  import History from '$/components/History/History.svelte';
  import { startAutoSave } from '$/components/History/historyState.svelte';
  import McWrapper from '$/components/McWrapper.svelte';
  import MermaidChartIcon from '$/components/MermaidChartIcon.svelte';
  import EditorChooserModal from '$/components/migration/EditorChooserModal.svelte';
  import Navbar from '$/components/Navbar.svelte';
  import PanZoomToolbar from '$/components/PanZoomToolbar.svelte';
  import Preset from '$/components/Preset.svelte';
  import Share from '$/components/Share.svelte';
  import SyncRoughToolbar from '$/components/SyncRoughToolbar.svelte';
  import TabBar from '$/components/TabBar.svelte';
  import { Button } from '$/components/ui/button';
  import * as Resizable from '$/components/ui/resizable';
  import { Switch } from '$/components/ui/switch';
  import { Toggle } from '$/components/ui/toggle';
  import VersionSecurityToolbar from '$/components/VersionSecurityToolbar.svelte';
  import View from '$/components/View.svelte';
  import type { EditorMode, Tab } from '$/types';
  import { shouldShowEditorChooser } from '$/util/migration/domainMigration';
  import { PanZoomState } from '$/util/panZoom';
  import { fileState } from '$/util/fileState.svelte';
  import { isTauri, saveFileAs } from '$/util/fileSystem';
  import { validatedState, updateCodeStore, urls } from '$/util/state.svelte';
  import { logEvent, logMermaidChartClick } from '$/util/stats';
  import { initHandler } from '$/util/util';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import CodeIcon from '~icons/custom/code';
  import FolderIcon from '~icons/material-symbols/folder-outline-rounded';
  import HistoryIcon from '~icons/material-symbols/history';
  import GearIcon from '~icons/material-symbols/settings-outline-rounded';

  const panZoomState = new PanZoomState();

  const tabSelectHandler = (tab: Tab) => {
    const editorMode: EditorMode = tab.id === 'code' ? 'code' : 'config';
    updateCodeStore({ editorMode });
  };

  const editorTabs: Tab[] = [
    {
      icon: CodeIcon,
      id: 'code',
      title: 'Code'
    },
    {
      icon: GearIcon,
      id: 'config',
      title: 'Config'
    }
  ];

  let width = $state(0);

  const saveDraftAsFile = async () => {
    const code = validatedState.current.code;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    const defaultName = `Diagram ${date} at ${time}.mmd`;
    const handle = await saveFileAs(code, defaultName);
    if (handle) {
      await fileState.openFile(handle.path);
    }
  };
  let isMobile = $derived(width < 640);
  let isViewMode = $state(true);
  let showEditorChooser = $state(false);

  onMount(async () => {
    showEditorChooser = shouldShowEditorChooser();
    await initHandler();
    window.addEventListener('appinstalled', () => {
      logEvent('pwaInstalled', { isMobile });
    });
  });

  // Record the Timeline for the whole session, not just while the panel is open.
  onMount(() => startAutoSave());

  let isHistoryOpen = $state(false);
  const SIDEBAR_KEY = 'mermaid-sidebar-open';
  const ONBOARDED_KEY = 'mermaid-onboarded';
  let isSidebarOpen = $state(localStorage.getItem(SIDEBAR_KEY) === 'true');
  let showSidebarHint = $state(false);
  let sidebarToggleEl: HTMLElement | undefined = $state();
  let hintRight = $state(0);
  let hintTop = $state(0);

  const updateHintPos = () => {
    if (!sidebarToggleEl) return;
    const r = sidebarToggleEl.getBoundingClientRect();
    hintRight = window.innerWidth - r.right + r.width / 2;
    hintTop = r.bottom + 8;
  };

  if (isTauri() && localStorage.getItem(ONBOARDED_KEY) === null) {
    setTimeout(() => {
      showSidebarHint = true;
    }, 3000);
  }

  $effect(() => {
    if (!showSidebarHint || !sidebarToggleEl) return;
    updateHintPos();
    window.addEventListener('resize', updateHintPos);
    return () => window.removeEventListener('resize', updateHintPos);
  });

  $effect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(isSidebarOpen));
  });

  $effect(() => {
    if (isSidebarOpen && showSidebarHint) {
      showSidebarHint = false;
      localStorage.setItem(ONBOARDED_KEY, '1');
    }
  });

  let editorPane: Resizable.Pane | undefined;
  let sidebarPane: Resizable.Pane | undefined;

  $effect(() => {
    if (isMobile) {
      editorPane?.resize(50);
    }
  });

  $effect(() => {
    const editorSize = editorPane?.getSize() ?? 30;
    if (isSidebarOpen) {
      sidebarPane?.expand();
    } else {
      sidebarPane?.collapse();
    }
    editorPane?.resize(editorSize);
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  {#snippet mobileToggle()}
    <div class="flex items-center gap-2">
      Edit <Switch
        id="editorMode"
        class="data-[state=checked]:bg-accent"
        bind:checked={isViewMode}
        onclick={() => {
          logEvent('mobileViewToggle');
        }} /> View
    </div>
  {/snippet}

  <Navbar mobileToggle={isMobile ? mobileToggle : undefined}>
    <div class="relative" bind:this={sidebarToggleEl}>
      <Toggle
        bind:pressed={isSidebarOpen}
        size="sm"
        title="File Explorer"
        aria-label="File Explorer">
        <FolderIcon />
      </Toggle>
      {#if showSidebarHint}
        <div
          class="fixed z-50 translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md transition-opacity duration-500"
          style="top:{hintTop}px;right:{hintRight}px"
          in:fade={{ duration: 500 }}
          out:fade={{ duration: 300 }}>
          Open File Explorer
          <div class="absolute -top-1 right-1/2 h-2 w-2 translate-x-1/2 rotate-45 bg-primary"></div>
        </div>
      {/if}
    </div>
    <Toggle bind:pressed={isHistoryOpen} size="sm" title="History" aria-label="History">
      <HistoryIcon />
    </Toggle>
    <Share />
    {#if isTauri()}
      {#if fileState.activeTabId}
        <Button
          size="sm"
          variant="accent"
          onclick={() => fileState.saveTab(fileState.activeTabId!)}
          title="Save (⌘S)">
          Save
        </Button>
      {:else}
        <Button size="sm" variant="accent" onclick={saveDraftAsFile} title="Save draft as file">
          Save As
        </Button>
      {/if}
    {/if}
    <McWrapper>
      <Button
        variant="accent"
        size="sm"
        href={urls.current.mermaidChart({ medium: 'save_diagram' }).save}
        target="_blank"
        onclick={() => logMermaidChartClick('saveDiagram')}>
        <MermaidChartIcon />
        Save diagram
      </Button>
    </McWrapper>
  </Navbar>

  <div class="flex flex-1 flex-col overflow-hidden" bind:clientWidth={width}>
    <div
      class={[
        'size-full',
        isMobile && ['w-[200%] duration-300', isViewMode && '-translate-x-1/2']
      ]}>
      <Resizable.PaneGroup
        direction="horizontal"
        autoSaveId="liveEditor-v2"
        class="gap-4 p-2 pt-0 sm:gap-0 sm:p-6 sm:pt-0">
        <Resizable.Pane
          collapsible
          collapsedSize={0}
          minSize={12}
          defaultSize={18}
          class="hidden h-full flex-col sm:flex"
          bind:this={sidebarPane}>
          <FileSidebar />
        </Resizable.Pane>
        <Resizable.Handle class="hidden opacity-0 sm:block" />
        <Resizable.Pane bind:this={editorPane} defaultSize={30} minSize={15}>
          <div class="flex h-full flex-col gap-4 sm:gap-6">
            <TabBar />
            <Card
              onselect={tabSelectHandler}
              isOpen
              tabs={editorTabs}
              activeTabID={validatedState.current.editorMode}
              isClosable={false}>
              {#snippet actions()}
                <DiagramDocButton />
              {/snippet}
              <Editor {isMobile} />
            </Card>

            <div class="group flex flex-wrap justify-between gap-4 sm:gap-6">
              <Preset />
              <Actions />
            </div>
          </div>
        </Resizable.Pane>
        <Resizable.Handle class="hidden opacity-0 sm:block" />
        <Resizable.Pane minSize={15} class="relative flex h-full flex-1 flex-col overflow-hidden">
          <View {panZoomState} shouldShowGrid={validatedState.current.grid} />
          <div class="absolute top-0 left-5 hidden md:block"><EnhancedEditsButton /></div>
          <div class="absolute top-0 right-0"><PanZoomToolbar {panZoomState} /></div>
          <div class="absolute right-0 bottom-0"><VersionSecurityToolbar /></div>
          <div class="absolute bottom-0 left-0 sm:left-5"><SyncRoughToolbar /></div>
        </Resizable.Pane>
        {#if isHistoryOpen}
          <Resizable.Handle class="ml-1 hidden opacity-0 sm:block" />
          <Resizable.Pane minSize={15} defaultSize={30} class="hidden h-full grow flex-col sm:flex">
            <History />
          </Resizable.Pane>
        {/if}
      </Resizable.PaneGroup>
    </div>
  </div>
</div>

<EditorChooserModal bind:open={showEditorChooser} />
