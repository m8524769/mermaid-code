<script lang="ts">
  import { m } from '$/paraglide/messages';
  import DesktopEditor from '$/components/DesktopEditor.svelte';
  import { fileState } from '$lib/util/fileState.svelte';
  import {
    updateCode,
    updateCodeStore,
    updateConfig,
    validatedState
  } from '$lib/util/state.svelte';

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
    const match = validatedState.current.code.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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

    const frontmatterMatch = code.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let updated: string;
    if (frontmatterMatch) {
      const newBody = applyToFrontmatter(frontmatterMatch[1]);
      updated = code.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, `---\n${newBody}\n---\n`);
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
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-theme"
            >{m.config_theme()}</label>
          <select
            id="cfg-theme"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={String(parsedConfig.theme ?? '')}
            onchange={(e) => setConfigField('theme', e.currentTarget.value)}>
            <option value="">{m.config_opt_default({ value: 'default' })}</option>
            {#each THEMES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
          {#if isOverridden('theme')}
            <span
              class="shrink-0 text-yellow-500"
              title={m.config_overridden({ value: frontmatterConfig.theme })}>⚠</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-look"
            >{m.config_look()}</label>
          <select
            id="cfg-look"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={String(parsedConfig.look ?? '')}
            onchange={(e) => setConfigField('look', e.currentTarget.value)}>
            <option value="">{m.config_opt_default({ value: 'classic' })}</option>
            {#each LOOKS as l}
              <option value={l}>{l}</option>
            {/each}
          </select>
          {#if isOverridden('look')}
            <span
              class="shrink-0 text-yellow-500"
              title={m.config_overridden({ value: frontmatterConfig.look })}>⚠</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-layout"
            >{m.config_layout()}</label>
          <select
            id="cfg-layout"
            class="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs"
            value={String(parsedConfig.layout ?? '')}
            onchange={(e) => setConfigField('layout', e.currentTarget.value)}>
            <option value="">{m.config_opt_auto()}</option>
            {#each LAYOUTS as l}
              <option value={l}>{l}</option>
            {/each}
          </select>
          {#if isOverridden('layout')}
            <span
              class="shrink-0 text-yellow-500"
              title={m.config_overridden({ value: frontmatterConfig.layout })}>⚠</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 shrink-0 text-muted-foreground" for="cfg-font"
            >{m.config_font()}</label>
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
              title={m.config_overridden({ value: frontmatterConfig.fontFamily })}>⚠</span>
          {/if}
        </div>
        <div class="flex justify-end gap-1">
          <button
            class="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title={m.config_reset()}
            onclick={() => updateConfig('{}')}>
            {m.reset()}
          </button>
          <button
            class="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title={m.config_pin()}
            onclick={pinConfigToCode}>
            {m.pin_to_code()}
          </button>
        </div>
      </div>
    </div>
  {/if}
  <DesktopEditor {onUpdate} />
</div>
