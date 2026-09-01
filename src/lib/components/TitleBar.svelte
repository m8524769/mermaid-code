<script lang="ts">
  import { m } from '$/paraglide/messages';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import SidebarOpenIcon from '~icons/material-symbols/left-panel-open-outline-rounded';
  import SidebarCloseIcon from '~icons/material-symbols/left-panel-close-outline-rounded';

  interface Props {
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    platform: string;
  }
  let { sidebarOpen, onToggleSidebar, platform }: Props = $props();

  const win = getCurrentWindow();
  let isMaximized = $state(false);

  win.isMaximized().then((v) => (isMaximized = v));
  win.onResized(() => win.isMaximized().then((v) => (isMaximized = v)));

  const popupMenu = (e: MouseEvent, menuId: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    invoke('popup_submenu', { menuId, x: rect.left, y: rect.bottom });
  };
</script>

{#if platform === 'macos'}
  <div
    class="flex h-9 shrink-0 items-center border-b select-none"
    style="padding-left: env(titlebar-area-x, 72px)"
    data-tauri-drag-region>
    <div class="flex-1" data-tauri-drag-region></div>
    <button
      class="mr-2.5 rounded-md p-1.5 hover:bg-muted"
      onclick={onToggleSidebar}
      title={m.toggle_file_explorer()}>
      {#if sidebarOpen}
        <SidebarCloseIcon class="size-4" />
      {:else}
        <SidebarOpenIcon class="size-4" />
      {/if}
    </button>
  </div>
{/if}

{#if platform === 'windows'}
  <div class="flex h-8 shrink-0 items-stretch border-b text-xs select-none">
    <button class="px-3 hover:bg-muted" onclick={onToggleSidebar} title={m.toggle_file_explorer()}>
      {#if sidebarOpen}
        <SidebarCloseIcon class="size-3.5" />
      {:else}
        <SidebarOpenIcon class="size-3.5" />
      {/if}
    </button>

    <div class="mx-1 my-1.5 w-px bg-border"></div>

    <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'file')}
      >{m.menu_file()}</button>
    <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'view')}
      >{m.menu_view()}</button>
    <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'window')}
      >{m.menu_window()}</button>
    <button class="px-3 hover:bg-muted" onclick={(e) => popupMenu(e, 'help')}
      >{m.menu_help()}</button>

    <div class="flex-1" data-tauri-drag-region></div>

    <button
      class="px-4 hover:bg-muted"
      onclick={() => win.minimize()}
      title={m.titlebar_minimize()}>
      <span style="font-family: 'Segoe MDL2 Assets'; font-size: 10px">&#xE921;</span>
    </button>
    {#if isMaximized}
      <button
        class="px-4 hover:bg-muted"
        onclick={() => win.toggleMaximize()}
        title={m.titlebar_restore()}>
        <span style="font-family: 'Segoe MDL2 Assets'; font-size: 10px">&#xE923;</span>
      </button>
    {:else}
      <button
        class="px-4 hover:bg-muted"
        onclick={() => win.toggleMaximize()}
        title={m.titlebar_maximize()}>
        <span style="font-family: 'Segoe MDL2 Assets'; font-size: 10px">&#xE922;</span>
      </button>
    {/if}
    <button
      class="px-4 hover:bg-destructive hover:text-destructive-foreground"
      onclick={() => win.close()}
      title={m.titlebar_close()}>
      <span style="font-family: 'Segoe MDL2 Assets'; font-size: 10px">&#xE8BB;</span>
    </button>
  </div>
{/if}
