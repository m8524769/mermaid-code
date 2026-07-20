<script lang="ts">
  import FloatingToolbar from '$/components/FloatingToolbar.svelte';
  import { Button } from '$/components/ui/button';
  import { TID } from '$/constants';
  import { version } from 'mermaid/package.json';
  import { mode, setMode } from 'mode-watcher';
  import ThemeIcon from './ThemeIcon.svelte';
</script>

<FloatingToolbar>
  <span class="text-sm font-semibold opacity-60">v{version}</span>
  <Button
    variant="ghost"
    size="icon"
    data-testid={TID.themeToggleButton}
    title="Switch to {mode.current === 'dark' ? 'light' : 'dark'} theme"
    class="[&_svg]:size-5"
    onclick={() => setMode(mode.current === 'dark' ? 'light' : 'dark')}>
    <ThemeIcon />
  </Button>
</FloatingToolbar>
