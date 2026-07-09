<script lang="ts">
  import DesktopEditor from '$/components/DesktopEditor.svelte';
  import McWrapper from '$/components/McWrapper.svelte';
  import MermaidChartIcon from '$/components/MermaidChartIcon.svelte';
  import MobileEditor from '$/components/MobileEditor.svelte';
  import { Button } from '$/components/ui/button';
  import { TID } from '$/constants';
  import { env } from '$/util/env';
  import { fileState } from '$lib/util/fileState.svelte';
  import { updateCode, updateConfig, urls, validatedState } from '$lib/util/state.svelte';
  import { logMermaidChartClick } from '$lib/util/stats';
  import { debounce } from 'lodash-es';
  import ExclamationCircleIcon from '~icons/material-symbols/error-outline-rounded';

  const { isMobile } = $props<{ isMobile: boolean }>();
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
</script>

<div class="flex h-full flex-col">
  {#if validatedState.current.editorMode === 'config'}
    <div class="shrink-0 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      <span class="mb-1 block">Available themes:</span>
      <div class="flex flex-wrap gap-1">
        {#each ['default', 'base', 'dark', 'forest', 'neutral', 'neo', 'neo-dark', 'redux', 'redux-dark'] as theme}
          <code class="rounded bg-muted px-1 py-0.5">{theme}</code>
        {/each}
      </div>
    </div>
  {/if}
  {#if isMobile}
    <MobileEditor {onUpdate} />
  {:else}
    <DesktopEditor {onUpdate} />
  {/if}
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
