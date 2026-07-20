<script lang="ts">
  import MainMenu from '$/components/MainMenu.svelte';
  import { Separator } from '$/components/ui/separator';
  import { updateState } from '$/util/updateState.svelte';
  import { type ComponentProps, type Snippet } from 'svelte';
  import MermaidIcon from '~icons/custom/mermaid';
  import GithubIcon from '~icons/mdi/github';
  import { version as appVersion } from '../../../package.json';
  import DropdownNavMenu from './DropdownNavMenu.svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  type Links = ComponentProps<typeof DropdownNavMenu>['links'];

  const githubLinks: Links = [
    {
      title: 'Mermaid Code',
      href: 'https://github.com/m8524769/mermaid-code'
    },
    { title: 'Mermaid JS', href: 'https://github.com/mermaid-js/mermaid' }
  ];
</script>

<nav class="z-50 flex p-4 sm:p-6">
  <div class="flex flex-1 items-center gap-2">
    <MainMenu />
    <MermaidIcon class="size-6" />
    <div class="flex items-baseline gap-1.5">
      <span class="whitespace-nowrap text-accent"> Mermaid Code </span>
      <span class="text-xs text-muted-foreground">v{appVersion}</span>
      {#if updateState.pendingVersion}
        {#if updateState.downloadProgress === null}
          <button
            class="text-xs text-accent hover:underline"
            title="v{updateState.pendingVersion} is available. Click to download."
            onclick={() => void updateState.download()}>
            ↑ v{updateState.pendingVersion}
          </button>
        {:else if updateState.downloadProgress === 101}
          <button
            class="text-xs text-accent hover:underline"
            title="Ready to install v{updateState.pendingVersion}"
            onclick={() => void updateState.installDownloaded()}>
            ↑ v{updateState.pendingVersion} — Install & Restart
          </button>
        {:else}
          <span class="text-xs text-muted-foreground">
            ↑ v{updateState.pendingVersion} ({updateState.downloadProgress}%)
          </span>
        {/if}
      {:else if updateState.isLatest}
        <span class="text-xs text-muted-foreground/60">✓ latest</span>
      {/if}
    </div>
  </div>
  <div
    id="menu"
    class="hidden flex-nowrap items-center justify-between gap-3 overflow-hidden md:flex">
    <DropdownNavMenu icon={GithubIcon} links={githubLinks} />
    <Separator orientation="vertical" />
    {@render children()}
  </div>
</nav>
