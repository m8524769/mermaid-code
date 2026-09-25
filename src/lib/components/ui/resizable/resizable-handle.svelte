<script lang="ts">
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import * as ResizablePrimitive from 'paneforge';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<ResizablePrimitive.PaneResizerProps> = $props();
</script>

<ResizablePrimitive.PaneResizer
  bind:ref
  class={cn(
    'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:after:left-0 data-[direction=vertical]:after:h-1 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:translate-x-0 data-[direction=vertical]:after:-translate-y-1/2 [&[data-direction=vertical]>div]:rotate-90',
    className
  )}
  {...restProps}>
</ResizablePrimitive.PaneResizer>
