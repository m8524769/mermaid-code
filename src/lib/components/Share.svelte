<script lang="ts">
  import { m } from '$/paraglide/messages';
  import { buttonVariants } from '$/components/ui/button';
  import { Separator } from '$/components/ui/separator';
  import * as Dialog from '$/components/ui/dialog';
  import { urls } from '$/util/state.svelte';
  import { asset } from '$app/paths';
  import ShareIcon from '~icons/material-symbols/share';
  import CopyInput from './CopyInput.svelte';
</script>

<Dialog.Root>
  <Dialog.Trigger class={buttonVariants({ size: 'sm' })}>{m.share_button()}</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-xl">
        <ShareIcon class="size-5" />
        {m.share_title()}
      </Dialog.Title>
      <Dialog.Description>{m.share_description()}</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <h2 class="flex items-center gap-2">
          <img class="size-5" src={asset('/favicon.svg')} alt="Mermaid Live Editor" />
          Mermaid Live Editor
        </h2>
        <CopyInput value={urls.current.edit} />
        <Dialog.Description>
          {m.share_privacy_note()}
        </Dialog.Description>
      </div>
      {#if urls.current.kroki}
        <Separator />
        <div class="flex flex-col gap-2">
          <h2 class="flex items-center gap-2">
            <img class="size-5 dark:invert" src={asset('/kroki.png')} alt="Kroki" />
            Kroki
          </h2>
          <CopyInput value={urls.current.kroki} />
          <Dialog.Description>
            {m.share_kroki_note()}
          </Dialog.Description>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
