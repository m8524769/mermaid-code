<script lang="ts">
  import type { EditorProps } from '$/types';
  import { env } from '$/util/env';
  import { urls, validatedState } from '$/util/state.svelte';
  import { logMermaidChartClick } from '$/util/stats';
  import { fileState } from '$/util/fileState.svelte';
  import { saveFileAs } from '$/util/fileSystem';
  import { AIPromptViewZoneManager } from '$lib/util/AIPromptViewZoneManager';
  import { initEditor } from '$lib/util/monacoExtra';
  import { errorDebug } from '$lib/util/util';
  import debounce from 'lodash-es/debounce';
  import { mode } from 'mode-watcher';
  import * as monaco from 'monaco-editor';
  import monacoEditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import monacoJsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
  import { initVimMode } from 'monaco-vim';
  import { onMount } from 'svelte';
  import AIPromptPopup from './AIPromptPopup.svelte';

  const { onUpdate }: EditorProps = $props();
  const debouncedOnUpdate = debounce((text: string) => onUpdate(text), 100);

  let divElement: HTMLDivElement | undefined = $state();
  let aiPromptPopupElement: HTMLDivElement | undefined = $state();
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let editorOptions = {
    minimap: {
      enabled: false
    },
    overviewRulerLanes: 0,
    glyphMargin: false,
    lineNumbersMinChars: 4
  } satisfies monaco.editor.IStandaloneEditorConstructionOptions;
  let currentText = '';
  let isUpdatingFromState = false;
  let showPopup = $state(false);
  let popupPosition = $state({ top: 0, lineNumber: 0 });
  let decorationsCollection: monaco.editor.IEditorDecorationsCollection | undefined;
  let input = $state('');
  let lastMouseLine = 0;
  const aiPromptManager = new AIPromptViewZoneManager();

  const VIM_MODE_KEY = 'mermaid-vim-mode';
  let vimEnabled = $state(localStorage.getItem(VIM_MODE_KEY) === 'true');
  let vimStatusBarElement: HTMLDivElement | undefined = $state();
  let vimAdapter: ReturnType<typeof initVimMode> | undefined;

  const applyVimMode = (enabled: boolean) => {
    if (!editor) return;
    if (enabled && !vimAdapter) {
      vimAdapter = initVimMode(editor, vimStatusBarElement);
    } else if (!enabled && vimAdapter) {
      vimAdapter.dispose();
      vimAdapter = undefined;
    }
  };

  const toggleVimMode = () => {
    vimEnabled = !vimEnabled;
    localStorage.setItem(VIM_MODE_KEY, String(vimEnabled));
    applyVimMode(vimEnabled);
  };

  const applyEditorTheme = (currentMode: typeof mode.current) => {
    if (!editor) return;
    monaco.editor.setTheme(`mermaid${currentMode === 'dark' ? '-dark' : ''}`);
    divElement?.classList.toggle('mermaid-dark', currentMode === 'dark');
  };

  $effect(() => {
    applyEditorTheme(mode.current);
  });

  const jsonModel = monaco.editor.createModel(
    '',
    'json',
    monaco.Uri.parse('internal://config.json')
  );
  const mermaidModel = monaco.editor.createModel(
    '',
    'mermaid',
    monaco.Uri.parse('internal://mermaid.mmd')
  );

  const renderAIPromptGutterGlyphIcon = () => {
    decorationsCollection?.clear();
    if (!editor || showPopup) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }

    if (lastMouseLine > 0 && model.id === mermaidModel.id) {
      decorationsCollection?.set([
        {
          range: new monaco.Range(lastMouseLine, 1, lastMouseLine, 1),
          options: {
            glyphMarginClassName: 'suggestion-icon'
          }
        }
      ]);
    }
  };

  const closePopup = () => {
    showPopup = false;
    input = '';
    aiPromptManager.hide();
    renderAIPromptGutterGlyphIcon();
  };

  const toggleAIPopup = (lineNumber: number) => {
    if (!divElement || !aiPromptPopupElement) return;
    popupPosition = {
      top: 0,
      lineNumber
    };
    showPopup = !showPopup;
    if (showPopup) {
      aiPromptManager.show(popupPosition.lineNumber, aiPromptPopupElement, 100);
      editor?.setSelection(new monaco.Range(0, 0, 0, 0));
    } else {
      aiPromptManager.hide();
    }
    renderAIPromptGutterGlyphIcon();
  };

  onMount(() => {
    self.MonacoEnvironment = {
      getWorker(_, label) {
        if (label === 'json') {
          return new monacoJsonWorker();
        }
        return new monacoEditorWorker();
      }
    };

    if (!divElement) {
      throw new Error('divEl is undefined');
    }

    monaco.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: true,
      schemas: [
        {
          fileMatch: ['config.json'],
          uri: `${env.docsUrl}/schemas/config.schema.json`
        }
      ]
    });

    initEditor(monaco);
    errorDebug();
    editor = monaco.editor.create(divElement, editorOptions);
    aiPromptManager.setEditor(editor);
    decorationsCollection = editor.createDecorationsCollection([]);

    editor.addAction({
      id: 'file-save',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        if (fileState.activeTabId) {
          void fileState.saveTab(fileState.activeTabId);
        }
      }
    });
    editor.addAction({
      id: 'file-save-as',
      label: 'Save File As',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
      run: () => {
        const tab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
        if (tab) void saveFileAs(tab.code, tab.name);
      }
    });
    editor.addAction({
      id: 'file-close-tab',
      label: 'Close Tab',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW],
      run: () => {
        if (fileState.activeTabId) void fileState.closeTab(fileState.activeTabId);
      }
    });
    editor.addAction({
      id: 'file-new',
      label: 'New File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT],
      run: () => {
        if (fileState.rootPath) void fileState.createFile(fileState.rootPath);
      }
    });

    editor.onMouseDown((e) => {
      const isGutter = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      if (isGutter && e.target.position?.lineNumber === lastMouseLine && lastMouseLine > 0) {
        e.event.preventDefault();
        e.event.stopPropagation();
        toggleAIPopup(e.target.position.lineNumber);
      }
    });

    editor.onDidChangeModelContent(({ isFlush }) => {
      const newText = editor?.getValue();
      if (newText == null || currentText === newText || isFlush || isUpdatingFromState) {
        return;
      }
      currentText = newText;
      debouncedOnUpdate(currentText);
    });

    editor.onMouseMove((e) => {
      if (!editor) return;
      if (showPopup) return;
      if (editor.getModel()?.id !== mermaidModel.id) return;

      lastMouseLine = e.target.position?.lineNumber ?? 0;
      renderAIPromptGutterGlyphIcon();
    });

    editor.onMouseLeave(() => {
      lastMouseLine = 0;
      renderAIPromptGutterGlyphIcon();
    });

    applyEditorTheme(mode.current);

    const resizeObserver = new ResizeObserver((entries) => {
      editor?.layout({
        height: entries[0].contentRect.height,
        width: entries[0].contentRect.width
      });
    });

    if (divElement.parentElement) {
      resizeObserver.observe(divElement);
    }

    renderAIPromptGutterGlyphIcon();

    applyVimMode(vimEnabled);

    return () => {
      vimAdapter?.dispose();
      resizeObserver.disconnect();
      jsonModel.dispose();
      mermaidModel.dispose();
      aiPromptManager.destroy();
      editor?.dispose();
    };
  });

  $effect(() => {
    const { errorMarkers, editorMode, code, mermaid } = validatedState.current;
    if (!editor) {
      return;
    }

    const model = editorMode === 'code' ? mermaidModel : jsonModel;

    if (editor.getModel()?.id !== model.id) {
      editor.setModel(model);
      renderAIPromptGutterGlyphIcon();
    }

    // Clear decorations if not in 'code' mode, or if the model changes
    if (editorMode !== 'code' || editor.getModel()?.id !== mermaidModel.id) {
      decorationsCollection?.clear();
    }

    // Update editor text if it's different
    const newText = editorMode === 'code' ? code : mermaid;
    if (newText !== currentText) {
      isUpdatingFromState = true;
      try {
        editor.setScrollTop(0);
        editor.pushUndoStop();
        editor.executeEdits('updateCode', [
          {
            range: model.getFullModelRange(),
            text: newText
          }
        ]);
        editor.pushUndoStop();
        currentText = newText;
      } finally {
        isUpdatingFromState = false;
      }
      renderAIPromptGutterGlyphIcon();
    }

    // Display/clear errors
    monaco.editor.setModelMarkers(model, 'mermaid', errorMarkers);
  });
