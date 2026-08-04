<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import SidebarIcon from '~icons/material-symbols/view-sidebar-outline-rounded';

  interface Props {
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
  }
  let { sidebarOpen, onToggleSidebar }: Props = $props();

  const win = getCurrentWindow();

  const popupMenu = (e: MouseEvent, menuId: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    invoke('popup_submenu', { menuId, x: rect.left, y: rect.bottom });
  };
</script>

<div class="flex h-8 shrink-0 select-none items-stretch border-b text-xs">
  <button
    class={[
      'px-3 hover:bg-muted',
      sidebarOpen && 'text-foreground',
      !sidebarOpen && 'text-muted-foreground'
    ]}
    onclick={onToggleSidebar}
    title="Toggle File Explorer">
    <SidebarIcon class="size-3.5" />
  </button>

  <div class="mx-1 my-1.5 w-px bg-border"></div>

  <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'file')}> File </button>
  <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'view')}> View </button>
  <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'window')}> Window </button>

  <div class="flex-1" data-tauri-drag-region></div>

  <button class="px-4 hover:bg-muted" onclick={() => win.minimize()} title="Minimize">
    &#x2212;
  </button>
  <button class="px-4 hover:bg-muted" onclick={() => win.toggleMaximize()} title="Maximize">
    &#x25A1;
  </button>
  <button
    class="px-4 hover:bg-destructive hover:text-destructive-foreground"
    onclick={() => win.close()}
    title="Close">
    &#x2715;
  </button>
</div>
