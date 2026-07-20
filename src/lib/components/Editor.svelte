<script lang="ts">
  import DesktopEditor from '$/components/DesktopEditor.svelte';
  import McWrapper from '$/components/McWrapper.svelte';
  import MermaidChartIcon from '$/components/MermaidChartIcon.svelte';
  import { Button } from '$/components/ui/button';
  import { TID } from '$/constants';
  import { env } from '$/util/env';
  import { fileState } from '$lib/util/fileState.svelte';
  import {
    updateCode,
    updateCodeStore,
    updateConfig,
    urls,
    validatedState
  } from '$lib/util/state.svelte';
  import { logMermaidChartClick } from '$lib/util/stats';
  import { debounce } from 'lodash-es';
  import ExclamationCircleIcon from '~icons/material-symbols/error-outline-rounded';

  const onUpdate = (text: string) => {
    if (validatedState.current.editorMode === 'code') {
      if (fileState.activeTabId) {
        fileState.updateTabCode(fileState.activeTabId, text);
      }
      updateCode(text);
    } else {
      updateConfig(text);
    }
  };

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

  const THEMES = [
    'default',
    'base',
    'dark',
    'forest',
    'neutral',
    'neo',
    'neo-dark',
    'redux',
    'redux-dark'
  ];
  const LOOKS = ['classic', 'neo'];
  const LAYOUTS = ['dagre', 'elk', 'tidy-tree'];

  const parsedConfig = $derived.by(() => {
    try {
      return JSON.parse(validatedState.current.mermaid || '{}') as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  });

  // Parse YAML frontmatter config from the diagram code
  const frontmatterConfig = $derived.by(() => {
    const match = validatedState.current.code.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {} as Record<string, string>;
    const result: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const m = line.match(/^\s{2}(\w+):\s*(.+)/);
      if (m) result[m[1]] = m[2].trim();
    }
    return result;
  });

  const isOverridden = (key: string) =>
    key in frontmatterConfig && frontmatterConfig[key] !== String(parsedConfig[key] ?? '');

  const setConfigField = (key: string, value: string) => {
    try {
      const config = JSON.parse(validatedState.current.mermaid || '{}') as Record<string, unknown>;
      if (value) {
        config[key] = value;
      } else {
        delete config[key];
      }
      updateConfig(JSON.stringify(config, null, 2));
    } catch {}
  };

  const pinConfigToCode = () => {
    const formFields = ['theme', 'look', 'layout', 'fontFamily'] as const;
    const code = validatedState.current.code;

    // Operate on raw YAML lines to preserve nested objects and other fields
    const applyToFrontmatter = (raw: string): string => {
      const lines = raw.split('\n');
      if (!lines.some((l) => /^config:\s*$/.test(l))) {
        lines.push('config:');
      }
      for (const key of formFields) {
        const val = String(parsedConfig[key] ?? '');
        const idx = lines.findIndex((l) => new RegExp(`^  ${key}:`).test(l));
        if (val) {
          if (idx >= 0) {
            lines[idx] = `  ${key}: ${val}`;
          } else {
            const configIdx = lines.findIndex((l) => /^config:\s*$/.test(l));
            lines.splice(configIdx + 1, 0, `  ${key}: ${val}`);
          }
        } else if (idx >= 0) {
          lines.splice(idx, 1);
        }
      }
      return lines.join('\n');
    };

    const frontmatterMatch = code.match(/^---\n([\s\S]*?)\n---/);
    let updated: string;
    if (frontmatterMatch) {
      const newBody = applyToFrontmatter(frontmatterMatch[1]);
      updated = code.replace(/^---\n[\s\S]*?\n---\n?/, `---\n${newBody}\n---\n`);
    } else {
      const newLines = ['---', 'config:'];
      for (const key of formFields) {
        const val = String(parsedConfig[key] ?? '');
        if (val) newLines.push(`  ${key}: ${val}`);
      }
      newLines.push('---');
      updated = newLines.join('\n') + '\n' + code;
    }

    updateCode(updated, { updateDiagram: true });
    if (fileState.activeTabId) {
      fileState.updateTabCode(fileState.activeTabId, updated);
    }
    // Switch back to code tab so the editor reflects the updated content immediately
    updateCodeStore({ editorMode: 'code' });
  };
