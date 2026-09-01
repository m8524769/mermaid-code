<script lang="ts">
  import { Button } from '$/components/ui/button';
  import { notify } from '$/util/notify';
  import { m } from '$/paraglide/messages';
  import { scale } from 'svelte/transition';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import CopyIcon from '~icons/material-symbols/content-copy-outline-rounded';

  let {
    onclick,
    label = m.copy()
  }: { onclick: (event?: Event) => Promise<unknown>; label?: string } = $props();

  let showCheckIcon = $state(false);
</script>

<Button
  onclick={async (event) => {
    try {
      showCheckIcon = true;
      setTimeout(() => {
        showCheckIcon = false;
      }, 1000);
      await onclick(event);
    } catch {
      notify(m.copy_failed());
    }
  }}>
  <div class="grid">
    {#key showCheckIcon}
      <span transition:scale class="col-start-1 row-start-1">
        {#if showCheckIcon}
          <CheckIcon />
        {:else}
          <CopyIcon />
        {/if}
      </span>
    {/key}
  </div>
  {label}
</Button>
