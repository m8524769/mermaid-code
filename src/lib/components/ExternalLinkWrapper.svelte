<script lang="ts">
  import { m } from '$/paraglide/messages';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { ComponentProps, Snippet } from 'svelte';
  import ExternalLinkIcon from '~icons/material-symbols/open-in-new-rounded';

  let {
    children,
    domain,
    side = 'bottom',
    labelPrefix,
    isVisible = true,
    sharesData = true,
    showPopup = true
  }: {
    children: Snippet;
    domain: string;
    side?: ComponentProps<typeof Tooltip.Content>['side'];
    labelPrefix?: string;
    isVisible?: boolean;
    sharesData?: boolean;
    showPopup?: boolean;
  } = $props();
</script>

{#if isVisible}
  <Tooltip.Provider>
    <Tooltip.Root delayDuration={100}>
      <Tooltip.Trigger>
        <div>
          {@render children()}
        </div>
      </Tooltip.Trigger>
      {#if showPopup}
        <Tooltip.Content {side} class="bg-secondary shadow-xl">
          <div
            class="flex cursor-help items-center gap-2"
            title={sharesData ? m.ext_will_send() : m.ext_not_shared()}>
            <ExternalLinkIcon />
            <span class="flex items-center gap-1">
              {labelPrefix ?? m.ext_opens_in()}
              <div class="text-accent">{domain}</div>
            </span>
          </div>
        </Tooltip.Content>
      {/if}
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
