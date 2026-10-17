<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import { Button } from '#lib/components/ui/button/index.js';

  interface Props {
    collapsed?: boolean;
    ontoggle?: () => void;
  }

  let { collapsed = false, ontoggle }: Props = $props();
</script>

<Button variant="secondary" size="sm" onclick={ontoggle}>
  {collapsed ? m.show_code() : m.hide_code()}
</Button>
