<script lang="ts">
  import * as Popover from '$/components/ui/popover';
  import { Switch } from '$/components/ui/switch';
  import { env } from '$/util/env';
  import { m } from '$/paraglide/messages';
  import { setAppLocale, getAppLocale } from '$/util/locale.svelte';
  import { cn } from '$/utils';
  import { mode, setMode } from 'mode-watcher';
  import type { Component, Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import MermaidTailIcon from '~icons/custom/mermaid-tail';
  import BookIcon from '~icons/material-symbols/book-2-outline-rounded';
  import ContrastIcon from '~icons/material-symbols/contrast';
  import MenuIcon from '~icons/material-symbols/menu-rounded';
  import CommunityIcon from '~icons/material-symbols/person-play-outline-rounded';
  import ServerIcon from '~icons/material-symbols/lan-outline-rounded';
  import TranslateIcon from '~icons/material-symbols/translate';

  import { mcpState } from '$/util/mcpState.svelte';

  const MCP_PORT = 37079;

  const toggleMcp = async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    if (mcpState.enabled) {
      invoke('stop_mcp_server');
      mcpState.set(false);
    } else {
      await invoke<number>('start_mcp_server');
      mcpState.set(true);
    }
  };

  // Restore MCP server on mount if previously enabled (only once, not on every toggle)
  onMount(() => {
    if (mcpState.enabled) {
      void (async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke<number>('start_mcp_server');
      })();
    }
  });

  interface MenuItem {
    label: string;
    icon: Component;
    href: string;
    class?: string;
    onclick?: () => void;
    sharesData?: boolean;
    checkDiagramType?: boolean;
    isSectionEnd?: boolean;
    renderer: Snippet<[Omit<MenuItem, 'renderer'>]>;
  }

  const menuItems: MenuItem[] = $derived([
    {
      label: 'Mermaid.js',
      icon: MermaidTailIcon,
      href: env.docsUrl,
      renderer: menuItem
    },
    {
      label: m.menu_documentation(),
      icon: BookIcon,
      href: `${env.docsUrl}/intro/`,
      renderer: menuItem
    },
    {
      label: m.menu_community(),
      icon: CommunityIcon,
      href: 'https://discord.gg/sKeNQX4Wtj',
      renderer: menuItem
    },
    {
      href: '#',
      icon: ContrastIcon,
      isSectionEnd: false,
      label: m.menu_dark_mode(),
      renderer: darkModeMenuItem
    },
    {
      href: '#',
      icon: TranslateIcon,
      isSectionEnd: false,
      label: m.menu_language(),
      renderer: languageMenuItem
    },
    {
      href: '#',
      icon: ServerIcon,
      isSectionEnd: false,
      label: m.menu_mcp_server(),
      renderer: mcpMenuItem
    }
  ]);
</script>

{#snippet menuItem(options: Omit<MenuItem, 'renderer'>)}
  <a
    href={options.href}
    target="_blank"
    onclick={options.onclick}
    class={cn(
      'flex items-center justify-start gap-2 border-b-2 p-2 px-3 hover:bg-muted',
      options.isSectionEnd && 'border-border-dark',
      options.class
    )}>
    <options.icon class="size-5" />
    {options.label}
  </a>
{/snippet}

{#snippet darkModeMenuItem(options: Omit<MenuItem, 'renderer'>)}
  <div
    class={cn(
      'flex cursor-pointer items-center justify-between border-b-2 px-3 py-2 hover:bg-muted',
      options.isSectionEnd && 'border-border-dark',
      options.class
    )}>
    <span class="flex items-center gap-2">
      <ContrastIcon />
      {m.menu_dark_mode()}
    </span>
    <Switch
      checked={mode.current === 'dark'}
      onCheckedChange={(dark) => setMode(dark ? 'dark' : 'light')} />
  </div>
{/snippet}

{#snippet languageMenuItem(options: Omit<MenuItem, 'renderer'>)}
  <div
    class={cn(
      'flex items-center justify-between border-b-2 px-3 py-2 hover:bg-muted',
      options.isSectionEnd && 'border-border-dark',
      options.class
    )}>
    <span class="flex items-center gap-2">
      <TranslateIcon />
      {m.menu_language()}
    </span>
    <div class="flex overflow-hidden rounded-md border">
      <button
        class={cn(
          'px-2 py-0.5 text-xs',
          getAppLocale() === 'en' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
        onclick={() => setAppLocale('en')}>
        English
      </button>
      <button
        class={cn(
          'px-2 py-0.5 text-xs',
          getAppLocale() === 'zh-CN' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
        onclick={() => setAppLocale('zh-CN')}>
        中文
      </button>
    </div>
  </div>
{/snippet}

{#snippet mcpMenuItem(options: Omit<MenuItem, 'renderer'>)}
  <div
    class={cn(
      'flex cursor-pointer items-center justify-between border-b-2 px-3 py-2 hover:bg-muted',
      options.isSectionEnd && 'border-border-dark',
      options.class
    )}
    onclick={toggleMcp}
    onkeydown={(e) => e.key === 'Enter' && toggleMcp()}
    role="button"
    tabindex="0">
    <span class="flex items-center gap-2">
      <ServerIcon />
      <span>
        {m.menu_mcp_server()}
        {#if mcpState.enabled}
          <span class="ml-1 text-xs text-muted-foreground">:{MCP_PORT}</span>
        {/if}
      </span>
    </span>
    <Switch checked={mcpState.enabled} />
  </div>
{/snippet}

<Popover.Root>
  <Popover.Trigger class="shrink-0">
    <MenuIcon class="size-6" />
  </Popover.Trigger>
  <Popover.Content align="start" class="flex flex-col overflow-hidden border-2 p-0" sideOffset={16}>
    {#each menuItems as { renderer, ...item } (item.label)}
      {@render renderer(item)}
    {/each}
  </Popover.Content>
</Popover.Root>
