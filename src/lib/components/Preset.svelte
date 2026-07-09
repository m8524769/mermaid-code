<script lang="ts">
  import Card from '$/components/Card/Card.svelte';
  import { Button, buttonVariants } from '$/components/ui/button';
  import * as Popover from '$/components/ui/popover';
  import { getSampleDiagrams, type SampleExample } from '$/util/mermaid';
  import { updateCode } from '$lib/util/state.svelte';
  import { fileState } from '$lib/util/fileState.svelte';
  import { logEvent } from '$lib/util/stats';
  import { cn } from '$lib/utils';
  import ShapesIcon from '~icons/material-symbols/account-tree-outline-rounded';
  import ChevronDownIcon from '~icons/material-symbols/keyboard-arrow-down-rounded';

  const samples = { ...getSampleDiagrams() };

  const loadSampleDiagram = (diagramType: string, example: SampleExample): void => {
    updateCode(example.code, {
      resetPanZoom: true,
      updateDiagram: true
    });
    if (fileState.activeTabId) {
      fileState.updateTabCode(fileState.activeTabId, example.code);
    }
    logEvent('loadSampleDiagram', { diagramType, exampleTitle: example.title });
  };

  const mainDiagrams = [
    'Flowchart',
    'Class',
    'Sequence',
    'Entity Relationship',
    'State',
    'Mindmap'
  ];

  const diagramOrder = [
    ...mainDiagrams,
    ...Object.keys(samples)
      .filter((key) => !mainDiagrams.includes(key))
      .sort()
  ];
</script>

<Card title="Sample Diagrams" isStackable icon={{ component: ShapesIcon }}>
  <div class="flex h-fit max-h-52 flex-wrap gap-2 overflow-y-auto p-2">
    {#each diagramOrder as sample (sample)}
      {@const examples = samples[sample]}
      <div class="flex min-w-20 flex-grow">
        <Button
          size="sm"
          class={cn('flex-grow normal-case', examples.length > 1 && 'rounded-r-none')}
          onclick={() => loadSampleDiagram(sample, examples[0])}>
          {sample}
        </Button>
        {#if examples.length > 1}
          <Popover.Root>
            <Popover.Trigger
              aria-label="Choose a {sample} example"
              class={cn(
                buttonVariants({ size: 'sm' }),
                'rounded-l-none border-l border-primary-foreground/30 px-0.5 [&_svg]:size-5'
              )}>
              <ChevronDownIcon />
            </Popover.Trigger>
            <Popover.Content align="start" class="flex w-fit flex-col gap-1 p-1">
              {#each examples as example (example.title)}
                <Popover.Close
                  class={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'justify-start normal-case'
                  )}
                  onclick={() => loadSampleDiagram(sample, example)}>
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
