<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';

  onMount(async () => {
    await goto(resolve('/edit'), { replaceState: true });
  });
</script>
