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
  import Navbar from '$/components/Navbar.svelte';
  import TitleBar from '$/components/TitleBar.svelte';
  import PanZoomToolbar from '$/components/PanZoomToolbar.svelte';
  import Preset from '$/components/Preset.svelte';
  import Share from '$/components/Share.svelte';
  import SyncRoughToolbar from '$/components/SyncRoughToolbar.svelte';
  import TabBar from '$/components/TabBar.svelte';
  import { Button } from '$/components/ui/button';
  import * as Resizable from '$/components/ui/resizable';
  import { Toggle } from '$/components/ui/toggle';
  import VersionSecurityToolbar from '$/components/VersionSecurityToolbar.svelte';
  import View from '$/components/View.svelte';
  import type { EditorMode, Tab } from '$/types';
  import { fileState } from '$/util/fileState.svelte';
  import { saveFileAs } from '$/util/fileSystem';
  import { PanZoomState } from '$/util/panZoom';
  import { updateCodeStore, urls, validatedState } from '$/util/state.svelte';
  import { initHandler } from '$/util/util';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import CodeIcon from '~icons/custom/code';
  import FolderIcon from '~icons/material-symbols/folder-outline-rounded';
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
      fileState.clearDraft();
      await fileState.openFile(handle.path);
    }
  };

  let isDraggingOver = $state(false);
  let isWindows = $state(false);
  let _unlistens: (() => void)[] = [];

  onMount(async () => {
    const { platform } = await import('@tauri-apps/plugin-os');
    isWindows = (await platform()) === 'windows';
  });

  onMount(() => {
    return () => {
      _unlistens.forEach((u) => u());
      _unlistens = [];
    };
  });

  onMount(async () => {
    await initHandler();

    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    const { stat } = await import('@tauri-apps/plugin-fs');

    // Listen for files opened via "Open with" or second instance (single-instance plugin)
    const { listen } = await import('@tauri-apps/api/event');

    _unlistens.push(
      await listen<string[]>('open-files', async (event) => {
        for (const path of event.payload) {
          await fileState.openFile(path);
        }
      })
    );

    // MCP: preview diagram in Draft tab
    _unlistens.push(
      await listen<string>('mcp-preview', (event) => {
        fileState.setDraftCode(event.payload);
      })
    );

    // Native File menu events
    _unlistens.push(
      await listen<string>('menu', async (event) => {
        switch (event.payload) {
          case 'open-file': {
            const { openFile } = await import('$/util/fileSystem');
            const result = await openFile();
            if (result) await fileState.openFile(result.handle.path);
            break;
          }
          case 'open-folder':
            await fileState.openFolder();
            break;
          case 'save':
            if (fileState.activeTabId) await fileState.saveTab(fileState.activeTabId);
            break;
          case 'save-as': {
            const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
            if (activeTab?.isDraft) {
              await saveDraftAsFile();
            } else if (activeTab) {
              const handle = await saveFileAs(activeTab.code, activeTab.name);
              if (handle) await fileState.openFile(handle.path);
            }
            break;
          }
          case 'close-tab':
            if (fileState.activeTabId) await fileState.closeTab(fileState.activeTabId);
            break;
          case 'toggle-explorer':
            isSidebarOpen = !isSidebarOpen;
            break;
          case 'toggle-editor':
            if (isEditorCollapsed) {
              editorPane?.expand();
            } else {
              editorPane?.collapse();
            }
            break;
          case 'toggle-presentation':
            await togglePresentationMode();
            break;
          case 'help-github':
          case 'help-issue':
          case 'help-changelog': {
            const urls: Record<string, string> = {
              'help-github': 'https://github.com/m8524769/mermaid-code',
              'help-issue': 'https://github.com/m8524769/mermaid-code/issues/new',
              'help-changelog': 'https://github.com/m8524769/mermaid-code/blob/develop/CHANGELOG.md'
            };
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(urls[event.payload]);
            break;
          }
        }
      })
    );

    getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        isDraggingOver = true;
      } else if (event.payload.type === 'drop') {
        isDraggingOver = false;
        for (const path of event.payload.paths) {
          try {
            const info = await stat(path);
            if (info.isDirectory) {
              await fileState.openFolderByPath(path);
            } else {
              await fileState.openFile(path);
            }
          } catch {
            // ignore unreadable paths
          }
        }
      } else {
        isDraggingOver = false;
      }
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

  if (localStorage.getItem(ONBOARDED_KEY) === null) {
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
  let isPresentationMode = $state(false);
  let isEditorCollapsed = $state(false);

  const togglePresentationMode = async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (isPresentationMode) {
      isPresentationMode = false;
      editorPane?.expand();
      await win.setFullscreen(false);
      setTimeout(() => panZoomState.reset(), 100);
    } else {
      isPresentationMode = true;
      editorPane?.collapse();
      await win.setFullscreen(true);
      setTimeout(() => panZoomState.reset(), 100);
    }
  };

  // ESC key exits presentation mode (needed on Windows; macOS handles via polling)
  $effect(() => {
    if (!isPresentationMode) return;
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void togglePresentationMode();
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  // Poll to detect macOS native fullscreen exit (green button)
  $effect(() => {
    if (!isPresentationMode) return;
    const interval = setInterval(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const isFs = await getCurrentWindow().isFullscreen();
      if (!isFs) {
        isPresentationMode = false;
        editorPane?.expand();
      }
    }, 500);
    return () => clearInterval(interval);
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

<div class="relative flex h-full flex-col overflow-hidden">
  {#if isWindows && !isPresentationMode}
    <TitleBar
      sidebarOpen={isSidebarOpen}
      onToggleSidebar={() => (isSidebarOpen = !isSidebarOpen)} />
  {/if}
  {#if isDraggingOver}
    <div
      class="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]"
      style="pointer-events:none">
      <div
        class="rounded-xl border-2 border-dashed border-muted-foreground bg-background/80 px-8 py-6 text-sm font-medium text-muted-foreground shadow-lg">
        Drop to open
      </div>
    </div>
  {/if}

  <Navbar>
    <div class="relative inline-flex items-center" bind:this={sidebarToggleEl}>
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
    <Share />
    {#if fileState.tabs.find((t) => t.id === fileState.activeTabId && !t.isDraft)}
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
    <McWrapper>
      <Button
        variant="accent"
        size="sm"
        href={urls.current.mermaidChart({ medium: 'save_diagram' }).save}
        target="_blank">
        <MermaidChartIcon />
        Save diagram
      </Button>
    </McWrapper>
  </Navbar>

  <div class="flex flex-1 flex-col overflow-hidden" bind:clientWidth={width}>
    <div class="size-full">
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
        <Resizable.Pane
          bind:this={editorPane}
          defaultSize={30}
          minSize={15}
          collapsible
          collapsedSize={0}
          onCollapse={() => (isEditorCollapsed = true)}
          onExpand={() => (isEditorCollapsed = false)}>
          <div class="flex h-full flex-col">
            <TabBar standalone={!isSidebarOpen} />
            <div class="mt-2 flex min-h-0 flex-1 flex-col">
              <Card
                onselect={tabSelectHandler}
                isOpen
                tabs={editorTabs}
                activeTabID={validatedState.current.editorMode}
                isClosable={false}>
                {#snippet actions()}
                  <DiagramDocButton />
                {/snippet}
                <Editor />
              </Card>

              <div class="group mt-4 flex flex-wrap justify-between gap-4 sm:mt-6 sm:gap-6">
                <Preset />
                <Actions />
              </div>
            </div>
          </div>
        </Resizable.Pane>
        <Resizable.Handle class="hidden opacity-0 sm:block" />
        <Resizable.Pane minSize={15} class="relative flex h-full flex-1 flex-col overflow-hidden">
          <View {panZoomState} shouldShowGrid={validatedState.current.grid} />
          <div class="absolute top-0 left-5 hidden md:block"><EnhancedEditsButton /></div>
          {#if isEditorCollapsed && !isPresentationMode}
            <button
              class="absolute top-1/2 left-0 -translate-y-1/2 flex h-16 w-7 cursor-pointer items-center justify-center rounded-r-lg bg-muted/60 px-1 py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onclick={() => editorPane?.expand()}
              title="Show editor">
              <CodeIcon class="size-4" />
            </button>
          {/if}
          <div class="absolute top-0 right-0">
            <PanZoomToolbar
              {panZoomState}
              onPresentationToggle={togglePresentationMode}
              {isPresentationMode} />
          </div>
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
