<script lang="ts">
  import * as Tooltip from '#lib/components/ui/tooltip/index.js';
  import type { ComponentProps, Snippet } from 'svelte';

  let {
    children,
    content,
    side = 'top',
    delayDuration,
    shortcut
  }: {
    /** Trigger element. Spread the provided `props` onto your own element. */
    children: Snippet<[Record<string, unknown>]>;
    content: string;
    side?: ComponentProps<typeof Tooltip.Content>['side'];
    /** Overrides the global Provider delay for this tooltip only. */
    delayDuration?: number;
    /** Optional keyboard shortcut, rendered as an inline-code chip (e.g. "⌘B"). */
    shortcut?: string;
  } = $props();
</script>

<Tooltip.Root {delayDuration}>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      {@render children(props)}
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side} class="inline-flex items-center gap-2 px-2 py-1">
    {content}
    {#if shortcut}
      <kbd
        class="-mx-0.5 -my-0.5 rounded-md border bg-background px-2 py-1 font-mono text-xs leading-none text-foreground"
        >{shortcut}</kbd>
    {/if}
  </Tooltip.Content>
</Tooltip.Root>