</script>

<div class="relative h-full grow overflow-hidden">
  <div bind:this={divElement} id="editor" class="h-full w-full"></div>
  <div bind:this={aiPromptPopupElement}>
    <AIPromptPopup
      show={showPopup}
      bind:input
      onHeightChange={(height) => aiPromptManager.updateHeight(height)}
      onClose={closePopup}
      onTryFree={() => {
        logMermaidChartClick('vibeDiagramming');
        window.open(
          urls.current.mermaidChart({ medium: 'vibe_diagramming' }).save,
          '_blank',
          'noopener'
        );
        closePopup();
      }} />
  </div>
  <div class="absolute bottom-0 left-0 flex w-full items-center bg-muted/80 px-2 text-xs text-muted-foreground">
    <div bind:this={vimStatusBarElement} class="flex-1 font-mono"></div>
    <button
      class="ml-auto cursor-pointer select-none px-1 py-0.5 hover:text-foreground"
      onclick={toggleVimMode}
      title="Toggle Vim mode">
      VIM {vimEnabled ? 'ON' : 'OFF'}
    </button>
  </div>
</div>

<style>
  :global(.suggestion-icon) {
    background-color: #e8eaf9;
    width: 20px !important;
    height: 20px !important;
    margin-left: 4px;
    background-image: url('/icons/use-chat.svg');
    background-size: 16px 16px;
    background-repeat: no-repeat;
    background-position: center;
    border-radius: 4px;
    cursor: pointer;
  }

  :global(#editor.mermaid-dark .suggestion-icon) {
    background-color: #2e4d6b;
    background-image: url('/icons/use-chat-dark.svg');
  }
</style>
