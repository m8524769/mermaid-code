<script lang="ts">
  import { m } from '$/paraglide/messages';
  import type { EditorProps } from '$/types';
  import { env } from '$/util/env';
  import { validatedState } from '$/util/state.svelte';
  import { fileState } from '$/util/fileState.svelte';
  import { saveFileAs } from '$/util/fileSystem';
  import { initEditor } from '$lib/util/monacoExtra';
  import { errorDebug } from '$lib/util/util';
  import debounce from 'lodash-es/debounce';
  import { mode } from 'mode-watcher';
  import * as monaco from 'monaco-editor';
  import monacoEditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import monacoJsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
  import { initVimMode, VimMode } from 'monaco-vim';
  import { onMount } from 'svelte';
  import ExclamationCircleIcon from '~icons/material-symbols/error-outline-rounded';

  const { onUpdate }: EditorProps = $props();
  const debouncedOnUpdate = debounce((text: string) => onUpdate(text), 100);

  let divElement: HTMLDivElement | undefined = $state();
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
      (VimMode as any).Vim?.defineEx('write', 'w', () => {
        const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
        if (activeTab && !activeTab.isDraft) {
          void fileState.saveTab(activeTab.id);
        } else {
          // Draft tab or no tab — trigger Save As
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
          const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
          const defaultName = `Diagram ${date} at ${time}.mmd`;
          void saveFileAs(validatedState.current.code, defaultName).then((handle) => {
            if (handle) {
              fileState.clearDraft();
              void fileState.openFile(handle.path);
            }
          });
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (VimMode as any).Vim?.defineEx('quit', 'q', () => {
        const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
        if (activeTab && !activeTab.isDraft) {
          void fileState.closeTab(activeTab.id);
        } else if (!activeTab || activeTab.isDraft) {
          // On draft: close the window if no real tabs, otherwise do nothing
          const hasRealTabs = fileState.tabs.some((t) => !t.isDraft);
          if (!hasRealTabs) {
            void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
              getCurrentWindow().close()
            );
          }
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (VimMode as any).Vim?.defineEx('wq', 'wq', async () => {
        const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
        if (activeTab && !activeTab.isDraft) {
          await fileState.saveTab(activeTab.id);
          void fileState.closeTab(activeTab.id);
        } else {
          // Draft tab — Save As then clear draft
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
          const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
          const defaultName = `Diagram ${date} at ${time}.mmd`;
          const handle = await saveFileAs(validatedState.current.code, defaultName);
          if (handle) {
            fileState.clearDraft();
            void fileState.openFile(handle.path);
          }
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

    editor.addAction({
      id: 'file-save',
      label: m.editor_save_file(),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const activeTab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
        if (activeTab?.isDraft) {
          void fileState.saveDraft();
        } else if (fileState.activeTabId) {
          void fileState.saveTab(fileState.activeTabId);
        }
      }
    });
    editor.addAction({
      id: 'file-save-as',
      label: m.editor_save_file_as(),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
      run: () => {
        const tab = fileState.tabs.find((t) => t.id === fileState.activeTabId);
        if (tab) void saveFileAs(tab.code, tab.name);
      }
    });
    editor.addAction({
      id: 'file-close-tab',
      label: m.close_tab(),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW],
      run: () => {
        if (fileState.activeTabId) void fileState.closeTab(fileState.activeTabId);
      }
    });
    editor.addAction({
      id: 'file-new',
      label: m.action_new_file(),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT],
      run: () => {
        if (fileState.rootPath) void fileState.createFile(fileState.rootPath);
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
  </div>
  {#if showError && validatedState.current.error instanceof Error}
    <div class="flex shrink-0 flex-col text-sm">
      <div class="flex items-center gap-2 bg-slate-900 p-2 text-white">
        <ExclamationCircleIcon class="size-5 shrink-0 text-destructive" aria-hidden="true" />
        <p>{m.error_syntax()}</p>
      </div>
      <output class="overflow-auto bg-muted p-2 text-xs" name="mermaid-error" for="editor">
        <pre
          class="break-words whitespace-pre-wrap">{validatedState.current.error?.toString()}</pre>
      </output>
    </div>
  {/if}
  <div class="flex w-full shrink-0 items-center bg-muted/80 px-2 text-xs text-muted-foreground">
    <div bind:this={vimStatusBarElement} class="flex-1 font-mono"></div>
    <button
      class="ml-auto cursor-pointer px-1 py-0.5 select-none hover:text-foreground"
      onclick={toggleVimMode}
      title={m.toggle_vim()}>
      VIM {vimEnabled ? 'ON' : 'OFF'}
    </button>
  </div>
</div>
