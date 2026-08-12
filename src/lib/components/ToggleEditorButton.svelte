<script lang="ts">
  import { Button } from '$/components/ui/button';

  interface Props {
    collapsed?: boolean;
    ontoggle?: () => void;
  }

  let { collapsed = false, ontoggle }: Props = $props();
</script>

<Button variant="secondary" size="sm" onclick={ontoggle}>
  {collapsed ? 'Show code' : 'Hide code'}
</Button>
