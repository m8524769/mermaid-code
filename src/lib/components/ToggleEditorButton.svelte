<script lang="ts">
  import { m } from '$/paraglide/messages';
  import { Button } from '$/components/ui/button';

  interface Props {
    collapsed?: boolean;
    ontoggle?: () => void;
  }

  let { collapsed = false, ontoggle }: Props = $props();
</script>

<Button variant="secondary" size="sm" onclick={ontoggle}>
  {collapsed ? m.show_code() : m.hide_code()}
</Button>
