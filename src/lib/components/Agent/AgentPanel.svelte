<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import type { Component } from 'svelte';
  import { tick } from 'svelte';
  import Card from '#lib/components/Card/Card.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { agentState, slices, type SessionEntry } from '#lib/util/agentState.svelte.js';
  import { fileState } from '#lib/util/fileState.svelte.js';
  import { mcpState } from '#lib/util/mcpState.svelte.js';
  import { openFolderDialog } from '#lib/util/fileSystem.js';
  import { mode } from 'mode-watcher';
  import { renderMarkdownSync } from '#lib/util/markdown.js';
  import { renderMarkdownCached, clearMarkdownCache } from '#lib/util/markdownCache.js';
  import { VList, type VListHandle } from 'virtua/svelte';
  import { untrack } from 'svelte';
  import ClaudeIcon from '~icons/logos/claude-icon';
  import OpenAIIcon from '~icons/logos/openai-icon';
  import ClaudeCodeLogo from '~icons/logos/claude-code';
  import CodexLogo from '~icons/logos/codex';
  import SelectAgentIcon from '~icons/material-symbols/expand-more-rounded';
  import CheckIcon from '~icons/material-symbols/check-rounded';
  import HistoryIcon from '~icons/material-symbols/history-rounded';
  import AddIcon from '~icons/material-symbols/add-rounded';
  import SendIcon from '~icons/material-symbols/send-rounded';
  import StopIcon from '~icons/material-symbols/stop-rounded';
  import LockIcon from '~icons/material-symbols/lock-rounded';
  import DeleteIcon from '~icons/material-symbols/delete-outline-rounded';
  import AttachFileIcon from '~icons/material-symbols/attach-file-rounded';
  import CodeBracketIcon from '~icons/material-symbols/code-rounded';
  import ManualIcon from '~icons/material-symbols/back-hand-rounded';
  import PlanIcon from '~icons/material-symbols/checklist-rounded';
  import AutoIcon from '~icons/material-symbols/bolt-rounded';
  import FolderOpenIcon from '~icons/material-symbols/folder-open-outline-rounded';

  interface AgentOption {
    id: string;
    label: string;
    icon: Component<any>;
    // Extra classes for the icon. The OpenAI logo is a fixed black mark (no
    // currentColor), so it's invisible on the dark theme — invert it to white.
    iconClass?: string;
    // Larger product logo for the empty-state placeholder, with its sizing
    // class. Sized by height (h-* w-auto) so logos with differing viewBox
    // aspects still share a visual height.
    emptyStateIcon: Component<any>;
    emptyStateIconClass: string;
  }

  const agents: AgentOption[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      icon: ClaudeIcon,
      emptyStateIcon: ClaudeCodeLogo,
      emptyStateIconClass: 'h-10 w-auto'
    },
    {
      id: 'codex',
      label: 'Codex',
      icon: OpenAIIcon,
      iconClass: 'dark:invert',
      emptyStateIcon: CodexLogo,
      emptyStateIconClass: 'h-10 w-auto dark:invert'
    }
  ];

  // Shared classes for a rendered-markdown message bubble. Kept in one place
  // because the streaming / loading / resolved branches all render the same
  // container. The [&_:not(pre)>code] variants style *inline* code only (a
  // subtle background chip), leaving the Shiki-highlighted `<pre><code>` fenced
  // blocks untouched; content-none drops prose's default backtick glyphs.
  const markdownBubbleClasses =
    'prose prose-sm max-w-[85%] rounded-xl bg-muted px-3 py-2 dark:prose-invert ' +
    '[&_hr]:my-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:px-3 [&_pre]:py-2 ' +
    '[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-foreground/10 [&_:not(pre)>code]:px-1.5 ' +
    '[&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-normal ' +
    '[&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none';

  // Start event listener for agent events
  agentState.init();

  const AGENT_KEY = 'mermaid-agent';
  const FOLDER_KEY = 'mermaid-agent-folder';
  const RECENT_FOLDERS_KEY = 'mermaid-agent-recent-folders';
  const PERMISSION_MODE_KEY = 'mermaid-agent-permission-mode';
  const sessionKey = (agentId: string, folder: string | null) =>
    `mermaid-agent-session-${agentId}-${folder ?? ''}`;

  let selectedAgentId = $state(localStorage.getItem(AGENT_KEY) ?? 'claude-code');
  let agentPopoverOpen = $state(false);
  let sessionPopoverOpen = $state(false);

  $effect(() => {
    localStorage.setItem(AGENT_KEY, selectedAgentId);
  });

  const selectedAgent = $derived(agents.find((a) => a.id === selectedAgentId) ?? agents[0]);
  const selectedAgentIcon = $derived(selectedAgent.icon);
  const selectedAgentIconClass = $derived(selectedAgent.iconClass);
  const selectedAgentEmptyStateIcon = $derived(selectedAgent.emptyStateIcon);
  const selectedAgentEmptyStateIconClass = $derived(selectedAgent.emptyStateIconClass);

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
      : m.no_folder()
  );

  const recentAgentFolders = $state<string[]>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) ?? '[]');
      } catch {
        return [];
      }
    })()
  );

  let folderPopoverOpen = $state(false);

  $effect(() => {
    if (!workingFolder) return;
    const folder = workingFolder;
    untrack(() => {
      const idx = recentAgentFolders.indexOf(folder);
      if (idx !== -1) recentAgentFolders.splice(idx, 1);
      recentAgentFolders.unshift(folder);
      if (recentAgentFolders.length > 10) recentAgentFolders.splice(10);
      localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(recentAgentFolders));
    });
  });

  const sessions = $derived<SessionEntry[]>(
    workingFolder ? (slices[selectedAgentId]?.folderSessions[workingFolder] ?? []) : []
  );

  // True while loadSessions() is fetching (Codex cold start can take a few
  // seconds) and we have nothing cached yet — drives the popover spinner.
  const sessionsLoading = $derived(
    (slices[selectedAgentId]?.sessionsLoading ?? false) && sessions.length === 0
  );

  // Load sessions from Tauri whenever agent or folder changes
  $effect(() => {
    if (workingFolder) agentState.loadSessions(selectedAgentId, workingFolder);
  });

  // Active session: null means "new session"; persisted per agent+folder
  let activeSessionId = $state<string | null>(
    localStorage.getItem(
      sessionKey(localStorage.getItem(AGENT_KEY) ?? 'claude-code', localStorage.getItem(FOLDER_KEY))
    )
  );

  $effect(() => {
    // Persist active session per agent+folder — only reacts to activeSessionId changes
    const sid = activeSessionId;
    untrack(() => {
      const key = sessionKey(selectedAgentId, workingFolder);
      if (sid) localStorage.setItem(key, sid);
      else localStorage.removeItem(key);
    });
  });

  $effect(() => {
    // Reset session and clear messages when folder or agent changes
    // Do NOT read runId here — it would re-trigger this effect when run exits
    const agent = selectedAgentId;
    void workingFolder;
    activeSessionId = localStorage.getItem(sessionKey(agent, workingFolder));
    untrack(() => agentState.clearMessages(agent));
    following = true;
    distanceFromBottom = 0;
    clearMarkdownCache();
    expandedResults = new Set();
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
    following = true;
    distanceFromBottom = 0;
    clearMarkdownCache();
    expandedResults = new Set();
    agentState.loadSessionHistory(selectedAgentId, workingFolder, activeSessionId);
  });

  const activeSession = $derived(sessions.find((s) => s.sessionId === activeSessionId) ?? null);

  const sessionLabel = $derived(
    activeSession
      ? (activeSession.firstPrompt?.slice(0, 40) ?? activeSession.sessionId.slice(0, 8))
      : m.agent_new_session()
  );

  async function pickFolder() {
    const path = await openFolderDialog();
    if (path) workingFolder = path;
  }

  type PermissionMode = 'manual' | 'acceptEdits' | 'plan' | 'auto';
  const PERMISSION_MODES: {
    value: PermissionMode;
    label: string;
    description: string;
    icon: Component<any>;
  }[] = $derived([
    {
      value: 'manual',
      label: m.pm_manual_label(),
      description: m.pm_manual_desc(),
      icon: ManualIcon
    },
    {
      value: 'acceptEdits',
      label: m.pm_auto_edit_label(),
      description: m.pm_auto_edit_desc(),
      icon: CodeBracketIcon
    },
    {
      value: 'plan',
      label: m.pm_plan_label(),
      description: m.pm_plan_desc(),
      icon: PlanIcon
    },
    {
      value: 'auto',
      label: m.pm_auto_label(),
      description: m.pm_auto_desc(),
      icon: AutoIcon
    }
  ]);
  const VALID_PERMISSION_MODES: PermissionMode[] = ['manual', 'acceptEdits', 'plan', 'auto'];
  let permissionMode = $state<PermissionMode>(
    (() => {
      const stored = localStorage.getItem(PERMISSION_MODE_KEY) as PermissionMode;
      return VALID_PERMISSION_MODES.includes(stored) ? stored : 'manual';
    })()
  );
  $effect(() => {
    localStorage.setItem(PERMISSION_MODE_KEY, permissionMode);
  });

  async function setPermissionMode(m: PermissionMode) {
    permissionMode = m;
    if (runId) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_agent_permission_mode', { runId, mode: m });
      } catch (e) {
        console.error('[agent] setPermissionMode error:', e);
      }
    }
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
      // Warm up the persistent Codex process on selection (once CLI is confirmed).
      if (cliAvailable && agentId === selectedAgentId) {
        void invoke('ensure_agent_ready', { agentType: agentId }).catch(() => {});
      }
    })();
  });

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || !workingFolder || sending) return;
    // Sending always returns the view to the bottom and resumes auto-follow, so
    // the new message (and the incoming reply) are visible rather than left
    // off-screen when the user had scrolled up.
    following = true;
    distanceFromBottom = 0;
    inputText = '';
    sending = true;
    let startedRunId: string | null = null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (!runId) {
        const isResume = !!activeSessionId;
        if (!isResume) pendingFirstMessage = text;
        const existingMessages = isResume ? [...(slices[selectedAgentId]?.messages ?? [])] : [];
        // Generate the run id and register the event listener BEFORE invoking.
        // The persistent Codex process answers thread/start instantly and can
        // emit session_ready before the backend's invoke even returns; if we
        // registered afterwards that event would be dropped (empty session list
        // + header stuck on "New session"). Owning the id client-side closes
        // the race. registerRun resets the slice, so restore messages after it.
        const newRunId = crypto.randomUUID();
        startedRunId = newRunId;
        agentState.registerRun(selectedAgentId, newRunId);
        if (isResume && activeSessionId) liveSessionId = activeSessionId;
        agentState.getSlice(selectedAgentId).messages = [
          ...existingMessages,
          { id: `user-${newRunId}`, role: 'user', text }
        ];
        await invoke('start_agent_session', {
          params: {
            prompt: text,
            folder_path: workingFolder,
            agent_type: selectedAgentId,
            resume_session_id: activeSessionId ?? null,
            permission_mode: permissionMode,
            run_id: newRunId
          }
        });
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
      // Roll back the pre-registered run so the UI isn't stuck on a run that
      // never started.
      if (startedRunId) {
        const slice = slices[selectedAgentId];
        if (slice?.activeRunId === startedRunId) slice.activeRunId = null;
        agentState.unregisterRun(startedRunId);
      }
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
    } catch {}
  }

  async function killRun(id: string) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('kill_agent_run', { runId: id });
    } catch {}
    // The persistent Codex process emits no exit event for a dropped session,
    // so clear the active run locally (harmless for Claude — its process dies).
    const slice = slices[selectedAgentId];
    if (slice?.activeRunId === id) slice.activeRunId = null;
    agentState.unregisterRun(id);
  }

  const messages = $derived(slices[selectedAgentId]?.messages ?? []);

  // Typing dots mean "working, but nothing is streaming yet": waiting for the
  // first token or running a tool. Debounced by 250ms so the sub-second gap
  // between a finalized reply and the `exit` event doesn't flash the dots, while
  // genuine waits (first token, tool runs) comfortably outlast the delay. A role
  // check won't work here: `last === assistant` can mean either "final answer" or
  // "said something, now running a tool", and only time tells them apart.
  // Also suppressed while a permission/question request is pending — then the run
  // is blocked on the user, not working.
  const agentWorking = $derived(
    isProcessing && !slices[selectedAgentId]?.pendingPermission && !messages.at(-1)?.isStreaming
  );
  let showTypingDots = $state(false);
  $effect(() => {
    if (!agentWorking) {
      showTypingDots = false;
      return;
    }
    const t = setTimeout(() => (showTypingDots = true), 250);
    return () => clearTimeout(t);
  });

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

  let denyMessage = $state('');

  async function denyPermission() {
    if (!pendingPermission || !runId) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('respond_agent_permission', {
        runId,
        requestId: pendingPermission.requestId,
        approved: false,
        toolInput: null,
        denyMessage: denyMessage.trim() || null
      });
      slices[selectedAgentId].pendingPermission = null;
      denyMessage = '';
    } catch (e) {
      console.error('[agent] denyPermission error:', e);
    }
  }

  // ── AskUserQuestion (Claude's interactive question tool) ──────────────────
  // Arrives on the same can_use_tool permission channel, but the request carries
  // `requires_user_interaction: true` (the protocol-level signal) and an input
  // shaped as { questions: [...] }. We gate on that flag (not the tool name) and
  // render selectable options instead of allow/deny, answering by replying
  // `allow` with updatedInput carrying an `answers` map (question text → chosen
  // label(s)); Skip sends empty answers ("not answered").
  type AskQuestion = {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: { label: string; description?: string }[];
  };
  // Sentinel for the auto-appended free-text "Other" choice (mirrors the official
  // Claude Code CLI). It rides the same selection state as a normal option; on
  // submit it resolves to the typed text instead of a label. Claude's own options
  // never use this value, so there's no collision.
  const OTHER = '__other__';
  const askQuestions = $derived.by(() => {
    const p = pendingPermission;
    if (!p?.requiresUserInteraction) return null;
    const qs = (p.toolInput as { questions?: AskQuestion[] } | null)?.questions;
    return Array.isArray(qs) && qs.length > 0 ? qs : null;
  });
  // question index → selected labels (single-select keeps at most one)
  let answerSel = $state<Record<number, string[]>>({});
  // question index → free text entered for the "Other" choice
  let otherText = $state<Record<number, string>>({});
  $effect(() => {
    // reset selections whenever a new question request appears
    void pendingPermission?.requestId;
    answerSel = {};
    otherText = {};
  });
  function focusOnMount(el: HTMLElement) {
    el.focus();
  }
  function isSel(qi: number, label: string) {
    return (answerSel[qi] ?? []).includes(label);
  }
  function toggleAnswer(qi: number, label: string, multi: boolean) {
    const cur = answerSel[qi] ?? [];
    const next = multi
      ? cur.includes(label)
        ? cur.filter((l) => l !== label)
        : [...cur, label]
      : [label];
    answerSel = { ...answerSel, [qi]: next };
  }
  const allAnswered = $derived(
    !!askQuestions &&
      askQuestions.every((_, i) => {
        const sel = answerSel[i] ?? [];
        if (sel.length === 0) return false;
        // "Other" counts as answered only once its text box is non-empty
        if (sel.includes(OTHER) && !(otherText[i] ?? '').trim()) return false;
        return true;
      })
  );
  async function answerQuestion(skip: boolean) {
    if (!pendingPermission || !runId) return;
    const answers: Record<string, string | string[]> = {};
    if (!skip && askQuestions) {
      askQuestions.forEach((q, i) => {
        const sel = answerSel[i] ?? [];
        // "Other" resolves to the typed free text; other picks pass through as labels.
        const resolve = (s: string) => (s === OTHER ? (otherText[i] ?? '').trim() : s);
        answers[q.question] = q.multiSelect
          ? sel.map(resolve).filter((s) => s.length > 0)
          : resolve(sel[0] ?? '');
      });
    }
    const toolInput = { ...(pendingPermission.toolInput as object), answers };
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('respond_agent_permission', {
        runId,
        requestId: pendingPermission.requestId,
        approved: true,
        toolInput
      });
      slices[selectedAgentId].pendingPermission = null;
      answerSel = {};
      otherText = {};
    } catch (e) {
      console.error('[agent] answerQuestion error:', e);
    }
  }

  let vlist = $state<VListHandle | null>(null);
  // Tool results longer than this are truncated with a "Show all" toggle.
  const RESULT_TRUNCATE = 1000;
  // ids of tool_result messages the user chose to expand. Kept at component level
  // (keyed by id) because VList virtualizes, so per-item state wouldn't survive
  // scrolling the result out of and back into view.
  let expandedResults = $state<Set<string>>(new Set());
  function toggleResult(id: string) {
    const next = new Set(expandedResults);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedResults = next;
  }
  // How far (px) the viewport bottom is from the content bottom. 0 = pinned.
  let distanceFromBottom = $state(0);
  // `following` (auto-pin) uses a small threshold so any deliberate scroll-up stops
  // new messages from yanking the view back down. The "scroll to bottom" button
  // uses a larger one (SCROLL_BUTTON_GAP) so it only appears after scrolling up a
  // meaningful distance, not on tiny nudges. The two are intentionally decoupled.
  const FOLLOW_GAP = 50;
  const SCROLL_BUTTON_GAP = 200;
  let following = $state(true);
  // Recompute on both scroll and resize: resize matters because short,
  // non-scrollable content never emits a scroll event, so without it `following`
  // could latch false (e.g. if a scroll fires before the viewport is measured).
  function updateFollowing() {
    if (!vlist) return;
    distanceFromBottom =
      vlist.getScrollSize() - (vlist.getScrollOffset() + vlist.getViewportSize());
    following = distanceFromBottom < FOLLOW_GAP;
  }
  // Fired when the viewport or items resize. If we were pinned, re-scroll to the
  // bottom so a layout change that shrinks the list — most notably the typing-dots
  // footer appearing ~250ms after a reply starts — doesn't leave the last message
  // hidden behind the footer. Does nothing when the user has scrolled up.
  function onViewportResize() {
    if (following) vlist?.scrollToIndex(messages.length - 1, { align: 'end' });
    updateFollowing();
  }
  $effect(() => {
    const n = messages.length;
    // Read the last message's length so streaming growth also re-triggers this.
    const lastLen = messages[n - 1]?.text.length ?? 0;
    void lastLen;
    // `following` is read untracked: only NEW content (messages change) should
    // pin to the bottom. If `following` were a dependency, scrolling up to within
    // FOLLOW_GAP would flip it true and this effect would snap the view to the
    // bottom on the user's own scroll.
    if (n === 0 || !untrack(() => following)) return;
    tick().then(() => vlist?.scrollToIndex(n - 1, { align: 'end' }));
  });

  // Pick a one-line label for a tool_use summary from its parsed input, plus
  // whether it should render monospace. Code-like values (paths, commands, urls,
  // skill ids) get `mono: true`; natural-language values (description, title,
  // prompt, query) get `mono: false` so they read as prose, not code. Order is
  // the display priority — description intentionally wins over command.
  function toolLabel(input: unknown): { text: string; mono: boolean } | null {
    if (!input || typeof input !== 'object') return null;
    const i = input as Record<string, unknown>;
    const filePath = i.file_path ?? i.path;
    if (typeof filePath === 'string' && filePath.length > 0) {
      return { text: filePath.split(/[/\\]/).at(-1) ?? filePath, mono: true };
    }
    const candidates: [unknown, boolean][] = [
      [i.skill, true],
      [i.description, false],
      [i.title, false],
      [i.command, true],
      [i.task_name, false],
      [i.query, false],
      [i.url, true],
      [i.prompt, false]
    ];
    for (const [value, mono] of candidates) {
      if (typeof value === 'string' && value.length > 0) return { text: value, mono };
    }
    return null;
  }

  // MCP tools are named `mcp__<server>__<tool>`; render them as
  // "Mermaid-code-mcp · list_diagrams" (server capitalized, middle-dot
  // separator) instead of the raw mangled id. Non-MCP tools (and anything
  // that doesn't match) are returned unchanged.
  function displayToolName(name: string | undefined): string {
    if (!name) return m.agent_tool_fallback();
    if (name.startsWith('mcp__')) {
      const rest = name.slice('mcp__'.length);
      const sep = rest.indexOf('__');
      if (sep !== -1) {
        const server = rest.slice(0, sep);
        const tool = rest.slice(sep + 2);
        const label = server.charAt(0).toUpperCase() + server.slice(1);
        return tool ? `${label} · ${tool}` : label;
      }
    }
    return name;
  }

  async function handleLinkClick(e: MouseEvent | KeyboardEvent, target: EventTarget | null) {
    const a = (target as HTMLElement).closest('a');
    if (!a) return;
    const raw = a.getAttribute('href') ?? '';
    e.preventDefault();
    if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('file://'))
      return;
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(a.href);
    } catch {}
  }
