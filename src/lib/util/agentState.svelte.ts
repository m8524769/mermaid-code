// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  text: string;
  thinking?: string;
  toolName?: string;
  toolUseId?: string;
  isStreaming?: boolean;
}

export interface SessionEntry {
  sessionId: string;
  firstPrompt: string | null;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
}

interface AgentSlice {
  activeRunId: string | null;
  activeSessionId: string | null;
  messages: AgentMessage[];
  pendingPermission: PermissionRequest | null;
  // folderPath → session IDs loaded from Tauri
  folderSessions: Record<string, SessionEntry[]>;
}

// ── State ──────────────────────────────────────────────────────────────────────

export const slices = $state<Record<string, AgentSlice>>({});

// run_id → agentId
const runOwner = new Map<string, string>();

function getSlice(agentId: string): AgentSlice {
  if (!slices[agentId]) {
    slices[agentId] = {
      activeRunId: null,
      activeSessionId: null,
      messages: [],
      pendingPermission: null,
      folderSessions: {} as Record<string, SessionEntry[]>
    };
  }
  return slices[agentId];
}

// ── Mutations ──────────────────────────────────────────────────────────────────

function upsertMessage(agentId: string, msg: AgentMessage) {
  const slice = getSlice(agentId);
  const idx = slice.messages.findIndex((m) => m.id === msg.id);
  slice.messages = idx >= 0 ? slice.messages.with(idx, msg) : [...slice.messages, msg];
}

// ── Event dispatcher (driver-agnostic) ────────────────────────────────────────

interface RawEvent {
  kind: string;
  session_id?: string;
  id?: string;
  text?: string;
  thinking?: string;
  is_streaming?: boolean;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  request_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  is_error?: boolean;
}

function dispatch(agentId: string, e: RawEvent) {
  const slice = getSlice(agentId);

  switch (e.kind) {
    case 'session_ready': {
      if (e.session_id) slice.activeSessionId = e.session_id;
      break;
    }
    case 'message': {
      if (e.id !== undefined && e.text !== undefined) {
        upsertMessage(agentId, {
          id: e.id,
          role: 'assistant',
          text: e.text,
          thinking: e.thinking,
          isStreaming: e.is_streaming ?? false
        });
      }
      break;
    }
    case 'tool_use': {
      if (e.id) {
        upsertMessage(agentId, {
          id: e.id,
          role: 'tool_use',
          text: JSON.stringify(e.input, null, 2),
          toolName: e.name
        });
      }
      break;
    }
    case 'tool_result': {
      if (e.tool_use_id) {
        upsertMessage(agentId, {
          id: `result-${e.tool_use_id}`,
          role: 'tool_result',
          text: e.content ?? '',
          toolUseId: e.tool_use_id
        });
      }
      break;
    }
    case 'permission_request': {
      if (e.request_id) {
        slice.pendingPermission = {
          requestId: e.request_id,
          toolName: e.tool_name ?? '',
          toolInput: e.tool_input
        };
      }
      break;
    }
    case 'exit': {
      slice.messages = slice.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m
      );
      slice.pendingPermission = null;
      slice.activeRunId = null;
      break;
    }
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

let _unlisten: (() => void) | null = null;

async function init() {
  if (_unlisten) return;
  const { listen } = await import('@tauri-apps/api/event');
  _unlisten = await listen<{ run_id: string; event: RawEvent }>('agent-event', ({ payload }) => {
    const agentId = runOwner.get(payload.run_id);
    if (!agentId) return;
    dispatch(agentId, payload.event);
  });
}

function registerRun(agentId: string, runId: string) {
  runOwner.set(runId, agentId);
  const slice = getSlice(agentId);
  slice.activeRunId = runId;
  slice.activeSessionId = null;
  slice.messages = [];
  slice.pendingPermission = null;
}

function unregisterRun(runId: string) {
  runOwner.delete(runId);
}

async function loadSessions(agentId: string, folderPath: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const ids: Array<{ session_id: string; first_prompt: string | null }> = await invoke(
      'list_folder_sessions',
      { agentType: agentId, folderPath }
    );
    const slice = getSlice(agentId);
    const existing = slice.folderSessions[folderPath] ?? [];
    // Merge: prefer in-memory firstPrompt over null from Tauri (timing / file-not-written-yet)
    const merged: SessionEntry[] = ids.map((s) => {
      const ex = existing.find((e) => e.sessionId === s.session_id);
      return { sessionId: s.session_id, firstPrompt: s.first_prompt ?? ex?.firstPrompt ?? null };
    });
    // Keep injected sessions that Tauri hasn't flushed to disk yet
    for (const ex of existing) {
      if (!merged.find((m) => m.sessionId === ex.sessionId)) {
        merged.unshift(ex);
      }
    }
    slice.folderSessions = { ...slice.folderSessions, [folderPath]: merged };
  } catch {
    // Agent type may not support session listing — leave existing cache
  }
}

function clearMessages(agentId: string) {
  if (slices[agentId]) slices[agentId].messages = [];
}

function injectSession(agentId: string, folderPath: string, entry: SessionEntry) {
  const slice = getSlice(agentId);
  const existing = slice.folderSessions[folderPath] ?? [];
  const prev = existing.find((s) => s.sessionId === entry.sessionId);
  const merged: SessionEntry = {
    sessionId: entry.sessionId,
    firstPrompt: entry.firstPrompt ?? prev?.firstPrompt ?? null
  };
  slice.folderSessions = {
    ...slice.folderSessions,
    [folderPath]: [merged, ...existing.filter((s) => s.sessionId !== entry.sessionId)]
  };
}

// agentId → token of the most recently requested history load; stale loads are discarded
const historyLoadTokens = new Map<string, string>();

async function loadSessionHistory(agentId: string, folderPath: string, sessionId: string) {
  const token = `${folderPath}::${sessionId}`;
  historyLoadTokens.set(agentId, token);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const msgs: Array<{ role: string; text: string; thinking: string | null }> = await invoke(
      'load_session_history',
      {
        agentType: agentId,
        folderPath,
        sessionId
      }
    );
    // Discard if a newer load was requested while we were awaiting
    if (historyLoadTokens.get(agentId) !== token) return;
    const slice = getSlice(agentId);
    slice.messages = msgs.map((m, i) => ({
      id: `history-${i}`,
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      text: m.text,
      thinking: m.thinking ?? undefined
    }));
  } catch {
    if (historyLoadTokens.get(agentId) === token) {
      getSlice(agentId).messages = [];
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const agentState = {
  init,
  registerRun,
  unregisterRun,
  injectSession,
  loadSessions,
  loadSessionHistory,
  clearMessages,

  getSlice
};
