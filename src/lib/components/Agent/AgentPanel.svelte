<script lang="ts">
  import type { Component } from 'svelte';
  import Card from '$lib/components/Card/Card.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import ClaudeIcon from '~icons/logos/claude-icon';
  import OpenAIIcon from '~icons/logos/openai-icon';
  import CloseIcon from '~icons/material-symbols/close-rounded';
  import SyncAltIcon from '~icons/material-symbols/sync-alt-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';

  interface AgentOption {
    id: string;
    label: string;
    icon: Component<any>;
  }

  const agents: AgentOption[] = [
    { id: 'claude-code', label: 'Claude Code', icon: ClaudeIcon },
    { id: 'codex', label: 'Codex', icon: OpenAIIcon }
  ];

  interface Props {
    onclose?: () => void;
  }

  let { onclose }: Props = $props();

  const AGENT_KEY = 'mermaid-agent';
  let selectedAgentId = $state(localStorage.getItem(AGENT_KEY) ?? 'claude-code');
  let popoverOpen = $state(false);

  $effect(() => {
    localStorage.setItem(AGENT_KEY, selectedAgentId);
  });

  const selectedAgent = $derived(agents.find((a) => a.id === selectedAgentId) ?? agents[0]);
</script>

<Card
  title={selectedAgent.label}
  isOpen
  isClosable={false}
  icon={{ component: selectedAgent.icon }}>
  {#snippet actions()}
    <div class="flex items-center gap-1">
      <Popover.Root bind:open={popoverOpen}>
        <Popover.Trigger>
          <Button size="icon" variant="ghost" title="Switch agent">
            <SyncAltIcon />
          </Button>
        </Popover.Trigger>
        <Popover.Content align="end" class="flex w-44 flex-col gap-0.5 p-1">
          {#each agents as agent}
            <Popover.Close>
              <button
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                onclick={() => (selectedAgentId = agent.id)}>
                <agent.icon class="size-4 shrink-0" />
                <span class="flex-1 text-left">{agent.label}</span>
                {#if agent.id === selectedAgentId}
                  <CheckIcon class="size-4 text-foreground" />
                {/if}
              </button>
            </Popover.Close>
          {/each}
        </Popover.Content>
      </Popover.Root>
      <Button size="icon" variant="ghost" onclick={onclose} title="Close">
        <CloseIcon />
      </Button>
    </div>
  {/snippet}
  <div class="flex h-full flex-col gap-2 p-2">
    <p class="text-sm text-muted-foreground">AI Agent panel — coming soon.</p>
  </div>
</Card>
