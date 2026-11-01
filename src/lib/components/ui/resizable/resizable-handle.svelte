<script lang="ts">
  import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';
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
    'relative z-10 flex w-px items-center justify-center bg-border transition-opacity after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none data-[active=keyboard]:opacity-100 data-[active=pointer]:opacity-100 data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:after:left-0 data-[direction=vertical]:after:h-2 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:translate-x-0 data-[direction=vertical]:after:-translate-y-1/2 [&[data-direction=vertical]>div]:rotate-90',
    className
  )}
  {...restProps}>
</ResizablePrimitive.PaneResizer>
