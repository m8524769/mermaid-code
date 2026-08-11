<script lang="ts">
  import type { Component } from 'svelte';
  import { tick } from 'svelte';
  import Card from '$lib/components/Card/Card.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { agentState, slices, type SessionEntry } from '$lib/util/agentState.svelte';
  import { fileState } from '$lib/util/fileState.svelte';
  import { mcpState } from '$lib/util/mcpState.svelte';
  import { openFolderDialog } from '$lib/util/fileSystem';
  import { renderMarkdown } from '$lib/util/markdown';
  import { untrack } from 'svelte';
  import ClaudeIcon from '~icons/logos/claude-icon';
  import CloseIcon from '~icons/material-symbols/close-rounded';
  import SyncAltIcon from '~icons/material-symbols/sync-alt-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import HistoryIcon from '~icons/material-symbols/history-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import SendIcon from '~icons/material-symbols/send-rounded';
  import StopIcon from '~icons/material-symbols/stop-rounded';
  import LockIcon from '~icons/material-symbols/lock-rounded';
  import DeleteIcon from '~icons/material-symbols/delete-outline-rounded';
  import AttachFileIcon from '~icons/material-symbols/attach-file-rounded';
  import CodeBracketIcon from '~icons/material-symbols/code-rounded';

  interface AgentOption {
    id: string;
    label: string;
    icon: Component<any>;
  }

  const agents: AgentOption[] = [
    { id: 'claude-code', label: 'Claude Code', icon: ClaudeIcon }
    // { id: 'codex', label: 'Codex', icon: OpenAIIcon }
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
    if (fileState.rootPath) workingFolder = fileState.rootPath;
  });

  $effect(() => {
    if (workingFolder) localStorage.setItem(FOLDER_KEY, workingFolder);
  });

  const folderName = $derived(
    workingFolder
      ? (workingFolder.split(/[/\\]/).filter(Boolean).at(-1) ?? workingFolder)
      : 'No folder'
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
  const isProcessing = $derived(slices[selectedAgentId]?.isProcessing ?? false);

  // Load history when switching to an existing session
  $effect(() => {
    if (!workingFolder || !activeSessionId) {
      untrack(() => {
        liveSessionId = null;
        agentState.clearMessages(selectedAgentId);
        const rid = slices[selectedAgentId]?.activeRunId;
        if (rid) void killRun(rid);
      });
      return;
    }
    if (isProcessing) return; // mid-turn: wait until Claude finishes responding
    if (activeSessionId === liveSessionId) return; // still on the live session, preserve messages
    untrack(() => {
      liveSessionId = null;
      agentState.clearMessages(selectedAgentId);
      // Kill any run from the previous session before loading the new one
      const rid = slices[selectedAgentId]?.activeRunId;
      if (rid) void killRun(rid);
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
  let imeSkipNextEnter = false;
  let pendingFirstMessage: string | null = null;
  let liveSessionId: string | null = null;
  let cliAvailable = $state<boolean | null>(null);

  $effect(() => {
    const agentId = selectedAgentId;
    cliAvailable = null;
    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      cliAvailable = await invoke<boolean>('check_agent_cli', { agentType: agentId });
    })();
  });

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
        // Persistent process alive — send next turn via stdin
        const slice = agentState.getSlice(selectedAgentId);
        slice.messages = [
          ...slice.messages,
          { id: `user-${Date.now()}`, role: 'user' as const, text }
        ];
        slice.isProcessing = true;
        await invoke('send_agent_message', { runId, content: text });
      }
    } catch (e) {
      console.error('[agent] sendMessage error:', e);
      const s = agentState.getSlice(selectedAgentId);
      s.errorMsg = e instanceof Error ? e.message : String(e);
      s.isProcessing = false;
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

  async function killRun(id: string) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('kill_agent_run', { runId: id });
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

  // Refresh session list after each turn completes (isProcessing: true→false) or when process exits
  let _wasProcessing = false;
  $effect(() => {
    const processing = isProcessing;
    const folder = workingFolder;
    const agent = selectedAgentId;
    if (_wasProcessing && !processing && folder) {
      setTimeout(() => agentState.loadSessions(agent, folder), 500);
    }
    _wasProcessing = processing;
  });
  $effect(() => {
    if (!runId && workingFolder) {
      setTimeout(() => agentState.loadSessions(selectedAgentId, workingFolder!), 500);
    }
  });

  const pendingPermission = $derived(slices[selectedAgentId]?.pendingPermission ?? null);
  const outputTokens = $derived(slices[selectedAgentId]?.outputTokens ?? 0);
  const lastCostUsd = $derived(slices[selectedAgentId]?.lastCostUsd ?? null);
  const errorMsg = $derived(slices[selectedAgentId]?.errorMsg ?? null);

  async function allowPermission() {
    if (!pendingPermission || !runId) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('respond_agent_permission', {
        runId,
        requestId: pendingPermission.requestId,
        approved: true,
        toolInput: pendingPermission.toolInput ?? null
      });
      slices[selectedAgentId].pendingPermission = null;
    } catch (e) {
      console.error('[agent] allowPermission error:', e);
    }
  }

  async function denyPermission() {
    if (!pendingPermission || !runId) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('respond_agent_permission', {
        runId,
        requestId: pendingPermission.requestId,
        approved: false,
        toolInput: null
      });
      slices[selectedAgentId].pendingPermission = null;
    } catch (e) {
      console.error('[agent] denyPermission error:', e);
    }
  }

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
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isProcessing || undefined}
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
              {#each sessions as session (session.sessionId)}
                <div class="group flex items-center rounded-lg hover:bg-muted">
                  <Popover.Close class="contents">
                    <button
                      class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={(isProcessing && session.sessionId !== activeSessionId) ||
                        undefined}
                      onclick={() => (activeSessionId = session.sessionId)}>
                      <HistoryIcon class="size-4 shrink-0 text-muted-foreground" />
                      <span class="flex-1 truncate text-left">
                        {session.firstPrompt ?? session.sessionId.slice(0, 8)}
                      </span>
                      {#if session.sessionId === activeSessionId}
                        <CheckIcon class="size-4 shrink-0 text-foreground" />
                      {/if}
                    </button>
                  </Popover.Close>
                  {#if session.sessionId !== activeSessionId}
                    {@const sid = session.sessionId}
                    <button
                      class="mr-1 hidden shrink-0 rounded-sm p-1 text-muted-foreground/50 group-hover:flex hover:bg-background hover:text-destructive"
                      title="Delete session"
                      onclick={async () => {
                        try {
                          await agentState.deleteSession(selectedAgentId, workingFolder!, sid);
                          if (sid === activeSessionId) activeSessionId = null;
                        } catch (e) {
                          agentState.getSlice(selectedAgentId).errorMsg =
                            e instanceof Error ? e.message : 'Failed to delete session.';
                        }
                      }}>
                      <DeleteIcon class="size-3.5" />
                    </button>
                  {/if}
                </div>
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
            {#each [selectedAgentIcon] as AgentIcon}
              <AgentIcon class="size-8 opacity-40" />
            {/each}
          </div>
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium text-foreground/60">{selectedAgent.label}</p>
            <p class="text-xs text-muted-foreground">
              {#if !workingFolder}
                Select a folder to get started.
              {:else if activeSessionId}
                No messages in this session.
              {:else}
                Start a conversation below.
              {/if}
            </p>
          </div>
        </div>
      {:else}
        {#each messages as msg (msg.id)}
          <div class={['flex flex-col gap-0.5', msg.role === 'user' ? 'items-end' : 'items-start']}>
            {#if msg.role === 'user'}
              {#if msg.openedFiles && msg.openedFiles.length > 0}
                <div class="flex max-w-[85%] flex-wrap gap-1">
                  {#each msg.openedFiles as file}
                    <span
                      class="flex items-center gap-0.5 rounded-md border border-muted bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      <AttachFileIcon class="size-3 shrink-0" />{file.split(/[/\\]/).at(-1)}
                    </span>
                  {/each}
                </div>
              {/if}
              {#if msg.selectedCode && msg.selectedCode.length > 0}
                <div class="flex max-w-[85%] flex-wrap gap-1">
                  {#each msg.selectedCode as sel}
                    <span
                      class="flex items-center gap-0.5 rounded-md border border-muted bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                      title="{sel.file}:{sel.startLine}-{sel.endLine}">
                      <CodeBracketIcon class="size-3 shrink-0" />{sel.symbol ??
                        sel.file.split(/[/\\]/).at(-1)}:{sel.startLine}-{sel.endLine}
                    </span>
                  {/each}
                </div>
              {/if}
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
            {:else if msg.role === 'tool_use'}
              <details class="max-w-[85%] rounded-xl border border-muted-foreground/20 text-xs">
                <summary
                  class="flex cursor-pointer items-baseline gap-1.5 px-3 py-1.5 select-none hover:text-foreground">
                  <span class="size-1.5 shrink-0 self-center rounded-full bg-muted-foreground/50"
                  ></span>
                  <span class="font-medium text-muted-foreground">{msg.toolName ?? 'tool'}</span>
                  {#if msg.text}
                    {@const input = (() => {
                      try {
                        return JSON.parse(msg.text);
                      } catch {
                        return null;
                      }
                    })()}
                    {@const filePath = input?.file_path ?? input?.path ?? null}
                    {@const label = filePath
                      ? filePath.split(/[/\\]/).at(-1)
                      : (input?.command ?? null)}
                    {#if label}
                      <span
                        class="truncate font-mono text-muted-foreground/60"
                        style="max-width:24rem">{label}</span>
                    {/if}
                  {/if}
                </summary>
                <div
                  class="border-t border-muted-foreground/20 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
                  {msg.text}
                </div>
              </details>
            {:else if msg.role === 'tool_result'}
              {#if msg.text.trim()}
                <details class="max-w-[85%] rounded-xl border border-muted-foreground/10 text-xs">
                  <summary
                    class="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-muted-foreground/60 select-none hover:text-muted-foreground">
                    <span class="size-1.5 rounded-full bg-green-500/60"></span>
                    <span>Result</span>
                  </summary>
                  <div
                    class="border-t border-muted-foreground/10 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground/70">
                    {msg.text.length > 1000 ? msg.text.slice(0, 1000) + '\n…' : msg.text}
                  </div>
                </details>
              {/if}
            {/if}
          </div>
        {/each}
        {#if isProcessing && !messages.at(-1)?.isStreaming}
          <div class="flex items-center gap-2">
            <div class="rounded-xl bg-muted px-3 py-2.5">
              <div class="flex gap-1">
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]"
                ></span>
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]"
                ></span>
                <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/50"></span>
              </div>
            </div>
            {#if outputTokens > 0}
              <span class="text-xs text-muted-foreground/60"
                >{outputTokens.toLocaleString()} tokens</span>
            {/if}
          </div>
        {/if}
        {#if !isProcessing && lastCostUsd != null}
          <div class="flex justify-end">
            <span class="text-xs text-muted-foreground/50">${lastCostUsd.toFixed(4)}</span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- CLI checking banner -->
    {#if cliAvailable === null}
      <div class="flex items-center gap-2 border-t border-muted bg-muted/40 px-3 py-2">
        <svg
          class="size-3.5 animate-spin text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
          ></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          ></path>
        </svg>
        <span class="text-xs text-muted-foreground">Checking environment…</span>
      </div>
    {/if}

    <!-- CLI not found banner -->
    {#if cliAvailable === false}
      <div
        class="flex items-center gap-3 border-t border-red-400/40 bg-red-50/80 px-3 py-2.5 dark:bg-red-950/30">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-red-800 dark:text-red-300"
            >Claude Code CLI not installed</span>
          <span class="text-xs text-red-700/70 dark:text-red-400/70">
            <button
              class="underline underline-offset-2 hover:text-red-800 dark:hover:text-red-300"
              onclick={async () => {
                const { open } = await import('@tauri-apps/plugin-shell');
                await open('https://docs.anthropic.com/en/docs/claude-code/getting-started');
              }}>
              Get started with Claude Code →
            </button>
          </span>
        </div>
      </div>
    {/if}

    <!-- MCP banner -->
    {#if !mcpState.enabled}
      <div
        class="flex items-center gap-3 border-t border-amber-400/40 bg-amber-50/80 px-3 py-2.5 dark:bg-amber-950/30">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-amber-800 dark:text-amber-300"
            >MCP Server disabled</span>
          <span class="text-xs text-amber-700/70 dark:text-amber-400/70"
            >Agent cannot read or edit diagrams.</span>
        </div>
        <button
          onclick={async () => {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('start_mcp_server');
            mcpState.set(true);
          }}
          class="shrink-0 rounded-md border border-amber-400/60 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/40">
          Enable
        </button>
      </div>
    {/if}

    <!-- Error banner -->
    {#if errorMsg}
      <div
        class="flex items-start gap-2 border-t border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
        <span class="flex-1 break-words">{errorMsg}</span>
        <button
          onclick={() => {
            agentState.getSlice(selectedAgentId).errorMsg = null;
          }}
          class="shrink-0 opacity-60 hover:opacity-100">✕</button>
      </div>
    {/if}

    <!-- Permission banner -->
    {#if pendingPermission}
      <div class="border-t border-amber-500/30 bg-amber-500/10 p-3">
        <div
          class="mb-2 flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
          <LockIcon class="size-3.5 shrink-0" />
          <span>Permission Request</span>
        </div>
        <p class="mb-1 text-xs text-foreground">
          Allow <span class="font-mono font-medium">{pendingPermission.toolName}</span>?
        </p>
        {#if pendingPermission.toolInput && Object.keys(pendingPermission.toolInput as object).length > 0}
          <pre
            class="mb-2 max-h-24 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground">{JSON.stringify(
              pendingPermission.toolInput,
              null,
              2
            )}</pre>
        {/if}
        <div class="flex gap-2">
          <button
            onclick={allowPermission}
            class="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
            Allow
          </button>
          <button
            onclick={denyPermission}
            class="flex-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80">
            Deny
          </button>
        </div>
      </div>
    {/if}

    <!-- Input -->
    <div class="flex gap-1 border-t border-muted p-2">
      <textarea
        bind:value={inputText}
        placeholder={workingFolder ? 'Message...' : 'Select a folder first…'}
        rows="1"
        disabled={!workingFolder || !!pendingPermission || cliAvailable !== true}
        style="field-sizing: content; max-height: 8lh;"
        class="flex-1 resize-none rounded-lg bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        oncompositionend={() => {
          imeSkipNextEnter = true;
        }}
        onkeyup={(e) => {
          // Space/other keys confirm candidate without Enter — clear the flag so next Enter sends
          if (e.key !== 'Enter') imeSkipNextEnter = false;
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            if (imeSkipNextEnter) {
              imeSkipNextEnter = false;
              e.preventDefault();
              return;
            }
            e.preventDefault();
            if (!isProcessing) sendMessage();
          }
        }}></textarea>
      <button
        onclick={isProcessing ? interruptRun : sendMessage}
        class="rounded-lg bg-primary p-2 text-primary-foreground hover:opacity-80 disabled:opacity-40"
        disabled={!workingFolder ||
          sending ||
          (!isProcessing && !inputText.trim()) ||
          !!pendingPermission ||
          cliAvailable !== true}>
        {#if isProcessing}
          <StopIcon class="size-4" />
        {:else}
          <SendIcon class="size-4" />
        {/if}
      </button>
    </div>
  </div>
</Card>
