<script lang="ts">
  import type { EditorProps } from '$/types';
  import { env } from '$/util/env';
  import { urls, validatedState } from '$/util/state.svelte';
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
  import { initVimMode, VimMode } from 'monaco-vim';
  import { onMount } from 'svelte';
  import AIPromptPopup from './AIPromptPopup.svelte';
  import ExclamationCircleIcon from '~icons/material-symbols/error-outline-rounded';
  import { TID } from '$/constants';

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
  let isTyping = false;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  let showError = $state(false);

  const showErrorDebounced = debounce(() => {
    showError = true;
  }, 3000);

  $effect(() => {
    if (validatedState.current.error) {
      showErrorDebounced();
    } else {
      showErrorDebounced.cancel();
      showError = false;
    }
    return () => {
      showErrorDebounced.cancel();
    };
  });
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

      // Bridge vim yank to system clipboard by overriding the unnamed register
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Vim = (VimMode as any).Vim;
      if (Vim) {
        const clipboardRegister = {
          text: '',
          linewise: false,
          blockwise: false,
          setText(text: string, linewise: boolean, blockwise: boolean) {
            this.text = text;
            this.linewise = linewise ?? false;
            this.blockwise = blockwise ?? false;
            void navigator.clipboard.writeText(text);
          },
          pushText(text: string, linewise: boolean) {
            this.setText(text, linewise, false);
          },
          clear() {
            this.text = '';
          },
          toString() {
            return this.text;
          }
        };
        // Override unnamed register (") so y/d/c all write to system clipboard
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctrl =
            (Vim as any).getVimGlobalState_?.()?.registerController ??
            (Vim as any).vimGlobalState?.registerController;
          if (ctrl) {
            ctrl.unnamedRegister = clipboardRegister;
            ctrl.registers['"'] = clipboardRegister;
          }
        } catch {
          /* ignore */
        }
        try {
          Vim.defineRegister('+', clipboardRegister);
        } catch {
          /* already defined */
        }
        try {
          Vim.defineRegister('*', clipboardRegister);
        } catch {
          /* already defined */
        }
        // H → ^ (first non-blank), L → $ (end of line)
        for (const m of ['normal', 'visual', 'operator']) {
          Vim.map('H', '^', m);
          Vim.map('L', '$', m);
        }
        Vim.map('jk', '<Esc>', 'insert');
      }
      // Register :w and :write to trigger save (VimMode.Vim not in type defs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (VimMode as any).Vim?.defineEx('write', 'w', () => {
        if (fileState.activeTabId) {
          void fileState.saveTab(fileState.activeTabId);
        } else {
          // No active tab — save as file (same as Save As button in draft mode)
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
          const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
          const defaultName = `Diagram ${date} at ${time}.mmd`;
          void saveFileAs(validatedState.current.code, defaultName).then((handle) => {
            if (handle) void fileState.openFile(handle.path);
          });
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (VimMode as any).Vim?.defineEx('quit', 'q', () => {
        if (fileState.activeTabId) {
          void fileState.closeTab(fileState.activeTabId);
        } else {
          void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
            getCurrentWindow().close()
          );
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (VimMode as any).Vim?.defineEx('wq', 'wq', async () => {
        if (fileState.activeTabId) {
          await fileState.saveTab(fileState.activeTabId);
          void fileState.closeTab(fileState.activeTabId);
        }
      });
    } else if (!enabled && vimAdapter) {
      vimAdapter.dispose();
      vimAdapter = undefined;
    }
    editor.updateOptions({ lineNumbers: enabled ? 'relative' : 'on' });
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
  // Default mermaid model for draft mode (no active tab)
  const defaultMermaidModel = monaco.editor.createModel(
    '',
    'mermaid',
    monaco.Uri.parse('internal://mermaid.mmd')
  );
  // Per-tab models: each tab gets its own model so undo history is isolated
  const tabModels = new Map<string, monaco.editor.ITextModel>();

  const getOrCreateTabModel = (tabId: string, code: string): monaco.editor.ITextModel => {
    let model = tabModels.get(tabId);
    if (!model) {
      model = monaco.editor.createModel(code, 'mermaid');
      tabModels.set(tabId, model);
    }
    return model;
  };

  const getMermaidModel = (): monaco.editor.ITextModel => {
    const activeTabId = fileState.activeTabId;
    if (activeTabId) {
      // Use the tab's actual code (not validatedState.current.code which may be stale during async processState)
      const tabCode =
        fileState.tabs.find((t) => t.id === activeTabId)?.code ?? validatedState.current.code;
      return getOrCreateTabModel(activeTabId, tabCode);
    }
    return defaultMermaidModel;
  };

  const closePopup = () => {
    showPopup = false;
    input = '';
    aiPromptManager.hide();
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
      isTyping = true;
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        isTyping = false;
      }, 300);
      debouncedOnUpdate(currentText);
    });

    editor.onMouseMove((e) => {
      if (!editor) return;
      if (showPopup) return;
      if (editor.getModel()?.id !== getMermaidModel().id) return;

      lastMouseLine = e.target.position?.lineNumber ?? 0;
    });

    editor.onMouseLeave(() => {
      lastMouseLine = 0;
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

    applyVimMode(vimEnabled);

    return () => {
      vimAdapter?.dispose();
      resizeObserver.disconnect();
      jsonModel.dispose();
      defaultMermaidModel.dispose();
      for (const model of tabModels.values()) model.dispose();
      tabModels.clear();
      aiPromptManager.destroy();
      editor?.dispose();
    };
  });

  $effect(() => {
    const { errorMarkers, editorMode, code, mermaid } = validatedState.current;
    if (!editor) {
      return;
    }

    const model = editorMode === 'code' ? getMermaidModel() : jsonModel;

    const modelSwitched = editor.getModel()?.id !== model.id;
    if (modelSwitched) {
      editor.setModel(model);
    }

    // Clear decorations if not in 'code' mode, or if the model changes
    if (editorMode !== 'code' || editor.getModel()?.id !== getMermaidModel().id) {
      decorationsCollection?.clear();
    }

    // Update editor text if it's different
    const newText = editorMode === 'code' ? code : mermaid;
    if (modelSwitched) {
      if (model === jsonModel && newText !== model.getValue()) {
        // jsonModel is always created empty; populate it on first switch to config mode
        model.setValue(newText);
      }
      currentText = model.getValue();
    } else if (!isTyping && newText !== currentText && newText !== model.getValue()) {
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
    }

    // Display/clear errors
    monaco.editor.setModelMarkers(model, 'mermaid', errorMarkers);
  });
