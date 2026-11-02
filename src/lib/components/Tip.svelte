<script lang="ts">
  import * as Tooltip from '#lib/components/ui/tooltip/index.js';
  import type { ComponentProps, Snippet } from 'svelte';

  let {
    children,
    content,
    side = 'top',
    delayDuration
  }: {
    /** Trigger element. Spread the provided `props` onto your own element. */
    children: Snippet<[Record<string, unknown>]>;
    content: string;
    side?: ComponentProps<typeof Tooltip.Content>['side'];
    /** Overrides the global Provider delay for this tooltip only. */
    delayDuration?: number;
  } = $props();
</script>

<Tooltip.Root {delayDuration}>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      {@render children(props)}
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side} class="px-2 py-1">{content}</Tooltip.Content>
</Tooltip.Root>
