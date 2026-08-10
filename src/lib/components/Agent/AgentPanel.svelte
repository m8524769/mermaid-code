<script lang="ts">
  import type { Component } from 'svelte';
  import { tick } from 'svelte';
  import Card from '$lib/components/Card/Card.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { agentState, slices, type SessionEntry } from '$lib/util/agentState.svelte';
  import { fileState } from '$lib/util/fileState.svelte';
  import { openFolderDialog } from '$lib/util/fileSystem';
  import { renderMarkdown } from '$lib/util/markdown';
  import { untrack } from 'svelte';
  import ClaudeIcon from '~icons/logos/claude-icon';
  import OpenAIIcon from '~icons/logos/openai-icon';
  import CloseIcon from '~icons/material-symbols/close-rounded';
  import SyncAltIcon from '~icons/material-symbols/sync-alt-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import HistoryIcon from '~icons/material-symbols/history-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import SendIcon from '~icons/material-symbols/send-rounded';
  import StopIcon from '~icons/material-symbols/stop-rounded';

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

  // Start event listener for agent events
  agentState.init();

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
    workingFolder ? (slices[selectedAgentId]?.folderSessions[workingFolder] ?? []) : []
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
    // Reset session and clear messages when folder or agent changes
    // Do NOT read runId here — it would re-trigger this effect when run exits
    const agent = selectedAgentId;
    void workingFolder;
    activeSessionId = localStorage.getItem(sessionKey(agent));
    untrack(() => agentState.clearMessages(agent));
  });

  const runId = $derived(slices[selectedAgentId]?.activeRunId ?? null);

  // Load history when switching to an existing session
  $effect(() => {
    if (!workingFolder || !activeSessionId) {
      untrack(() => agentState.clearMessages(selectedAgentId));
      return;
    }
    if (runId) return; // run is writing to messages — wait until it finishes
    if (activeSessionId === liveSessionId) return; // still on the live session, preserve messages
    untrack(() => {
      liveSessionId = null; // user navigated away from live session
      agentState.clearMessages(selectedAgentId);
    });
    agentState.loadSessionHistory(selectedAgentId, workingFolder, activeSessionId);
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

  let inputText = $state('');
  let sending = $state(false);
  let imeActive = false;
  let imeSkipNextEnter = false;
  let pendingFirstMessage: string | null = null;
  let liveSessionId: string | null = null; // which session has live messages

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || !workingFolder || sending) return;
    inputText = '';
    sending = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (!runId) {
        const isResume = !!activeSessionId;
        if (!isResume) pendingFirstMessage = text;
        const existingMessages = isResume ? [...(slices[selectedAgentId]?.messages ?? [])] : [];
        const id: string = await invoke('start_agent_session', {
          params: {
            prompt: text,
            folder_path: workingFolder,
            agent_type: selectedAgentId,
            resume_session_id: activeSessionId ?? null
          }
        });
        agentState.registerRun(selectedAgentId, id);
        if (isResume && activeSessionId) liveSessionId = activeSessionId;
        agentState.getSlice(selectedAgentId).messages = [
          ...existingMessages,
          { id: `user-${id}`, role: 'user', text }
        ];
      } else {
        await invoke('send_agent_message', { runId, content: text });
      }
    } catch (e) {
      console.error('[agent] sendMessage error:', e);
    } finally {
      sending = false;
    }
  }

  async function interruptRun() {
    if (!runId) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_message', { runId, content: '\x03' });
    } catch (e) {}
  }

  const messages = $derived(slices[selectedAgentId]?.messages ?? []);

  // Sync session_id from slice (set by session_ready event) to local state
  $effect(() => {
    const newSessionId = slices[selectedAgentId]?.activeSessionId;
    if (newSessionId && workingFolder) {
      agentState.injectSession(selectedAgentId, workingFolder, {
        sessionId: newSessionId,
        firstPrompt: pendingFirstMessage
      });
      pendingFirstMessage = null;
      liveSessionId = newSessionId;
      // Only update activeSessionId if we're still in a live run for this agent
      // (prevents a delayed session_ready from stealing focus after user switched away)
      if (runId && activeSessionId !== newSessionId) {
        activeSessionId = newSessionId;
      }
      slices[selectedAgentId].activeSessionId = null;
    }
  });

  // When run ends, refresh session list so firstPrompt is populated from the written JSONL
  $effect(() => {
    if (!runId && workingFolder) {
      setTimeout(() => agentState.loadSessions(selectedAgentId, workingFolder!), 500);
    }
  });

  let messagesEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    messages;
    tick().then(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  });
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
            <div class="flex max-h-64 flex-col overflow-y-auto">
              {#each sessions as session}
                <Popover.Close class="contents">
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
            </div>
          {/if}
        </Popover.Content>
      </Popover.Root>
    </div>

    <!-- Content -->
    <div bind:this={messagesEl} class="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
      {#if messages.length === 0}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center select-none">
          <div class="rounded-2xl bg-muted p-4">
            <svelte:component this={selectedAgentIcon} class="size-8 opacity-40" />
          </div>
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium text-foreground/60">{selectedAgent.label}</p>
            <p class="text-xs text-muted-foreground">
              {activeSessionId ? 'No messages in this session.' : 'Start a conversation below.'}
            </p>
          </div>
        </div>
      {:else}
        {#each messages as msg (msg.id)}
          <div class={['flex flex-col gap-0.5', msg.role === 'user' ? 'items-end' : 'items-start']}>
            {#if msg.role === 'user'}
              <div
                class="max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground">
                {msg.text}
              </div>
            {:else if msg.role === 'assistant'}
              {#if msg.thinking}
                <details class="max-w-[85%] rounded-xl border border-muted-foreground/20 text-xs">
                  <summary
                    class="cursor-pointer px-3 py-1.5 text-muted-foreground select-none hover:text-foreground">
                    Thinking
                  </summary>
                  <div
                    class="border-t border-muted-foreground/20 px-3 py-2 break-words whitespace-pre-wrap text-muted-foreground">
                    {msg.thinking}
                  </div>
                </details>
              {/if}
              {#if msg.isStreaming}
                <div
                  class="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap text-foreground">
                  {msg.text}
                </div>
              {:else}
                {#await renderMarkdown(msg.text)}
                  <div
                    class="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap text-foreground">
                    {msg.text}
                  </div>
                {:then html}
                  <div
                    class="prose prose-sm max-w-[85%] rounded-xl bg-muted px-3 py-2 dark:prose-invert [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-0">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html html}
                  </div>
                {/await}
              {/if}
            {:else}
              <div
                class="max-w-[85%] rounded-xl bg-muted/50 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {msg.text}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Input -->
    <div class="flex gap-1 border-t border-muted p-2">
      <textarea
        bind:value={inputText}
        placeholder="Message..."
        rows="1"
        style="field-sizing: content; max-height: 8lh;"
        class="flex-1 resize-none rounded-lg bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        oncompositionstart={() => (imeActive = true)}
        oncompositionend={() => {
          imeActive = false;
          imeSkipNextEnter = true;
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !imeActive) {
            if (imeSkipNextEnter) {
              imeSkipNextEnter = false;
              return;
            }
            e.preventDefault();
            if (!runId) sendMessage();
          }
        }}></textarea>
      <button
        onclick={runId ? interruptRun : sendMessage}
        class="rounded-lg bg-primary p-2 text-primary-foreground hover:opacity-80 disabled:opacity-40"
        disabled={sending || (!runId && !inputText.trim())}>
        {#if runId}
          <StopIcon class="size-4" />
        {:else}
          <SendIcon class="size-4" />
        {/if}
      </button>
    </div>
  </div>
</Card>