</script>

<div class="flex h-full grow flex-col overflow-hidden">
  <div class="relative min-h-0 flex-1">
    <div bind:this={divElement} id="editor" class="h-full w-full"></div>
    <div bind:this={aiPromptPopupElement}>
      <AIPromptPopup
        show={showPopup}
        bind:input
        onHeightChange={(height) => aiPromptManager.updateHeight(height)}
        onClose={closePopup}
        onTryFree={() => {
          window.open(
            urls.current.mermaidChart({ medium: 'vibe_diagramming' }).save,
            '_blank',
            'noopener'
          );
          closePopup();
        }} />
    </div>
  </div>
  {#if showError && validatedState.current.error instanceof Error}
    <div class="flex flex-col text-sm shrink-0" data-testid={TID.errorContainer}>
      <div class="flex items-center gap-2 bg-slate-900 p-2 text-white">
        <ExclamationCircleIcon class="size-5 shrink-0 text-destructive" aria-hidden="true" />
        <p>Syntax error</p>
      </div>
      <output class="overflow-auto bg-muted p-2 text-xs" name="mermaid-error" for="editor">
        <pre
          class="whitespace-pre-wrap break-words">{validatedState.current.error?.toString()}</pre>
      </output>
    </div>
  {/if}
  <div class="flex w-full shrink-0 items-center bg-muted/80 px-2 text-xs text-muted-foreground">
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
