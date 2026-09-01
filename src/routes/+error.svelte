<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { m } from '$/paraglide/messages';
  import { onMount } from 'svelte';

  // Only redirect if it's a 404 error
  onMount(() => {
    if (page.status === 404) {
      goto(resolve('/'));
    }
  });
</script>

{#if page.status !== 404}
  <div class="container mx-auto p-8">
    <h1 class="mb-4 text-2xl font-bold">{m.error_page_title({ status: page.status })}</h1>
    <p class="mb-4">{page.error?.message || m.error_unexpected()}</p>
    <a href={resolve('/')} class="text-blue-500 hover:underline">{m.error_return_home()}</a>
  </div>
{/if}