</script>

<Card
  title={selectedAgent.label}
  isOpen
  isClosable={false}
  icon={{
    component: selectedAgentIcon,
    class: ['ml-1', selectedAgentIconClass].filter(Boolean).join(' ')
  }}>
  {#snippet actions()}
    <div class="flex items-center gap-1">
      <Popover.Root bind:open={agentPopoverOpen}>
        <Popover.Trigger>
          <Button size="icon" variant="ghost" title={m.agent_select_agent()}>
            <SelectAgentIcon
              class="transition-transform duration-150 {agentPopoverOpen ? 'rotate-180' : ''}" />
          </Button>
        </Popover.Trigger>
        <Popover.Content align="end" class="flex w-44 flex-col gap-0.5 p-1">
          {#each agents as agent}
            {@const AgentIcon = agent.icon}
            <Popover.Close>
              <button
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                onclick={() => (selectedAgentId = agent.id)}>
                <AgentIcon class={['size-4 shrink-0', agent.iconClass]} />
                <span class="flex-1 text-left">{agent.label}</span>
                {#if agent.id === selectedAgentId}
                  <CheckIcon class="size-4 text-foreground" />
                {/if}
              </button>
            </Popover.Close>
          {/each}
        </Popover.Content>
      </Popover.Root>
    </div>
  {/snippet}

  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex items-center gap-0.5 border-b border-muted px-1.5 py-1">
      <!-- Folder picker -->
      <Popover.Root bind:open={folderPopoverOpen}>
        <Popover.Trigger class="flex min-w-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            class="h-6 max-w-32 gap-1 px-1.5 text-xs"
            title={workingFolder ?? m.select_folder()}>
            <span class="truncate">{folderName}</span>
          </Button>
        </Popover.Trigger>
        <Popover.Content class="w-72 p-1" align="start">
          {#each recentAgentFolders as folder (folder)}
            {@const name = folder.split(/[/\\]/).filter(Boolean).at(-1) ?? folder}
            <Popover.Close class="contents">
              <button
                onclick={() => (workingFolder = folder)}
                disabled={isProcessing}
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50 {workingFolder ===
                folder
                  ? 'text-foreground'
                  : 'text-muted-foreground'}">
                {#if workingFolder === folder}
                  <CheckIcon class="size-3 shrink-0" />
                {:else}
                  <span class="size-3 shrink-0"></span>
                {/if}
                <span class="truncate font-medium">{name}</span>
                <span
                  class="ml-auto shrink-0 truncate font-mono text-[10px] text-muted-foreground/50"
                  style="max-width:8rem"
                  title={folder}>{folder}</span>
              </button>
            </Popover.Close>
          {/each}
          {#if recentAgentFolders.length > 0}
            <div class="my-1 border-t border-muted"></div>
          {/if}
          <Popover.Close class="contents">
            <button
              onclick={pickFolder}
              disabled={isProcessing}
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50">
              <FolderOpenIcon class="size-3 shrink-0" />
              {m.browse()}
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Root>

      <span class="text-xs text-muted-foreground/40">/</span>

      <!-- Session selector -->
      <Popover.Root bind:open={sessionPopoverOpen}>
        <Popover.Trigger class="flex min-w-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            class="h-6 max-w-72 gap-1 px-1.5 text-xs"
            title={m.agent_select_session()}>
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
              <span class="flex-1 text-left">{m.agent_new_session()}</span>
              {#if activeSessionId === null}
                <CheckIcon class="size-4 text-foreground" />
              {/if}
            </button>
          </Popover.Close>
          {#if sessionsLoading}
            <div class="my-0.5 border-t border-muted"></div>
            <div
              class="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
              role="status">
              <svg
                class="size-4 shrink-0 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                ></path>
              </svg>
              <span>{m.agent_loading_sessions()}</span>
            </div>
          {:else if sessions.length > 0}
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
                      title={m.agent_delete_session()}
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

      <!-- Permission mode selector -->
      <div class="ml-auto">
        <Popover.Root>
          <Popover.Trigger disabled={isProcessing} class="flex items-center">
            <Button
              size="sm"
              variant="ghost"
              disabled={isProcessing}
              class="h-6 px-1.5 text-xs text-muted-foreground"
              title={m.agent_permission_mode()}>
              {PERMISSION_MODES.find((m) => m.value === permissionMode)?.label ?? 'Manual'}
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-72 p-1" align="end">
            {#each PERMISSION_MODES as m (m.value)}
              {@const ModeIcon = m.icon}
              <Popover.Close class="contents">
                <button
                  onclick={() => setPermissionMode(m.value)}
                  class="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-muted {permissionMode ===
                  m.value
                    ? 'bg-muted/60'
                    : ''}">
                  <ModeIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 text-xs font-medium text-foreground">
                      {m.label}
                      {#if permissionMode === m.value}
                        <CheckIcon class="size-4 text-muted-foreground" />
                      {/if}
                    </div>
                    <div class="text-[11px] text-muted-foreground">{m.description}</div>
                  </div>
                </button>
              </Popover.Close>
            {/each}
          </Popover.Content>
        </Popover.Root>
      </div>
    </div>

    <!-- Content -->
    <div
      role="presentation"
      class="agent-transcript relative flex min-h-0 flex-1 flex-col"
      onclick={(e) => handleLinkClick(e, e.target)}
      onkeydown={(e) => {
        if (e.key === 'Enter') handleLinkClick(e, e.target);
      }}>
      {#if messages.length === 0}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center select-none">
          {#each [selectedAgentEmptyStateIcon] as AgentIcon}
            <AgentIcon class={['opacity-40', selectedAgentEmptyStateIconClass]} />
          {/each}
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium text-foreground/60">{selectedAgent.label}</p>
            <p class="text-xs text-muted-foreground">
              {#if !workingFolder}
                {m.agent_select_folder_to_start()}
              {:else if activeSessionId}
                {m.agent_no_messages()}
              {:else}
                {m.agent_start_conversation()}
              {/if}
            </p>
          </div>
        </div>
      {:else}
        <VList
          bind:this={vlist}
          data={messages}
          getKey={(msg) => msg.id}
          class="flex-1 p-2"
          onscroll={updateFollowing}
          onresize={onViewportResize}>
          {#snippet children(msg, index)}
            <div
              class={[
                index > 0 && 'mt-2',
                'flex flex-col gap-0.5',
                msg.role === 'user' ? 'items-end' : 'items-start'
              ]}>
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
                      class="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 select-none hover:text-foreground">
                      <span class="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"></span>
                      <span class="font-medium text-muted-foreground">{m.agent_thinking()}</span>
                    </summary>
                    <div
                      class="border-t border-muted-foreground/20 px-3 py-2 break-words whitespace-pre-wrap text-muted-foreground">
                      {msg.thinking}
                    </div>
                  </details>
                {/if}
                {#if msg.text}
                  {#if msg.isStreaming}
                    <div class={markdownBubbleClasses}>
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html renderMarkdownSync(msg.text)}
                    </div>
                  {:else}
                    {#await renderMarkdownCached(msg.id, msg.text, mode.current === 'dark')}
                      <div class={markdownBubbleClasses}>
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html renderMarkdownSync(msg.text)}
                      </div>
                    {:then html}
                      <div class={markdownBubbleClasses}>
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html html}
                      </div>
                    {/await}
                  {/if}
                {/if}
              {:else if msg.role === 'tool_use'}
                <details class="max-w-[85%] rounded-xl border border-muted-foreground/20 text-xs">
                  <summary
                    class="flex cursor-pointer items-baseline gap-1.5 px-3 py-1.5 select-none hover:text-foreground">
                    <span class="size-1.5 shrink-0 self-center rounded-full bg-muted-foreground/50"
                    ></span>
                    <span class="font-medium text-muted-foreground"
                      >{displayToolName(msg.toolName)}</span>
                    {#if msg.text}
                      {@const input = (() => {
                        try {
                          return JSON.parse(msg.text);
                        } catch {
                          return null;
                        }
                      })()}
                      {@const label = toolLabel(input)}
                      {#if label}
                        <span
                          class={['truncate text-muted-foreground/60', label.mono && 'font-mono']}
                          style="max-width:24rem">{label.text}</span>
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
                  {@const long = msg.text.length > RESULT_TRUNCATE}
                  {@const expanded = expandedResults.has(msg.id)}
                  <details class="max-w-[85%] rounded-xl border border-muted-foreground/10 text-xs">
                    <summary
                      class="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-muted-foreground/60 select-none hover:text-muted-foreground">
                      <span
                        class={[
                          'size-1.5 rounded-full',
                          msg.isError ? 'bg-red-500/70' : 'bg-green-500/60'
                        ]}></span>
                      <span>{m.agent_result()}</span>
                    </summary>
                    <div
                      class="border-t border-muted-foreground/10 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground/70">
                      {long && !expanded ? msg.text.slice(0, RESULT_TRUNCATE) + '\n…' : msg.text}
                      {#if long}
                        <button
                          type="button"
                          class="mt-1 block cursor-pointer font-sans text-muted-foreground/60 hover:text-muted-foreground"
                          onclick={() => toggleResult(msg.id)}>
                          {expanded ? m.agent_result_collapse() : m.agent_result_expand()}
                        </button>
                      {/if}
                    </div>
                  </details>
                {/if}
              {/if}
            </div>
          {/snippet}
        </VList>
        {#if distanceFromBottom > SCROLL_BUTTON_GAP && messages.length > 0}
          <button
            type="button"
            class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-muted bg-background px-3 py-1 text-xs text-muted-foreground shadow hover:text-foreground"
            onclick={() => {
              following = true;
              // Smooth only within ~4 viewports; smooth-scrolling across thousands
              // of virtualized items renders every one it passes and janks, so a
              // longer jump falls back to instant.
              const smooth = distanceFromBottom < (vlist?.getViewportSize() ?? 0) * 4;
              distanceFromBottom = 0;
              vlist?.scrollToIndex(messages.length - 1, { align: 'end', smooth });
            }}>
            {m.agent_scroll_to_bottom()}
          </button>
        {/if}
      {/if}
    </div>

    <!-- Typing / cost footer -->
    {#if showTypingDots || (!isProcessing && lastCostUsd != null)}
      <div class="shrink-0 px-2 pb-2">
        {#if showTypingDots}
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
      </div>
    {/if}

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
        <span class="text-xs text-muted-foreground">{m.agent_checking_env()}</span>
      </div>
    {/if}

    <!-- CLI not found banner -->
    {#if cliAvailable === false}
      <div
        class="flex items-center gap-3 border-t border-red-400/40 bg-red-50/80 px-3 py-2.5 dark:bg-red-950/30">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs font-medium text-red-800 dark:text-red-300"
            >{m.agent_cli_not_installed({ agent: selectedAgent.label })}</span>
          <span class="text-xs text-red-700/70 dark:text-red-400/70">
            <button
              class="underline underline-offset-2 hover:text-red-800 dark:hover:text-red-300"
              onclick={async () => {
                const { open } = await import('@tauri-apps/plugin-shell');
                const url =
                  selectedAgentId === 'codex'
                    ? 'https://github.com/openai/codex'
                    : 'https://docs.anthropic.com/en/docs/claude-code/getting-started';
                await open(url);
              }}>
              {m.agent_get_started({ agent: selectedAgent.label })}
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
            >{m.agent_mcp_disabled()}</span>
          <span class="text-xs text-amber-700/70 dark:text-amber-400/70"
            >{m.agent_mcp_cannot_edit()}</span>
        </div>
        <button
          onclick={async () => {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('start_mcp_server');
            mcpState.set(true);
          }}
          class="shrink-0 rounded-md border border-amber-400/60 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/40">
          {m.agent_enable()}
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
      {#if askQuestions}
        <div class="border-t border-primary/30 bg-primary/5 p-3">
          {#each askQuestions as q, qi (qi)}
            {#if q.header}
              <p
                class="mb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {q.header}
              </p>
            {/if}
            <p class="mb-1.5 text-xs font-medium text-foreground">{q.question}</p>
            <div class="mb-2 flex flex-col gap-1">
              {#each q.options as opt (opt.label)}
                {@const selected = (answerSel[qi] ?? []).includes(opt.label)}
                <button
                  type="button"
                  onclick={() => toggleAnswer(qi, opt.label, !!q.multiSelect)}
                  class={[
                    'flex items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                    selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                  ]}>
                  <span
                    class={[
                      'mt-px flex size-4 shrink-0 items-center justify-center border',
                      q.multiSelect ? 'rounded-[4px]' : 'rounded-full',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40'
                    ]}>
                    {#if selected}<CheckIcon class="size-3" />{/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="font-medium text-foreground">{opt.label}</span>
                    {#if opt.description}
                      <span class="ml-1.5 text-muted-foreground">{opt.description}</span>
                    {/if}
                  </span>
                </button>
              {/each}
              <!-- Free-text "Other" choice (mirrors the official CLI) -->
              <button
                type="button"
                onclick={() => toggleAnswer(qi, OTHER, !!q.multiSelect)}
                class={[
                  'flex items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                  isSel(qi, OTHER) ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                ]}>
                <span
                  class={[
                    'mt-px flex size-4 shrink-0 items-center justify-center border',
                    q.multiSelect ? 'rounded-[4px]' : 'rounded-full',
                    isSel(qi, OTHER)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40'
                  ]}>
                  {#if isSel(qi, OTHER)}<CheckIcon class="size-3" />{/if}
                </span>
                <span class="min-w-0 flex-1 font-medium text-foreground">
                  {m.agent_question_other()}
                </span>
              </button>
              {#if isSel(qi, OTHER)}
                <input
                  type="text"
                  use:focusOnMount
                  bind:value={otherText[qi]}
                  placeholder={m.agent_question_other_placeholder()}
                  class="rounded-md border border-primary bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary" />
              {/if}
            </div>
          {/each}
          <div class="flex gap-2">
            <button
              onclick={() => answerQuestion(false)}
              disabled={!allAnswered}
              class="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">
              {m.agent_question_submit()}
            </button>
            <button
              onclick={() => answerQuestion(true)}
              class="rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80">
              {m.agent_question_skip()}
            </button>
          </div>
        </div>
      {:else}
        <div class="border-t border-amber-500/30 bg-amber-500/10 p-3">
          <div
            class="mb-2 flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            <LockIcon class="size-3.5 shrink-0" />
            <span>{m.agent_permission_request()}</span>
          </div>
          <p class="mb-1 text-xs text-foreground">
            {m.agent_allow()}
            <span class="font-mono font-medium">{pendingPermission.toolName}</span>?
          </p>
          {#if pendingPermission.toolInput && Object.keys(pendingPermission.toolInput as object).length > 0}
            <pre
              class="mb-2 max-h-24 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground">{JSON.stringify(
                pendingPermission.toolInput,
                null,
                2
              )}</pre>
          {/if}
          {#if selectedAgentId !== 'codex'}
            <textarea
              bind:value={denyMessage}
              placeholder={m.agent_deny_placeholder()}
              rows="1"
              class="mb-2 w-full resize-none rounded-md bg-muted px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/60"
            ></textarea>
          {/if}
          <div class="flex gap-2">
            <button
              onclick={allowPermission}
              class="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
              {m.agent_allow()}
            </button>
            <button
              onclick={denyPermission}
              class="flex-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80">
              {m.agent_deny()}
            </button>
          </div>
        </div>
      {/if}
    {/if}

    <!-- Input -->
    <div class="flex gap-1 border-t border-muted p-2">
      <textarea
        bind:value={inputText}
        placeholder={workingFolder ? m.agent_input_placeholder() : m.agent_select_folder_first()}
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
