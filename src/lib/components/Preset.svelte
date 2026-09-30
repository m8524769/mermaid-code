<script lang="ts">
  import { m } from '$/paraglide/messages';
  import Card from '$/components/Card/Card.svelte';
  import { Button, buttonVariants } from '$/components/ui/button';
  import * as Popover from '$/components/ui/popover';
  import { getSampleDiagrams, type SampleExample } from '$/util/mermaid';
  import { diagramDisplayName } from '$/util/diagramNames';
  import { updateCode } from '$lib/util/state.svelte';
  import { fileState } from '$lib/util/fileState.svelte';
  import { cn } from '$lib/utils';
  import ShapesIcon from '~icons/material-symbols/account-tree-outline-rounded';
  import ChevronDownIcon from '~icons/material-symbols/keyboard-arrow-down-rounded';

  const samples = { ...getSampleDiagrams() };

  const loadSampleDiagram = (example: SampleExample): void => {
    updateCode(example.code, {
      resetPanZoom: true,
      updateDiagram: true
    });
    if (fileState.activeTabId) {
      fileState.updateTabCode(fileState.activeTabId, example.code);
    }
  };

  // Keyed by canonical diagram id; label() resolves the localized name.
  const mainDiagrams = ['flowchart', 'class', 'sequence', 'er', 'stateDiagram', 'mindmap'];

  const diagramOrder = [
    ...mainDiagrams.filter((id) => samples[id]),
    ...Object.keys(samples)
      .filter((id) => !mainDiagrams.includes(id))
      // Ordered by English name (pinned to 'en'), so the order is identical
      // in every locale — only the displayed labels change.
      .sort((a, b) => samples[a].name.localeCompare(samples[b].name, 'en'))
  ];

  const label = (id: string) => diagramDisplayName(id, samples[id].name);
</script>

<Card title={m.preset_title()} isStackable icon={{ component: ShapesIcon }}>
  <div class="flex h-fit max-h-52 flex-wrap gap-2 overflow-y-auto p-2">
    {#each diagramOrder as id (id)}
      {@const entry = samples[id]}
      <div class="flex min-w-20 flex-grow">
        <Button
          size="sm"
          class={cn('flex-grow normal-case', entry.examples.length > 1 && 'rounded-r-none')}
          onclick={() => loadSampleDiagram(entry.examples[0])}>
          {label(id)}
        </Button>
        {#if entry.examples.length > 1}
          <Popover.Root>
            <Popover.Trigger
              aria-label={m.preset_choose_example({ sample: label(id) })}
              class={cn(
                buttonVariants({ size: 'sm' }),
                'rounded-l-none border-l border-primary-foreground/30 px-0.5 [&_svg]:size-5'
              )}>
              <ChevronDownIcon />
            </Popover.Trigger>
            <Popover.Content align="start" class="flex w-fit flex-col gap-1 p-1">
              {#each entry.examples as example (example.title)}
                <Popover.Close
                  class={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'justify-start normal-case'
                  )}
                  onclick={() => loadSampleDiagram(example)}>
                  {example.title}
                </Popover.Close>
              {/each}
            </Popover.Content>
          </Popover.Root>
        {/if}
      </div>
    {/each}
  </div>
</Card>
