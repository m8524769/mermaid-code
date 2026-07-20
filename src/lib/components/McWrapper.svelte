<script lang="ts">
  import { env } from '$/util/env';
  import type { ComponentProps } from 'svelte';
  import ExternalLinkWrapper from './ExternalLinkWrapper.svelte';

  let {
    children,
    ...props
  }: Omit<
    ComponentProps<typeof ExternalLinkWrapper>,
    'isVisible' | 'domain' | 'showPopup'
  > = $props();

  const mermaidChartDomain = 'mermaid.ai';
</script>

<ExternalLinkWrapper
  {...props}
  domain={mermaidChartDomain}
  isVisible={env.isEnabledMermaidChartLinks}
  showPopup={true}>
  {@render children()}
</ExternalLinkWrapper>