</script>

<div class="flex h-full flex-col">
  {#if validatedState.current.editorMode === 'config'}
    <div class="shrink-0 border-b bg-muted/40 px-3 py-2 text-xs">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-theme">Theme</label>
          <select
            id="cfg-theme"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={String(parsedConfig.theme ?? '')}
            onchange={(e) => setConfigField('theme', e.currentTarget.value)}>
            <option value="">— default (default) —</option>
            {#each THEMES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
          {#if isOverridden('theme')}
            <span
              class="shrink-0 text-yellow-500"
              title="Overridden in code: {frontmatterConfig.theme}">⚠</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-look">Look</label>
          <select
            id="cfg-look"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={String(parsedConfig.look ?? '')}
            onchange={(e) => setConfigField('look', e.currentTarget.value)}>
            <option value="">— default (classic) —</option>
            {#each LOOKS as l}
              <option value={l}>{l}</option>
            {/each}
          </select>
          {#if isOverridden('look')}
            <span
              class="shrink-0 text-yellow-500"
              title="Overridden in code: {frontmatterConfig.look}">⚠</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-layout">Layout</label>
          <select
            id="cfg-layout"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={String(parsedConfig.layout ?? '')}
            onchange={(e) => setConfigField('layout', e.currentTarget.value)}>
            <option value="">— auto —</option>
            {#each LAYOUTS as l}
              <option value={l}>{l}</option>
            {/each}
          </select>
          {#if isOverridden('layout')}
            <span
              class="shrink-0 text-yellow-500"
              title="Overridden in code: {frontmatterConfig.layout}">⚠</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-font">Font</label>
          <input
            id="cfg-font"
            type="text"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            placeholder="arial, sans-serif"
            value={String(parsedConfig.fontFamily ?? '')}
            onchange={(e) => setConfigField('fontFamily', e.currentTarget.value)} />
          {#if isOverridden('fontFamily')}
            <span
              class="shrink-0 text-yellow-500"
              title="Overridden in code: {frontmatterConfig.fontFamily}">⚠</span>
          {/if}
        </div>
        <div class="flex justify-end gap-1">
          <button
            class="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Reset config to default"
            onclick={() => updateConfig('{}')}>
            Reset
          </button>
          <button
            class="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Insert config as YAML frontmatter into the diagram code"
            onclick={pinConfigToCode}>
            Pin to code
          </button>
        </div>
      </div>
    </div>
  {/if}
  <DesktopEditor {onUpdate} />
  {#if showError && validatedState.current.error instanceof Error}
    <div class="flex flex-col text-sm" data-testid={TID.errorContainer}>
      <div class="flex items-center justify-between gap-2 bg-slate-900 p-2 text-white">
        <div class="flex w-fit items-center gap-2">
          <ExclamationCircleIcon class="size-6 text-destructive" aria-hidden="true" />
          <div class="flex flex-col">
            <p>Syntax error</p>
            {#if env.isEnabledMermaidChartLinks && validatedState.current.editorMode === 'code'}
              <p class="text-xs text-white/60" data-testid={TID.aiHelpText}>
                Create a free account to repair with AI
              </p>
            {/if}
          </div>
        </div>
        {#if validatedState.current.editorMode === 'code'}
          <McWrapper>
            <Button
              variant="accent"
              size="sm"
              data-testid={TID.aiRepairButton}
              href={urls.current.mermaidChart({ medium: 'ai_repair' }).save}
              target="_blank"
              onclick={() => logMermaidChartClick('aiRepair')}>
              <MermaidChartIcon />
              AI Repair
            </Button>
          </McWrapper>
        {/if}
      </div>
      <output class="max-h-32 overflow-auto bg-muted p-2" name="mermaid-error" for="editor">
        <pre>{validatedState.current.error?.toString()}</pre>
      </output>
    </div>
  {/if}
</div>
