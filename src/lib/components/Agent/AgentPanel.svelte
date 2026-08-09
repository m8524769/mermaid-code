<script lang="ts">
  import type { Component } from 'svelte';
  import Card from '$lib/components/Card/Card.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { agentState, type SessionEntry } from '$lib/util/agentState.svelte';
  import { fileState } from '$lib/util/fileState.svelte';
  import { openFolderDialog } from '$lib/util/fileSystem';
  import ClaudeIcon from '~icons/logos/claude-icon';
  import OpenAIIcon from '~icons/logos/openai-icon';
  import CloseIcon from '~icons/material-symbols/close-rounded';
  import SyncAltIcon from '~icons/material-symbols/sync-alt-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import HistoryIcon from '~icons/material-symbols/history-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';

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
  const FOLDER_KEY = 'mermaid-agent-folder';
  const sessionKey = (id: string) => `mermaid-agent-session-${id}`;

  let selectedAgentId = $state(localStorage.getItem(AGENT_KEY) ?? 'claude-code');
  let agentPopoverOpen = $state(false);
  let sessionPopoverOpen = $state(false);

  $effect(() => {
    localStorage.setItem(AGENT_KEY, selectedAgentId);
  });

  const selectedAgent = $derived(agents.find((a) => a.id === selectedAgentId) ?? agents[0]);
  const selectedAgentIcon = $derived(selectedAgent.icon);

  // Working folder: restore from localStorage, then fall back to file explorer or home dir
  let workingFolder = $state<string | null>(
    localStorage.getItem(FOLDER_KEY) ?? fileState.rootPath ?? null
  );

  $effect(() => {
    if (workingFolder) return;
    if (fileState.rootPath) {
      workingFolder = fileState.rootPath;
      return;
    }
    import('@tauri-apps/api/path').then(({ homeDir }) =>
      homeDir().then((h) => {
        if (!workingFolder) workingFolder = h;
      })
    );
  });

  $effect(() => {
    if (workingFolder) localStorage.setItem(FOLDER_KEY, workingFolder);
  });

  const folderName = $derived(
    workingFolder ? (workingFolder.split('/').filter(Boolean).at(-1) ?? workingFolder) : 'No folder'
  );

  const sessions = $derived<SessionEntry[]>(
    workingFolder ? agentState.getSessions(selectedAgentId, workingFolder) : []
  );

  // Load sessions from Tauri whenever agent or folder changes
  $effect(() => {
    if (workingFolder) agentState.loadSessions(selectedAgentId, workingFolder);
  });

  // Active session: null means "new session"; persisted per agent
  let activeSessionId = $state<string | null>(
    localStorage.getItem(sessionKey(localStorage.getItem(AGENT_KEY) ?? 'claude-code'))
  );

  $effect(() => {
    // Persist active session per agent
    const key = sessionKey(selectedAgentId);
    if (activeSessionId) localStorage.setItem(key, activeSessionId);
    else localStorage.removeItem(key);
  });

  $effect(() => {
    // Reset session when folder changes (session belongs to a specific folder)
    workingFolder;
    activeSessionId = localStorage.getItem(sessionKey(selectedAgentId));
  });

  const activeSession = $derived(sessions.find((s) => s.sessionId === activeSessionId) ?? null);

  const sessionLabel = $derived(
    activeSession
      ? (activeSession.firstPrompt?.slice(0, 40) ?? activeSession.sessionId.slice(0, 8))
      : 'New session'
  );

  async function pickFolder() {
    const path = await openFolderDialog();
    if (path) workingFolder = path;
  }
</script>

<Card title={selectedAgent.label} isOpen isClosable={false} icon={{ component: selectedAgentIcon }}>
  {#snippet actions()}
    <div class="flex items-center gap-1">
      <Popover.Root bind:open={agentPopoverOpen}>
        <Popover.Trigger>
          <Button size="icon" variant="ghost" title="Switch agent">
            <SyncAltIcon />
          </Button>
        </Popover.Trigger>
        <Popover.Content align="end" class="flex w-44 flex-col gap-0.5 p-1">
          {#each agents as agent}
            {@const AgentIcon = agent.icon}
            <Popover.Close>
              <button
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                onclick={() => (selectedAgentId = agent.id)}>
                <AgentIcon class="size-4 shrink-0" />
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

  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex items-center gap-0.5 border-b border-muted px-1.5 py-1">
      <!-- Folder picker -->
      <Button
        size="sm"
        variant="ghost"
        class="h-6 max-w-32 gap-1 px-1.5 text-xs"
        onclick={pickFolder}
        title={workingFolder ?? 'Select folder'}>
        <span class="truncate">{folderName}</span>
      </Button>

      <span class="text-xs text-muted-foreground/40">/</span>

      <!-- Session selector -->
      <Popover.Root bind:open={sessionPopoverOpen}>
        <Popover.Trigger class="flex min-w-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            class="h-6 max-w-72 gap-1 px-1.5 text-xs"
            title="Select session">
            <span class="truncate">{sessionLabel}</span>
          </Button>
        </Popover.Trigger>
        <Popover.Content align="start" class="flex w-72 flex-col gap-0.5 p-1">
          <!-- New session -->
          <Popover.Close>
            <button
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              onclick={() => (activeSessionId = null)}>
              <AddIcon class="size-4 shrink-0" />
              <span class="flex-1 text-left">New session</span>
              {#if activeSessionId === null}
                <CheckIcon class="size-4 text-foreground" />
              {/if}
            </button>
          </Popover.Close>
          {#if sessions.length > 0}
            <div class="my-0.5 border-t border-muted"></div>
            {#each sessions as session}
              <Popover.Close>
                <button
                  class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  onclick={() => (activeSessionId = session.sessionId)}>
                  <HistoryIcon class="size-4 shrink-0 text-muted-foreground" />
                  <span class="flex-1 truncate text-left">
                    {session.firstPrompt ?? session.sessionId.slice(0, 8)}
                  </span>
                  {#if session.sessionId === activeSessionId}
                    <CheckIcon class="size-4 text-foreground" />
                  {/if}
                </button>
              </Popover.Close>
            {/each}
          {/if}
        </Popover.Content>
      </Popover.Root>
    </div>

    <!-- Content -->
    <div class="flex flex-1 flex-col gap-2 p-2">
      <p class="text-sm text-muted-foreground">AI Agent panel — coming soon.</p>
    </div>
  </div>
</Card>
