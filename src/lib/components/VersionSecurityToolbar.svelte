<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import FloatingToolbar from '#lib/components/FloatingToolbar.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { version } from 'mermaid/package.json';
  import { mode, setMode } from 'mode-watcher';
  import ThemeIcon from './ThemeIcon.svelte';
</script>

<FloatingToolbar>
  <span class="text-sm font-semibold opacity-60">v{version}</span>
  <Button
    variant="ghost"
    size="icon"
    title={mode.current === 'dark' ? m.switch_to_light() : m.switch_to_dark()}
    class="[&_svg]:size-5"
    onclick={() => setMode(mode.current === 'dark' ? 'light' : 'dark')}>
    <ThemeIcon />
  </Button>
</FloatingToolbar>
