use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};

use crate::mcp::MCP_SERVER_PORT;
use crate::McpServerState;

// ── Unified event type ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DriverEvent {
    Message { id: String, text: String, thinking: Option<String>, is_streaming: bool },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String },
    SessionReady { session_id: String },
    PermissionRequest { request_id: String, tool_name: String, tool_input: Value },
    Usage { output_tokens: u64 },
    Exit { is_error: bool, cost_usd: Option<f64>, error: Option<String>, is_final: bool },
}

// ── Driver trait ──────────────────────────────────────────────────────────────

/// Result of parsing one line from the agent's stdout: events for the frontend
/// plus any messages the driver needs to write back to the agent's stdin
/// (used by bidirectional protocols like Codex's JSON-RPC handshake).
#[derive(Default)]
pub struct DriverOutput {
    pub events: Vec<DriverEvent>,
    pub stdin_writes: Vec<String>,
    /// When set, the read loop emits these events under this run_id instead of
    /// its own. The persistent Codex process uses this to route events to the
    /// client run_id that currently owns the active thread.
    pub run_id: Option<String>,
}

impl DriverOutput {
    fn events(events: Vec<DriverEvent>) -> Self {
        Self { events, stdin_writes: vec![], run_id: None }
    }
}

pub trait AgentDriver: Send {
    /// Returns a configured Command ready to spawn, or None for HTTP-based drivers.
    /// Takes `&mut self` so drivers can capture spawn config (cwd, permission mode,
    /// resume id) for use during the protocol handshake in parse_line.
    fn spawn_command(&mut self, config: &SessionConfig) -> Option<Command>;
    /// Encodes a user turn as a stdin/HTTP payload. `session_id` is the known
    /// session/thread id for follow-up turns (None on the first turn). Returns
    /// None if multi-turn is unsupported.
    fn build_user_message(&mut self, _content: &str, _session_id: Option<&str>) -> Option<String> { None }
    /// Encodes an interrupt signal. Returns None if unsupported.
    fn build_interrupt(&self) -> Option<String> { None }
    fn parse_line(&mut self, line: &str) -> DriverOutput;
    /// Encodes a permission response payload. Returns None if unsupported.
    fn build_permission_response(&self, request_id: &str, approved: bool, tool_input: Option<&Value>, deny_message: Option<&str>) -> Option<String>;
    /// Encodes a set_permission_mode request. Returns None if unsupported.
    fn build_set_permission_mode(&self, _mode: &str) -> Option<String> { None }
    /// Downcast hook so callers can reach driver-specific methods (Codex).
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any;
}

fn make_driver(agent_type: &str) -> Option<Box<dyn AgentDriver>> {
    match agent_type {
        "claude-code" => Some(Box::new(ClaudeCodeDriver::new())),
        "codex" => Some(Box::new(CodexDriver::new())),
        _ => None,
    }
}

// ── ClaudeCodeDriver ──────────────────────────────────────────────────────────

pub struct ClaudeCodeDriver {
    // message id of the currently streaming assistant message
    current_msg_id: Option<String>,
    // msg_id → accumulated text for streaming messages
    streaming_text: HashMap<String, String>,
    // msg_ids processed via stream_event; skip buffered `assistant` for these
    streamed_ids: std::collections::HashSet<String>,
}

impl ClaudeCodeDriver {
    fn new() -> Self {
        Self {
            current_msg_id: None,
            streaming_text: HashMap::new(),
            streamed_ids: std::collections::HashSet::new(),
        }
    }
}

impl AgentDriver for ClaudeCodeDriver {
    fn spawn_command(&mut self, config: &SessionConfig) -> Option<Command> {
        let mut args = vec![
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--include-partial-messages".to_string(),
            "--permission-prompt-tool".to_string(),
            "stdio".to_string(),
        ];
        if let Some(ref p) = config.mcp_config_path {
            args.push("--mcp-config".to_string());
            args.push(p.to_string_lossy().to_string());
        }
        match config.permission_mode.as_deref() {
            Some(mode) if !mode.is_empty() => {
                args.push("--permission-mode".to_string());
                args.push(mode.to_string());
            }
            _ => {}
        }
        if let Some(id) = &config.resume_session_id {
            args.push("--resume".to_string());
            args.push(id.clone());
        }
        #[cfg(target_os = "windows")]
        let mut cmd = {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = Command::new("cmd");
            c.args(["/c", "claude"]);
            c.args(&args);
            c.creation_flags(CREATE_NO_WINDOW);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = Command::new("claude");
            c.args(&args);
            c
        };
        // Inject shell PATH so `claude` is findable in packaged .app bundles
        if let Some(ref path) = config.shell_path {
            cmd.env("PATH", path);
        }
        Some(cmd)
    }

    fn build_user_message(&mut self, content: &str, _session_id: Option<&str>) -> Option<String> {
        let msg = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{ "type": "text", "text": content }]
            }
        });
        Some(serde_json::to_string(&msg).unwrap())
    }

    fn build_interrupt(&self) -> Option<String> {
        let msg = serde_json::json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": { "subtype": "interrupt" }
        });
        Some(serde_json::to_string(&msg).unwrap())
    }

    fn parse_line(&mut self, line: &str) -> DriverOutput {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            return DriverOutput::default();
        };
        let mut events = vec![];
        match val["type"].as_str() {
            Some("system") if val["subtype"].as_str() == Some("init") => {
                if let Some(id) = val["session_id"].as_str() {
                    events.push(DriverEvent::SessionReady { session_id: id.to_string() });
                }
            }
            Some("control_request") => {
                if val["request"]["subtype"].as_str() == Some("can_use_tool") {
                    let req = &val["request"];
                    if let Some(request_id) = val["request_id"].as_str() {
                        events.push(DriverEvent::PermissionRequest {
                            request_id: request_id.to_string(),
                            tool_name: req["tool_name"].as_str().unwrap_or("").to_string(),
                            tool_input: req["input"].clone(),
                        });
                    }
                }
            }
            Some("stream_event") => {
                // The outer wrapper is { "type": "stream_event", "event": {...}, "message": {"id": ...} }
                let ev = &val["event"];
                match ev["type"].as_str() {
                    Some("message_start") => {
                        // message_start carries the message id for all subsequent deltas
                        if let Some(id) = ev["message"]["id"].as_str() {
                            self.current_msg_id = Some(id.to_string());
                            self.streamed_ids.insert(id.to_string());
                        }
                    }
                    Some("content_block_start") => {
                        // text block start — ensure accumulator exists
                        if let Some(ref id) = self.current_msg_id.clone() {
                            if ev["content_block"]["type"].as_str() == Some("text") {
                                self.streaming_text.entry(id.clone()).or_default();
                            }
                        }
                    }
                    Some("content_block_delta") => {
                        if ev["delta"]["type"].as_str() == Some("text_delta") {
                            let delta = ev["delta"]["text"].as_str().unwrap_or("");
                            if !delta.is_empty() {
                                if let Some(ref id) = self.current_msg_id.clone() {
                                    let acc = self.streaming_text.entry(id.clone()).or_default();
                                    acc.push_str(delta);
                                    events.push(DriverEvent::Message { id: id.clone(), text: acc.clone(), thinking: None, is_streaming: true });
                                }
                            }
                        }
                    }
                    Some("message_delta") => {
                        if let Some(tokens) = ev["usage"]["output_tokens"].as_u64() {
                            events.push(DriverEvent::Usage { output_tokens: tokens });
                        }
                    }
                    Some("message_stop") => {
                        self.current_msg_id = None;
                    }
                    _ => {}
                }
            }
            Some("assistant") => {
                let msg_id = val["message"]["id"].as_str().unwrap_or("").to_string();
                let mut text_parts: Vec<String> = vec![];
                let mut thinking: Option<String> = None;
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") => {
                            let t = block["text"].as_str().unwrap_or("").trim().to_string();
                            if !t.is_empty() { text_parts.push(t); }
                        }
                        Some("thinking") if thinking.is_none() => {
                            let t = block["thinking"].as_str().unwrap_or("").trim().to_string();
                            if !t.is_empty() { thinking = Some(t); }
                        }
                        Some("tool_use") => events.push(DriverEvent::ToolUse {
                            id: block["id"].as_str().unwrap_or("").to_string(),
                            name: block["name"].as_str().unwrap_or("").to_string(),
                            input: block["input"].clone(),
                        }),
                        _ => {}
                    }
                }
                let text = text_parts.join("\n");
                if !text.is_empty() || thinking.is_some() {
                    let is_streaming = false;
                    // If this message was already streamed, mark complete and clean up
                    self.streaming_text.remove(&msg_id);
                    self.streamed_ids.remove(&msg_id);
                    if !text.is_empty() {
                        events.push(DriverEvent::Message { id: msg_id, text, thinking, is_streaming });
                    }
                }
            }
            Some("user") => {
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"].as_str() == Some("tool_result") {
                        let content = match &block["content"] {
                            Value::String(s) => s.clone(),
                            Value::Array(arr) => arr
                                .first()
                                .and_then(|b| b["text"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            _ => String::new(),
                        };
                        events.push(DriverEvent::ToolResult {
                            tool_use_id: block["tool_use_id"].as_str().unwrap_or("").to_string(),
                            content,
                        });
                    }
                }
            }
            Some("result") => {
                self.current_msg_id = None;
                self.streaming_text.clear();
                self.streamed_ids.clear();
                let is_error = val["is_error"].as_bool().unwrap_or(false);
                events.push(DriverEvent::Exit {
                    is_error,
                    cost_usd: val["total_cost_usd"].as_f64(),
                    error: val["error"].as_str().map(str::to_string),
                    // Claude's exit event means the process is ending; is_final
                    // mirrors is_error so the read_loop can break on errors
                    // without needing to rewrite the event.
                    is_final: is_error,
                });
            }
            _ => {}
        }
        DriverOutput::events(events)
    }

    fn build_permission_response(&self, request_id: &str, approved: bool, tool_input: Option<&Value>, deny_message: Option<&str>) -> Option<String> {
        let inner = if approved {
            serde_json::json!({
                "behavior": "allow",
                "updatedInput": tool_input.unwrap_or(&Value::Object(Default::default())),
            })
        } else {
            let message = match deny_message {
                Some(reason) if !reason.trim().is_empty() => format!(
                    "The user doesn't want to proceed with this tool use. The tool use was rejected. To tell you how to proceed, the user said:\n{}",
                    reason.trim()
                ),
                _ => "The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing and wait for the user to tell you how to proceed.".to_string(),
            };
            serde_json::json!({ "behavior": "deny", "message": message })
        };
        let msg = serde_json::json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": inner,
            }
        });
        Some(serde_json::to_string(&msg).unwrap())
    }

    fn build_set_permission_mode(&self, mode: &str) -> Option<String> {
        let msg = serde_json::json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": { "subtype": "set_permission_mode", "mode": mode }
        });
        Some(serde_json::to_string(&msg).unwrap())
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any { self }
}

// ── CodexDriver ───────────────────────────────────────────────────────────────
// Drives `codex app-server --stdio`, a JSON-RPC-style protocol (no `jsonrpc`
// field, newline-delimited). Handshake: initialize → initialized → thread/start
// → turn/start. Follow-up turns and approval responses reuse the same instance,
// so thread/turn ids and the approval-id map stay consistent.

#[derive(PartialEq)]
enum CodexState {
    Uninitialized,
    Initializing,
    Ready, // handshake done; can start/resume threads
}

pub struct CodexDriver {
    state: CodexState,
    next_id: i64,
    // The currently-active conversation thread and the client run_id that owns it.
    active_thread_id: Option<String>,
    active_run_id: Option<String>,
    current_turn_id: Option<String>,
    // Set while a thread/start|resume is in flight (for the active run).
    permission_mode: Option<String>,
    pending_prompt: Option<String>,
    pending_run_id: Option<String>,
    // request id (int) we assigned to initialize / thread-start, to route responses
    init_id: Option<i64>,
    start_id: Option<i64>,
    // frontend request_id (itemId) → codex server request id (int)
    approval_ids: HashMap<String, i64>,
    // itemId → accumulated streaming text
    streaming: HashMap<String, String>,
    // management RPCs (thread/list, thread/archive): request id → response channel
    pending_rpc: HashMap<i64, tokio::sync::oneshot::Sender<Value>>,
}

impl CodexDriver {
    fn new() -> Self {
        Self {
            state: CodexState::Uninitialized,
            next_id: 1,
            active_thread_id: None,
            active_run_id: None,
            current_turn_id: None,
            permission_mode: None,
            pending_prompt: None,
            pending_run_id: None,
            init_id: None,
            start_id: None,
            approval_ids: HashMap::new(),
            streaming: HashMap::new(),
            pending_rpc: HashMap::new(),
        }
    }

    /// Register a management RPC: allocate an id + response channel. The caller
    /// builds the request with this id, sends it, and awaits the receiver.
    fn register_rpc(&mut self) -> (i64, tokio::sync::oneshot::Receiver<Value>) {
        let id = self.take_id();
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending_rpc.insert(id, tx);
        (id, rx)
    }

    fn take_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn is_ready(&self) -> bool {
        self.state == CodexState::Ready
    }

    /// Kick off the one-time handshake (initialize). Sent at process spawn,
    /// before any thread exists.
    fn build_handshake(&mut self) -> String {
        let id = self.take_id();
        self.init_id = Some(id);
        self.state = CodexState::Initializing;
        serde_json::json!({
            "id": id,
            "method": "initialize",
            "params": {
                "clientInfo": { "name": "mermaid-code", "version": "1.0.0" },
                "capabilities": { "experimentalApi": true }
            }
        })
        .to_string()
    }

    /// Start (or resume) a thread on the persistent process and queue the first
    /// turn. `run_id` is the client run_id that will own this thread's events.
    /// Returns the thread/start|resume message to send, or None if not ready.
    fn start_thread(
        &mut self,
        run_id: &str,
        cwd: &str,
        resume_id: Option<&str>,
        permission_mode: Option<String>,
        prompt: &str,
    ) -> Option<String> {
        if self.state != CodexState::Ready {
            return None;
        }
        self.permission_mode = permission_mode;
        self.pending_prompt = Some(prompt.to_string());
        self.pending_run_id = Some(run_id.to_string());
        self.active_run_id = Some(run_id.to_string());
        let start_id = self.take_id();
        self.start_id = Some(start_id);
        let (policy, sandbox) = self.policy_and_sandbox();
        let msg = if let Some(rid) = resume_id {
            serde_json::json!({
                "id": start_id,
                "method": "thread/resume",
                "params": { "threadId": rid, "cwd": cwd, "approvalPolicy": policy, "sandbox": sandbox }
            })
        } else {
            serde_json::json!({
                "id": start_id,
                "method": "thread/start",
                "params": { "cwd": cwd, "approvalPolicy": policy, "sandbox": sandbox }
            })
        };
        Some(msg.to_string())
    }

    /// When switching away from the currently-active thread, unsubscribe it so
    /// codex can unload it. We hold one persistent connection and thread/resume
    /// is additive — without this, every session switch leaves the prior thread
    /// loaded in the codex process (visible via thread/loaded/list), accumulating
    /// memory/background tasks over an app session. No-op when there's no active
    /// thread or we're resuming the same one. The string id is ignored by the
    /// response router (it matches only numeric ids).
    fn build_unsubscribe_active(&self, next_resume_id: Option<&str>) -> Option<String> {
        let cur = self.active_thread_id.as_deref()?;
        if Some(cur) == next_resume_id {
            return None;
        }
        Some(
            serde_json::json!({
                "id": "unsubscribe",
                "method": "thread/unsubscribe",
                "params": { "threadId": cur }
            })
            .to_string(),
        )
    }
    /// Forget the active thread/run after it's been dropped (kill_agent_run).
    /// Leaves the persistent process handshaked and ready for the next thread.
    fn clear_active(&mut self) {
        self.active_thread_id = None;
        self.active_run_id = None;
        self.current_turn_id = None;
        self.pending_prompt = None;
        self.pending_run_id = None;
    }

    /// Map the UI permission mode to codex (approvalPolicy, sandbox). Both are
    /// kebab-case strings on the request side. Aligned with codex's runtime
    /// approval modes:
    /// - manual  → untrusted   + read-only      (ask before every action)
    /// - auto    → on-request  + workspace-write (auto in workspace, ask for outside/network)
    /// - acceptEdits → untrusted + workspace-write (edit workspace freely, ask for the rest)
    /// - plan    → on-request  + read-only       (read-only exploration)
    fn policy_and_sandbox(&self) -> (&'static str, &'static str) {
        match self.permission_mode.as_deref() {
            Some("auto") => ("on-request", "workspace-write"),
            Some("acceptEdits") => ("untrusted", "workspace-write"),
            Some("plan") => ("on-request", "read-only"),
            _ => ("untrusted", "read-only"),
        }
    }

    fn turn_start_json(&self, thread_id: &str, prompt: &str) -> String {
        // Note: id here is not tracked; the turn is observed via notifications.
        serde_json::json!({
            "id": format!("turn-{}", thread_id),
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "input": [{ "type": "text", "text": prompt }]
            }
        })
        .to_string()
    }
}

impl AgentDriver for CodexDriver {
    fn spawn_command(&mut self, config: &SessionConfig) -> Option<Command> {
        // The persistent process is spawned once; per-thread params (cwd,
        // permission mode, resume id) are supplied later via start_thread.
        #[cfg(target_os = "windows")]
        let mut cmd = {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = Command::new("cmd");
            c.args(["/c", "codex", "app-server", "--stdio"]);
            c.creation_flags(CREATE_NO_WINDOW);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = Command::new("codex");
            c.args(["app-server", "--stdio"]);
            c
        };
        if let Some(ref path) = config.shell_path {
            cmd.env("PATH", path);
        }
        // Inject mermaid-code MCP server if MCP is running — codex accepts
        // per-run -c overrides in dotted TOML path=value format, no temp file needed.
        if let Some(ref mcp_path) = config.mcp_config_path {
            if let Ok(content) = std::fs::read_to_string(mcp_path) {
                if let Ok(json) = serde_json::from_str::<Value>(&content) {
                    let srv = &json["mcpServers"]["mermaid-code-mcp"];
                    if let (Some(url), Some(auth)) = (
                        srv["url"].as_str(),
                        srv["headers"]["Authorization"].as_str(),
                    ) {
                        let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
                        cmd.args([
                            "-c", &format!("mcp_servers.mermaid-code-mcp.url={url:?}"),
                            "-c", &format!("mcp_servers.mermaid-code-mcp.http_headers.Authorization=\"Bearer {token}\""),
                        ]);
                    }
                }
            }
        }
        Some(cmd)
    }

    fn build_user_message(&mut self, content: &str, _session_id: Option<&str>) -> Option<String> {
        // Follow-up turn on the active thread (the persistent process is always
        // handshaked and has an active thread before this is called).
        let tid = self.active_thread_id.clone()?;
        Some(self.turn_start_json(&tid, content))
    }

    fn build_interrupt(&self) -> Option<String> {
        let tid = self.active_thread_id.as_ref()?;
        let turn = self.current_turn_id.as_ref()?;
        Some(
            serde_json::json!({
                "id": "interrupt",
                "method": "turn/interrupt",
                "params": { "threadId": tid, "turnId": turn }
            })
            .to_string(),
        )
    }

    fn parse_line(&mut self, line: &str) -> DriverOutput {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            return DriverOutput::default();
        };
        let mut out = DriverOutput::default();
        // Route this line's events to the run_id that owns the active thread.
        out.run_id = self.active_run_id.clone();

        let method = val["method"].as_str();
        let has_id = !val["id"].is_null();

        // ── Server→client request (approval) ──
        if let (Some(method), true) = (method, has_id) {
            if method == "item/commandExecution/requestApproval"
                || method == "item/fileChange/requestApproval"
            {
                let codex_id = val["id"].as_i64().unwrap_or(0);
                let p = &val["params"];
                let item_id = p["itemId"].as_str().unwrap_or("").to_string();
                self.approval_ids.insert(item_id.clone(), codex_id);
                let (tool_name, tool_input) = if method.contains("commandExecution") {
                    ("Bash".to_string(), serde_json::json!({ "command": p["command"].as_str().unwrap_or("") }))
                } else {
                    let path = p["changes"][0]["path"].as_str().unwrap_or("");
                    ("Edit".to_string(), serde_json::json!({ "file_path": path }))
                };
                out.events.push(DriverEvent::PermissionRequest {
                    request_id: item_id,
                    tool_name,
                    tool_input,
                });
            }
            return out;
        }

        // ── Response to one of our requests ──
        if has_id && !val["result"].is_null() {
            let id = val["id"].as_i64();
            // Management RPC (thread/list, thread/archive) → route to its waiter.
            if let Some(rpc_id) = id {
                if let Some(tx) = self.pending_rpc.remove(&rpc_id) {
                    let _ = tx.send(val["result"].clone());
                    return DriverOutput::default();
                }
            }
            // initialize response → send `initialized`, become Ready (no auto
            // thread start; start_thread drives thread creation on demand).
            if id == self.init_id && self.state == CodexState::Initializing {
                self.init_id = None;
                self.state = CodexState::Ready;
                out.stdin_writes.push(serde_json::json!({ "method": "initialized" }).to_string());
                return out;
            }
            // thread/start|resume response → active thread ready; fire the queued turn.
            if id == self.start_id {
                self.start_id = None;
                if let Some(tid) = val["result"]["thread"]["id"].as_str() {
                    self.active_thread_id = Some(tid.to_string());
                    out.events.push(DriverEvent::SessionReady { session_id: tid.to_string() });
                    if let Some(prompt) = self.pending_prompt.take() {
                        out.stdin_writes.push(self.turn_start_json(tid, &prompt));
                    }
                }
                return out;
            }
            return out;
        }

        // ── Error response ──
        if has_id && !val["error"].is_null() {
            // If it's a pending management RPC, unblock its waiter with null.
            if let Some(rpc_id) = val["id"].as_i64() {
                if let Some(tx) = self.pending_rpc.remove(&rpc_id) {
                    let _ = tx.send(Value::Null);
                    return DriverOutput::default();
                }
            }
            let msg = val["error"]["message"].as_str().unwrap_or("Codex error").to_string();
            out.events.push(DriverEvent::Exit { is_error: true, cost_usd: None, error: Some(msg), is_final: false });
            return out;
        }

        // ── Notification ──
        let Some(method) = method else { return out; };
        let p = &val["params"];
        // Only surface events for the active thread (decision: single active
        // thread at a time; stale/background thread events are dropped).
        if let Some(tid) = p["threadId"].as_str() {
            if self.active_thread_id.as_deref() != Some(tid) {
                return DriverOutput::default();
            }
        }
        match method {
            "turn/started" => {
                if let Some(tid) = p["turn"]["id"].as_str() {
                    self.current_turn_id = Some(tid.to_string());
                }
            }
            "item/agentMessage/delta" => {
                let item_id = p["itemId"].as_str().unwrap_or("").to_string();
                let delta = p["delta"].as_str().unwrap_or("");
                let acc = self.streaming.entry(item_id.clone()).or_default();
                acc.push_str(delta);
                out.events.push(DriverEvent::Message {
                    id: item_id,
                    text: acc.clone(),
                    thinking: None,
                    is_streaming: true,
                });
            }
            "item/started" => {
                let item = &p["item"];
                let item_id = item["id"].as_str().unwrap_or("").to_string();
                match item["type"].as_str() {
                    Some("commandExecution") => {
                        out.events.push(DriverEvent::ToolUse {
                            id: item_id,
                            name: "Bash".to_string(),
                            input: serde_json::json!({ "command": item["command"].as_str().unwrap_or("") }),
                        });
                    }
                    Some("fileChange") => {
                        let path = item["changes"][0]["path"].as_str().unwrap_or("");
                        out.events.push(DriverEvent::ToolUse {
                            id: item_id,
                            name: "Edit".to_string(),
                            input: serde_json::json!({ "file_path": path }),
                        });
                    }
                    Some("mcpToolCall") => {
                        let name = format!("{}_{}", item["server"].as_str().unwrap_or("mcp"), item["tool"].as_str().unwrap_or("tool"));
                        out.events.push(DriverEvent::ToolUse {
                            id: item_id,
                            name,
                            input: item["arguments"].clone(),
                        });
                    }
                    _ => {}
                }
            }
            "item/completed" => {
                let item = &p["item"];
                let item_id = item["id"].as_str().unwrap_or("").to_string();
                match item["type"].as_str() {
                    Some("agentMessage") => {
                        let text = item["text"].as_str().unwrap_or("").to_string();
                        self.streaming.remove(&item_id);
                        out.events.push(DriverEvent::Message {
                            id: item_id,
                            text,
                            thinking: None,
                            is_streaming: false,
                        });
                    }
                    Some("commandExecution") => {
                        let output = item["aggregatedOutput"].as_str().unwrap_or("").to_string();
                        out.events.push(DriverEvent::ToolResult { tool_use_id: item_id, content: output });
                    }
                    Some("fileChange") => {
                        out.events.push(DriverEvent::ToolResult { tool_use_id: item_id, content: "File updated".to_string() });
                    }
                    Some("mcpToolCall") => {
                        // v2 item: success payload in `result.content[]`, failure in
                        // `error` (separate fields — not a Rust Result Ok/Err wrapper).
                        let content = item["result"]["content"][0]["text"].as_str()
                            .map(|s| s.to_string())
                            .or_else(|| item["error"]["message"].as_str().map(|s| s.to_string()))
                            .or_else(|| item["error"].as_str().map(|s| s.to_string()))
                            .unwrap_or_default();
                        out.events.push(DriverEvent::ToolResult { tool_use_id: item_id, content });
                    }
                    _ => {}
                }
            }
            "thread/tokenUsage/updated" => {
                // `last` is the most-recent response's breakdown, matching the
                // frontend's per-turn live counter (reset to 0 on turn exit).
                if let Some(t) = p["tokenUsage"]["last"]["outputTokens"].as_u64() {
                    out.events.push(DriverEvent::Usage { output_tokens: t });
                }
            }
            "turn/completed" => {
                self.current_turn_id = None;
                match p["turn"]["status"].as_str() {
                    Some("failed") => {
                        let msg = p["turn"]["error"]["message"].as_str().unwrap_or("Turn failed").to_string();
                        out.events.push(DriverEvent::Exit { is_error: true, cost_usd: None, error: Some(msg), is_final: false });
                    }
                    _ => {
                        // completed or interrupted — turn is done, process stays alive
                        out.events.push(DriverEvent::Exit { is_error: false, cost_usd: None, error: None, is_final: false });
                    }
                }
            }
            _ => {}
        }
        out
    }

    fn build_permission_response(&self, request_id: &str, approved: bool, _tool_input: Option<&Value>, _deny_message: Option<&str>) -> Option<String> {
        let codex_id = self.approval_ids.get(request_id)?;
        Some(
            serde_json::json!({
                "id": codex_id,
                "result": { "decision": if approved { "accept" } else { "decline" } }
            })
            .to_string(),
        )
    }

    fn build_set_permission_mode(&self, mode: &str) -> Option<String> {
        let tid = self.active_thread_id.as_ref()?;
        // sandboxPolicy is an object (tagged union) on thread/settings/update,
        // unlike the kebab string used on thread/start.
        let (approval_policy, sandbox_policy) = match mode {
            "auto"         => ("on-request", serde_json::json!({ "type": "workspaceWrite" })),
            "acceptEdits"  => ("untrusted",  serde_json::json!({ "type": "workspaceWrite" })),
            "plan"         => ("on-request", serde_json::json!({ "type": "readOnly" })),
            _              => ("untrusted",  serde_json::json!({ "type": "readOnly" })),
        };
        Some(
            serde_json::json!({
                "id": "settings-update",
                "method": "thread/settings/update",
                "params": {
                    "threadId": tid,
                    "approvalPolicy": approval_policy,
                    "sandboxPolicy": sandbox_policy
                }
            })
            .to_string(),
        )
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any { self }
}

// ── Session config ────────────────────────────────────────────────────────────

pub struct SessionConfig {
    pub prompt: String,
    pub mcp_config_path: Option<PathBuf>,
    pub resume_session_id: Option<String>,
    pub shell_path: Option<String>,
    pub permission_mode: Option<String>,
}

// ── AgentManager ──────────────────────────────────────────────────────────────

pub struct AgentRun {
    pub run_id: String,
    pub agent_type: String,
    pub folder_path: String,
    pub session_id: Option<String>,
    pub stdin_tx: mpsc::Sender<String>,
    pub driver: std::sync::Arc<Mutex<Box<dyn AgentDriver>>>,
    #[allow(dead_code)] // drop triggers kill_rx in the read loop's select!
    pub kill_tx: tokio::sync::oneshot::Sender<()>,
}

/// The single persistent Codex `app-server` process. Started when Codex is
/// first used, alive until app exit. Handles all Codex conversations (each is a
/// thread) — new/resume reuse this process rather than spawning.
pub struct CodexHandle {
    pub stdin_tx: mpsc::Sender<String>,
    pub driver: std::sync::Arc<Mutex<Box<dyn AgentDriver>>>,
    /// Client run_ids routed to this process (one per session started here).
    pub run_ids: std::collections::HashSet<String>,
    #[allow(dead_code)]
    pub kill_tx: tokio::sync::oneshot::Sender<()>,
}

pub struct AgentManager {
    runs: HashMap<String, AgentRun>,
    /// Persistent Codex process (None until first Codex use / after crash).
    codex: Option<CodexHandle>,
    /// Serializes `ensure_codex_process` so two concurrent callers (e.g. the
    /// CLI-check effect and the session-list effect firing on the same agent
    /// switch) can't both pass the `codex.is_none()` check and spawn duplicate
    /// processes — the loser's handle would get dropped, and its read-loop
    /// cleanup would then wipe `codex = None`, breaking the survivor.
    codex_starting: std::sync::Arc<Mutex<()>>,
    /// PATH captured from the user's login+interactive shell at startup.
    /// Used to ensure `claude` is findable even in packaged .app bundles
    /// that inherit only launchd's minimal PATH.
    pub shell_path: Option<String>,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self {
            runs: HashMap::new(),
            codex: None,
            codex_starting: std::sync::Arc::new(Mutex::new(())),
            shell_path: None,
        }
    }
}

impl AgentManager {
    /// Resolve (driver, stdin_tx, session_id) for a run_id — either a per-run
    /// Claude process or the shared persistent Codex process.
    fn resolve(
        &self,
        run_id: &str,
    ) -> Option<(std::sync::Arc<Mutex<Box<dyn AgentDriver>>>, mpsc::Sender<String>, Option<String>)> {
        if let Some(run) = self.runs.get(run_id) {
            return Some((run.driver.clone(), run.stdin_tx.clone(), run.session_id.clone()));
        }
        if let Some(codex) = &self.codex {
            if codex.run_ids.contains(run_id) {
                return Some((codex.driver.clone(), codex.stdin_tx.clone(), None));
            }
        }
        None
    }
}

pub struct AgentManagerState(pub Mutex<AgentManager>);

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Write a temp mcp.json for the running MCP server, or None if MCP isn't up.
async fn build_mcp_config(app: &AppHandle) -> Option<PathBuf> {
    tokio::net::TcpStream::connect(format!("127.0.0.1:{MCP_SERVER_PORT}")).await.ok()?;
    let token = {
        let mcp_state = app.state::<McpServerState>();
        let guard = mcp_state.0.lock().await;
        guard.as_ref()?.token.clone()
    };
    let data_dir = app.path().app_data_dir().ok()?;
    let run_dir = data_dir.join("agent-runs").join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&run_dir).await.ok()?;
    let path = run_dir.join("mcp.json");
    let mcp_json = serde_json::json!({
        "mcpServers": {
            "mermaid-code-mcp": {
                "type": "http",
                "url": format!("http://127.0.0.1:{MCP_SERVER_PORT}/mcp"),
                "headers": { "Authorization": format!("Bearer {token}") }
            }
        }
    });
    tokio::fs::write(&path, serde_json::to_string_pretty(&mcp_json).unwrap()).await.ok()?;
    Some(path)
}

/// Poll for the shell PATH captured at startup (up to ~3s).
async fn wait_shell_path(app: &AppHandle) -> Option<String> {
    let state = app.state::<AgentManagerState>();
    let mut path = None;
    for _ in 0..15 {
        path = state.0.lock().await.shell_path.clone();
        if path.is_some() { break; }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    path
}

/// Ensure the persistent Codex process exists and is handshaked (Ready).
/// Idempotent; blocks until the handshake completes (or times out).
async fn ensure_codex_process(app: &AppHandle) -> Result<(), String> {
    // Serialize concurrent starts: clone the startup lock (brief manager-lock
    // hold), then hold it for the whole check-and-spawn so a second caller waits
    // and then sees the process already exists instead of spawning a duplicate.
    let startup_lock = {
        let state = app.state::<AgentManagerState>();
        let mgr = state.0.lock().await;
        mgr.codex_starting.clone()
    };
    let _startup_guard = startup_lock.lock().await;

    let already = {
        let state = app.state::<AgentManagerState>();
        let mgr = state.0.lock().await;
        mgr.codex.is_some()
    };
    if already {
        return wait_codex_ready(app).await;
    }
    let mcp_config_path = build_mcp_config(app).await;
    let shell_path = wait_shell_path(app).await;

    let mut driver: Box<dyn AgentDriver> = Box::new(CodexDriver::new());
    let config = SessionConfig {
        prompt: String::new(),
        mcp_config_path,
        resume_session_id: None,
        shell_path,
        permission_mode: None,
    };
    let mut cmd = driver.spawn_command(&config).ok_or("Failed to build codex command")?;
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn codex: {e}"))?;

    // The mcp.json is only a carrier: spawn_command already read it and baked the
    // url/token into `-c` overrides, so the running codex never touches the file
    // (unlike Claude, which is handed it via --mcp-config for the process lifetime).
    // Delete it and its unique run dir now so these token files don't accumulate
    // across launches — the persistent process's read loop passes None, so nothing
    // else cleans it up.
    if let Some(ref p) = config.mcp_config_path {
        let _ = tokio::fs::remove_file(p).await;
        if let Some(dir) = p.parent() {
            let _ = tokio::fs::remove_dir(dir).await;
        }
    }

    let stdout = child.stdout.take().unwrap();
    let stdin = child.stdin.take().unwrap();
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);

    // Kick off the handshake (initialize).
    if let Some(codex) = driver.as_any_mut().downcast_mut::<CodexDriver>() {
        let _ = stdin_tx.send(codex.build_handshake()).await;
    }

    let driver = std::sync::Arc::new(Mutex::new(driver));

    // Pump stdin
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(msg) = stdin_rx.recv().await {
            let line = if msg.ends_with('\n') { msg } else { msg + "\n" };
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    // read loop with a sentinel run_id (real events carry per-thread run_id via
    // DriverOutput.run_id). On exit, drop the handle so the next use re-spawns.
    let app2 = app.clone();
    let driver_for_loop = driver.clone();
    let stdin_tx_for_loop = stdin_tx.clone();
    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mgr_state = app.state::<AgentManagerState>();
        let mut mgr = mgr_state.0.lock().await;
        mgr.codex = Some(CodexHandle {
            stdin_tx,
            driver,
            run_ids: std::collections::HashSet::new(),
            kill_tx,
        });
    }

    tokio::spawn(async move {
        tokio::select! {
            _ = read_loop(app2.clone(), "codex-persistent".to_string(), stdout, driver_for_loop, None, stdin_tx_for_loop) => {}
            _ = kill_rx => { child.kill().await.ok(); }
        }
        // Process ended (crash or shutdown): clear so it can be re-spawned.
        let mgr_state = app2.state::<AgentManagerState>();
        mgr_state.0.lock().await.codex = None;
    });

    wait_codex_ready(app).await
}

/// Poll until the persistent Codex driver finishes its handshake (Ready).
async fn wait_codex_ready(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    for _ in 0..100 {
        let ready = {
            let mgr = state.0.lock().await;
            match &mgr.codex {
                Some(c) => {
                    let mut d = c.driver.lock().await;
                    d.as_any_mut()
                        .downcast_mut::<CodexDriver>()
                        .map(|cd| cd.is_ready())
                        .unwrap_or(false)
                }
                None => return Err("Codex process exited during startup".into()),
            }
        };
        if ready {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("Codex handshake timed out".into())
}

#[derive(Deserialize)]
pub struct StartAgentParams {
    pub prompt: String,
    pub folder_path: String,
    pub agent_type: String,
    pub resume_session_id: Option<String>,
    pub permission_mode: Option<String>,
    // Client-supplied run id. The frontend generates it and registers its event
    // listener *before* invoking, so the persistent Codex process can't emit
    // session_ready before runOwner is set (a race that dropped the event).
    pub run_id: Option<String>,
}

#[derive(Serialize)]
pub struct RunSummary {
    pub run_id: String,
    pub agent_type: String,
    pub folder_path: String,
    pub session_id: Option<String>,
}

#[tauri::command]
pub async fn start_agent_session(
    app: AppHandle,
    params: StartAgentParams,
) -> Result<String, String> {
    // ── Codex: reuse the persistent process (start/resume a thread on it) ──
    if params.agent_type == "codex" {
        ensure_codex_process(&app).await?;
        let run_id = params
            .run_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let state = app.state::<AgentManagerState>();
        let (stdin_tx, msgs) = {
            let mut mgr = state.0.lock().await;
            let handle = mgr.codex.as_mut().ok_or("Codex process not available")?;
            handle.run_ids.insert(run_id.clone());
            let stdin_tx = handle.stdin_tx.clone();
            let mut d = handle.driver.lock().await;
            let codex = d.as_any_mut().downcast_mut::<CodexDriver>()
                .ok_or("Codex driver missing")?;
            let mut msgs: Vec<String> = vec![];
            // Interrupt any in-flight turn before switching threads.
            if let Some(interrupt) = codex.build_interrupt() {
                msgs.push(interrupt);
            }
            // Unsubscribe the thread we're leaving so codex can unload it
            // (no-op when starting fresh or resuming the same thread).
            if let Some(unsub) = codex.build_unsubscribe_active(params.resume_session_id.as_deref()) {
                msgs.push(unsub);
            }
            let start = codex
                .start_thread(
                    &run_id,
                    &params.folder_path,
                    params.resume_session_id.as_deref(),
                    params.permission_mode.clone(),
                    &params.prompt,
                )
                .ok_or("Codex not ready")?;
            msgs.push(start);
            (stdin_tx, msgs)
        };
        for m in msgs {
            stdin_tx.send(m).await.map_err(|e| e.to_string())?;
        }
        return Ok(run_id);
    }

    // ── Claude Code (and other per-run agents): spawn a dedicated process ──
    // If MCP is already running, inject its config; otherwise start without MCP
    let mcp_config_path: Option<PathBuf> = async {
        // Verify MCP server is actually listening before passing config
        tokio::net::TcpStream::connect(format!("127.0.0.1:{MCP_SERVER_PORT}"))
            .await.ok()?;
        let token = {
            let mcp_state = app.state::<McpServerState>();
            let guard = mcp_state.0.lock().await;
            guard.as_ref()?.token.clone()
        };
        let data_dir = app.path().app_data_dir().ok()?;
        let run_dir = data_dir.join("agent-runs").join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&run_dir).await.ok()?;
        let path = run_dir.join("mcp.json");
        let mcp_json = serde_json::json!({
            "mcpServers": {
                "mermaid-code-mcp": {
                    "type": "http",
                    "url": format!("http://127.0.0.1:{MCP_SERVER_PORT}/mcp"),
                    "headers": { "Authorization": format!("Bearer {token}") }
                }
            }
        });
        tokio::fs::write(&path, serde_json::to_string_pretty(&mcp_json).unwrap()).await.ok()?;
        Some(path)
    }.await;

    let run_id = params
        .run_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Build the driver — a single shared instance used by both the read loop
    // (parse_line) and the command handlers (build_* methods), so protocol
    // state (Codex thread/turn ids, approval-id map) stays consistent.
    let agent_type = params.agent_type.as_str();
    let driver: Box<dyn AgentDriver> = make_driver(agent_type)
        .ok_or_else(|| format!("Unknown agent type: {}", params.agent_type))?;
    let driver = std::sync::Arc::new(Mutex::new(driver));

    let shell_path = {
        let state = app.state::<AgentManagerState>();
        let mut path = None;
        for _ in 0..15 {
            path = state.0.lock().await.shell_path.clone();
            if path.is_some() { break; }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        path
    };

    let config = SessionConfig {
        prompt: params.prompt,
        mcp_config_path: mcp_config_path.clone(),
        resume_session_id: params.resume_session_id,
        shell_path,
        permission_mode: params.permission_mode,
    };

    // Spawn process
    let mut cmd = driver
        .lock()
        .await
        .spawn_command(&config)
        .ok_or_else(|| format!("Agent type '{}' uses HTTP mode, not yet implemented", params.agent_type))?;
    let mut child = cmd
        .current_dir(&params.folder_path)
        .stdout(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn agent: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stdin = child.stdin.take().unwrap();

    // Channel for sending control messages to stdin
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(32);

    // Send initial prompt message
    if let Some(initial) = driver.lock().await.build_user_message(&config.prompt, config.resume_session_id.as_deref()) {
        let _ = stdin_tx.send(initial).await;
    }

    // Pump stdin_rx → process stdin
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(msg) = stdin_rx.recv().await {
            let line = if msg.ends_with('\n') { msg } else { msg + "\n" };
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    // Spawn read loop; child is moved in to keep the process alive
    let rid = run_id.clone();
    let app2 = app.clone();
    let stdin_tx_for_loop = stdin_tx.clone();
    let driver_for_loop = driver.clone();
    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

    // Register run
    {
        let mgr_state = app.state::<AgentManagerState>();
        let mut mgr = mgr_state.0.lock().await;
        mgr.runs.insert(run_id.clone(), AgentRun {
            run_id: run_id.clone(),
            agent_type: params.agent_type,
            folder_path: params.folder_path,
            session_id: None,
            stdin_tx,
            driver,
            kill_tx,
        });
    }
    let mcp_path_for_kill = mcp_config_path.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = read_loop(app2.clone(), rid.clone(), stdout, driver_for_loop, mcp_config_path, stdin_tx_for_loop) => {}
            _ = kill_rx => {
                child.kill().await.ok();
                let _ = app2.emit("agent-event", serde_json::json!({
                    "run_id": &rid,
                    "event": DriverEvent::Exit { is_error: false, cost_usd: None, error: None, is_final: true },
                }));
                if let Some(ref p) = mcp_path_for_kill {
                    let _ = tokio::fs::remove_file(p).await;
                }
            }
        }
        let mgr_state = app2.state::<AgentManagerState>();
        mgr_state.0.lock().await.runs.remove(&rid);
    });

    Ok(run_id)
}

async fn read_loop(
    app: AppHandle,
    run_id: String,
    stdout: tokio::process::ChildStdout,
    driver: std::sync::Arc<Mutex<Box<dyn AgentDriver>>>,
    mcp_config_path: Option<PathBuf>,
    stdin_tx: mpsc::Sender<String>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut in_turn = false;
    let mut had_any_output = false;
    let mut exited_via_error = false; // true when we break due to an error exit event

    'outer: while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }

        let output = driver.lock().await.parse_line(&line);
        // Pump any protocol replies the driver needs to send back to the agent
        for msg in output.stdin_writes {
            let _ = stdin_tx.send(msg).await;
        }

        // The persistent Codex process routes events to the client run_id that
        // owns the active thread; other drivers use this loop's run_id.
        let emit_run_id = output.run_id.clone().unwrap_or_else(|| run_id.clone());

        for event in output.events {
            had_any_output = true;
            in_turn = true;

            // Store session_id when Claude Code reports it
            if let DriverEvent::SessionReady { ref session_id } = event {
                let mgr_state = app.state::<AgentManagerState>();
                let mut mgr = mgr_state.0.lock().await;
                if let Some(run) = mgr.runs.get_mut(&run_id) {
                    run.session_id = Some(session_id.clone());
                }
            }

            // Let the driver control is_final directly — Claude sets it on
            // error exits (process ending), Codex keeps it false on turn
            // failures (process stays alive for the next turn).
            let event = match event {
                DriverEvent::Exit { is_error, cost_usd, error, is_final } => {
                    in_turn = false;
                    DriverEvent::Exit { is_error, cost_usd, error, is_final }
                }
                other => other,
            };

            let should_break = matches!(&event, DriverEvent::Exit { is_final: true, .. });
            let _ = app.emit("agent-event", serde_json::json!({
                "run_id": &emit_run_id,
                "event": &event,
            }));
            if should_break {
                exited_via_error = true;
                break 'outer;
            }
        }
    }

    // EOF: only emit a final exit if we didn't already emit one via the error-exit path
    if !exited_via_error {
        if in_turn || !had_any_output {
            let _ = app.emit("agent-event", serde_json::json!({
                "run_id": &run_id,
                "event": DriverEvent::Exit {
                    is_error: true,
                    cost_usd: None,
                    error: Some("Process exited unexpectedly".to_string()),
                    is_final: true,
                },
            }));
        } else {
            // Process exited cleanly between turns (stdin closed / app shutting down)
            let _ = app.emit("agent-event", serde_json::json!({
                "run_id": &run_id,
                "event": DriverEvent::Exit { is_error: false, cost_usd: None, error: None, is_final: true },
            }));
        }
    }

    if let Some(ref p) = mcp_config_path {
        let _ = tokio::fs::remove_file(p).await;
    }
}

/// Capture PATH from the user's login+interactive shell.
/// Called once at startup; result cached in AgentManager.
#[cfg(not(target_os = "windows"))]
pub async fn capture_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // `-l -i` = login + interactive, loads .zprofile + .zshrc (or bash equivalents)
    let out = tokio::process::Command::new(&shell)
        .args(["-l", "-i", "-c", "printf '%s' \"$PATH\""])
        .env("PS1", "")   // suppress prompt output
        .env("PROMPT", "")
        .output()
        .await
        .ok()?;
    if out.status.success() {
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !path.is_empty() { return Some(path); }
    }
    None
}

fn sanitize_path(folder_path: &str) -> String {
    folder_path
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect()
}

// ── Codex session helpers ──────────────────────────────────────────────────────
// Codex stores sessions at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl,
// organized by date (not by project). Each file's `session_meta` line records
// the cwd, which we use to filter sessions by working folder.

fn codex_collect_jsonl(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                codex_collect_jsonl(&p, out);
            } else if p.extension().map(|x| x == "jsonl").unwrap_or(false) {
                out.push(p);
            }
        }
    }
}

/// Locate a codex rollout file by session id (files are named `*-<id>.jsonl`).
fn codex_find_session_file(root: &std::path::Path, session_id: &str) -> Option<PathBuf> {
    let mut files = vec![];
    codex_collect_jsonl(root, &mut files);
    let suffix = format!("{session_id}.jsonl");
    files.into_iter().find(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(&suffix))
            .unwrap_or(false)
    })
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    // Session IDs must be UUIDs — reject anything that could cause path traversal
    if session_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') && !session_id.is_empty() {
        Ok(())
    } else {
        Err(format!("Invalid session_id: {session_id}"))
    }
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub first_prompt: Option<String>,
}

#[tauri::command]
pub async fn list_folder_sessions(
    app: AppHandle,
    agent_type: String,
    folder_path: String,
) -> Result<Vec<SessionInfo>, String> {
    match agent_type.as_str() {
        "claude-code" => {
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let key = sanitize_path(&folder_path);
            let dir = home.join(".claude").join("projects").join(key);
            let mut entries = match tokio::fs::read_dir(&dir).await {
                Ok(e) => e,
                Err(_) => return Ok(vec![]),
            };
            let mut sessions: Vec<(std::time::SystemTime, SessionInfo)> = vec![];
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if let Some(id) = name.strip_suffix(".jsonl") {
                    let meta = entry.metadata().await;
                    if meta.as_ref().map(|m| m.is_file()).unwrap_or(false) {
                        let mtime = meta.ok()
                            .and_then(|m| m.modified().ok())
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        let first_prompt = read_first_prompt(&entry.path()).await;
                        sessions.push((mtime, SessionInfo {
                            session_id: id.to_string(),
                            first_prompt,
                        }));
                    }
                }
            }
            // Most recently modified first
            sessions.sort_by(|a, b| b.0.cmp(&a.0));
            Ok(sessions.into_iter().map(|(_, s)| s).collect())
        }
        "codex" => {
            // Query the persistent process via thread/list (cwd-filtered, state-DB
            // backed). Falls back to an empty list if the process isn't ready.
            ensure_codex_process(&app).await?;
            let state = app.state::<AgentManagerState>();
            let (rx, req, tx) = {
                let mut mgr = state.0.lock().await;
                let handle = mgr.codex.as_mut().ok_or("Codex process not available")?;
                let stdin_tx = handle.stdin_tx.clone();
                let mut d = handle.driver.lock().await;
                let codex = d.as_any_mut().downcast_mut::<CodexDriver>().ok_or("Codex driver missing")?;
                let (id, rx) = codex.register_rpc();
                let req = serde_json::json!({
                    "id": id,
                    "method": "thread/list",
                    // sortKey=updated_at (desc is the default) puts the most
                    // recently active session on top, matching the Claude branch
                    // which sorts by rollout file mtime.
                    "params": {
                        "cwd": folder_path,
                        "sourceKinds": ["cli", "vscode", "appServer"],
                        "sortKey": "updated_at"
                    }
                }).to_string();
                (rx, req, stdin_tx)
            };
            tx.send(req).await.map_err(|e| e.to_string())?;
            let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
                .await
                .map_err(|_| "thread/list timed out".to_string())?
                .map_err(|_| "thread/list channel closed".to_string())?;
            let mut sessions = vec![];
            if let Some(data) = result["data"].as_array() {
                for t in data {
                    let Some(id) = t["id"].as_str() else { continue };
                    // Prefer the explicit thread name (set via thread/name/set);
                    // fall back to the auto first-message preview.
                    let label = t["name"].as_str()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .or_else(|| t["preview"].as_str().map(|s| s.trim()).filter(|s| !s.is_empty()))
                        .map(|s| s.to_string());
                    sessions.push(SessionInfo { session_id: id.to_string(), first_prompt: label });
                }
            }
            Ok(sessions)
        }
        _ => Err(format!("Agent type '{agent_type}' does not support session listing")),
    }
}

fn is_injected_content(text: &str) -> bool {
    // Skip IDE context injections, task notifications, etc. — all start with a lowercase XML tag
    let t = text.trim_start();
    if t.starts_with('<') {
        let tag_end = t[1..].find(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
        if let Some(end) = tag_end {
            let tag = &t[1..end + 1];
            return !tag.is_empty() && tag.chars().next().map(|c| c.is_lowercase()).unwrap_or(false);
        }
    }
    false
}

fn extract_session_name(content: &serde_json::Value) -> Option<String> {
    if let Some(s) = content.as_str() {
        let t = s.trim().to_string();
        if !t.is_empty() && !is_injected_content(&t) {
            return Some(parse_command_display_text(&t).unwrap_or(t));
        }
        return None;
    }
    if let Some(arr) = content.as_array() {
        for block in arr {
            if block["type"].as_str() != Some("text") { continue; }
            let t = block["text"].as_str().unwrap_or("").trim();
            if t.is_empty() || is_injected_content(t) { continue; }
            let t = t.to_string();
            return Some(parse_command_display_text(&t).unwrap_or(t));
        }
    }
    None
}

fn extract_text(content: &serde_json::Value) -> Option<String> {
    const SYNTHETIC_PREFIXES: &[&str] = &[
        "<ide_opened_file>",
        "<ide_selection>",
        "<local-command-stdout>",
        "<local-command-stderr>",
        "<local-command-caveat>",
        "<task-notification>",
        "<ide-context>",
        "<user-prompt-submit-hook>",
        "<system-reminder>",
        "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
    ];
    let is_synthetic = |t: &str| SYNTHETIC_PREFIXES.iter().any(|p| t.starts_with(p));

    let text = if let Some(s) = content.as_str() {
        let t = s.trim().to_string();
        if is_synthetic(&t) { return None; }
        t
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .filter(|b| b["type"].as_str() == Some("text"))
            .filter_map(|b| b["text"].as_str())
            .map(|t| t.trim())
            .filter(|t| !t.is_empty() && !is_synthetic(t))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        return None;
    };
    if text.is_empty() { None } else { Some(parse_command_display_text(&text).unwrap_or(text)) }
}

/// If `text` is purely Claude Code slash-command metadata XML
/// (e.g. `<command-name>mcp</command-name><command-args>...</command-args>`),
/// return the human-readable label (e.g. `/mcp`).  Returns None when the text
/// is NOT command metadata and should be used as-is.
fn parse_command_display_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    // Must contain a <command-name> tag
    if !trimmed.contains("<command-name>") { return None; }
    // Extract command-name
    let name = extract_xml_tag(trimmed, "command-name")?;
    let args = extract_xml_tag(trimmed, "command-args").unwrap_or_default();
    let skill_format = extract_xml_tag(trimmed, "skill-format").as_deref() == Some("true");
    let command_message = extract_xml_tag(trimmed, "command-message");
    if skill_format {
        return Some(format!("Skill({})", command_message.as_deref().unwrap_or(&name)));
    }
    let normalized = if name.starts_with('/') { name.clone() } else { format!("/{name}") };
    let args = args.trim().to_string();
    if args.is_empty() { Some(normalized) } else { Some(format!("{normalized} {args}")) }
}

fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    let value = text[start..end].trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}

async fn read_first_prompt(path: &std::path::Path) -> Option<String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let file = tokio::fs::File::open(path).await.ok()?;
    let mut lines = BufReader::new(file).lines();
    let mut ai_title: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut last_prompt_fallback: Option<String> = None;
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        match val["type"].as_str() {
            Some("ai-title") => {
                if let Some(t) = val["aiTitle"].as_str() {
                    let t = t.trim().to_string();
                    if !t.is_empty() { ai_title = Some(t); }
                }
            }
            Some("last-prompt") => {
                if first_prompt.is_none() && last_prompt_fallback.is_none() {
                    if let Some(t) = val["lastPrompt"].as_str() {
                        let t = t.trim().to_string();
                        if !t.is_empty() {
                            last_prompt_fallback = Some(parse_command_display_text(&t).unwrap_or(t));
                        }
                    }
                }
            }
            Some("user") if first_prompt.is_none()
                && val["message"]["role"].as_str() == Some("user")
                && val["origin"]["kind"].as_str() != Some("task-notification") =>
            {
                let content = &val["message"]["content"];
                if let Some(arr) = content.as_array() {
                    if arr.iter().any(|b| b["type"].as_str() == Some("tool_result")) { continue; }
                }
                if let Some(text) = extract_session_name(content) {
                    first_prompt = Some(text);
                }
            }
            _ => {}
        }
    }
    ai_title.or(first_prompt).or(last_prompt_fallback)
}

fn extract_selected_code(content: &serde_json::Value) -> Vec<SelectedCode> {
    fn parse_one(text: &str) -> Vec<SelectedCode> {
        let mut result = vec![];
        let mut search = text;
        while let Some(start) = search.find("<ide_selection>") {
            let rest = &search[start + "<ide_selection>".len()..];
            if let Some(end) = rest.find("</ide_selection>") {
                let inner = rest[..end].trim();
                // Format: "The user selected the lines {s} to {e} from {path}:\n{symbol}\n\n..."
                if let Some(rest) = inner.strip_prefix("The user selected the lines ") {
                    if let Some(from_pos) = rest.find(" from ") {
                        let range = &rest[..from_pos];
                        let after_from = &rest[from_pos + " from ".len()..];
                        // path ends at first '\n', symbol is the next line
                        let (file, symbol) = if let Some(nl) = after_from.find('\n') {
                            let file = after_from[..nl].trim_end_matches(':').trim().to_string();
                            let sym = after_from[nl + 1..].lines().next().unwrap_or("").trim().to_string();
                            let sym = if sym.is_empty() { None } else { Some(sym) };
                            (file, sym)
                        } else {
                            (after_from.trim_end_matches(':').trim().to_string(), None)
                        };
                        let (start_line, end_line) = if let Some(mid) = range.find(" to ") {
                            let s = range[..mid].trim().parse::<u32>().unwrap_or(0);
                            let e = range[mid + " to ".len()..].trim().parse::<u32>().unwrap_or(0);
                            (s, e)
                        } else { (0, 0) };
                        if !file.is_empty() {
                            result.push(SelectedCode { file, start_line, end_line, symbol });
                        }
                    }
                }
                search = &rest[end + "</ide_selection>".len()..];
            } else { break; }
        }
        result
    }

    if let Some(s) = content.as_str() {
        return parse_one(s.trim());
    }
    if let Some(arr) = content.as_array() {
        return arr.iter()
            .filter_map(|b| {
                if b["type"].as_str() != Some("text") { return None; }
                let t = b["text"].as_str()?.trim();
                if t.contains("<ide_selection>") { Some(parse_one(t)) } else { None }
            })
            .flatten()
            .collect();
    }
    vec![]
}

fn extract_opened_files(content: &serde_json::Value) -> Vec<String> {
    let re = |text: &str| -> Vec<String> {
        let mut files = vec![];
        let mut search = text;
        while let Some(start) = search.find("<ide_opened_file>") {
            let rest = &search[start + "<ide_opened_file>".len()..];
            if let Some(end) = rest.find("</ide_opened_file>") {
                let inner = &rest[..end];
                // "The user opened the file {path} in the IDE. This may or may not be related to the current task."
                if let Some(path_start) = inner.find("The user opened the file ") {
                    let after = &inner[path_start + "The user opened the file ".len()..];
                    // Path ends at " in the IDE"
                    let path = if let Some(end) = after.find(" in the IDE") {
                        after[..end].trim().to_string()
                    } else {
                        after.trim().to_string()
                    };
                    if !path.is_empty() { files.push(path); }
                }
                search = &rest[end + "</ide_opened_file>".len()..];
            } else {
                break;
            }
        }
        files
    };

    if let Some(s) = content.as_str() { return re(s); }
    if let Some(arr) = content.as_array() {
        return arr.iter()
            .filter(|b| b["type"].as_str() == Some("text"))
            .filter_map(|b| b["text"].as_str())
            .flat_map(|t| re(t))
            .collect();
    }
    vec![]
}

#[derive(Serialize)]
pub struct SelectedCode {
    pub file: String,
    pub start_line: u32,
    pub end_line: u32,
    pub symbol: Option<String>,
}

#[derive(Serialize)]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
    pub thinking: Option<String>,
    pub tool_name: Option<String>,
    pub tool_use_id: Option<String>,
    pub opened_files: Vec<String>,
    pub selected_code: Vec<SelectedCode>,
}

#[tauri::command]
pub async fn load_session_history(
    app: AppHandle,
    agent_type: String,
    folder_path: String,
    session_id: String,
) -> Result<Vec<HistoryMessage>, String> {
    match agent_type.as_str() {
        "claude-code" => {
            validate_session_id(&session_id)?;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let key = sanitize_path(&folder_path);
            let path = home
                .join(".claude")
                .join("projects")
                .join(key)
                .join(format!("{session_id}.jsonl"));

            use tokio::io::{AsyncBufReadExt, BufReader};
            let file = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
            let mut lines = BufReader::new(file).lines();
            let mut messages: Vec<HistoryMessage> = vec![];

            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                match val["type"].as_str() {
                    Some("user") => {
                        if val["message"]["role"].as_str() != Some("user") { continue; }
                        // Skip task-notification injections
                        if val["origin"]["kind"].as_str() == Some("task-notification") { continue; }
                        let content = &val["message"]["content"];
                        // Extract tool_result messages as separate history entries
                        if let Some(arr) = content.as_array() {
                            if arr.iter().any(|b| b["type"].as_str() == Some("tool_result")) {
                                for block in arr {
                                    if block["type"].as_str() != Some("tool_result") { continue; }
                                    let text = match &block["content"] {
                                        v if v.is_array() => v.as_array().unwrap()
                                            .iter()
                                            .filter_map(|b| b["text"].as_str())
                                            .collect::<Vec<_>>()
                                            .join("\n"),
                                        v if v.is_string() => v.as_str().unwrap_or("").to_string(),
                                        _ => continue,
                                    };
                                    messages.push(HistoryMessage {
                                        role: "tool_result".into(),
                                        text,
                                        thinking: None,
                                        tool_name: None,
                                        tool_use_id: block["tool_use_id"].as_str().map(|s| s.to_string()),
                                        opened_files: vec![],
                                        selected_code: vec![],
                                    });
                                }
                                continue;
                            }
                        }
                        // Skip isMeta entries (harness-injected metadata)
                        if val["isMeta"].as_bool() == Some(true) { continue; }
                        let text = extract_text(content).unwrap_or_default();
                        let opened_files = extract_opened_files(content);
                        let selected_code = extract_selected_code(content);
                        if !text.is_empty() || !opened_files.is_empty() || !selected_code.is_empty() {
                            messages.push(HistoryMessage {
                                role: "user".into(),
                                text,
                                thinking: None,
                                tool_name: None,
                                tool_use_id: None,
                                opened_files,
                                selected_code,
                            });
                        }
                    }
                    Some("assistant") => {
                        let mut parts = vec![];
                        let mut thinking: Option<String> = None;
                        if let Some(arr) = val["message"]["content"].as_array() {
                            for block in arr {
                                match block["type"].as_str() {
                                    Some("text") => {
                                        if let Some(t) = block["text"].as_str() {
                                            let t = t.trim();
                                            if !t.is_empty() { parts.push(t.to_string()); }
                                        }
                                    }
                                    Some("thinking") if thinking.is_none() => {
                                        if let Some(t) = block["thinking"].as_str() {
                                            let t = t.trim();
                                            if !t.is_empty() { thinking = Some(t.to_string()); }
                                        }
                                    }
                                    Some("tool_use") => {
                                        // Flush any accumulated text/thinking first
                                        if !parts.is_empty() || thinking.is_some() {
                                            messages.push(HistoryMessage {
                                                role: "assistant".into(),
                                                text: parts.join("\n"),
                                                thinking: thinking.take(),
                                                tool_name: None,
                                                tool_use_id: None,
                                                opened_files: vec![],
                                                selected_code: vec![],
                                            });
                                            parts.clear();
                                        }
                                        let tool_name = block["name"].as_str().unwrap_or("").to_string();
                                        let tool_use_id = block["id"].as_str().map(|s| s.to_string());
                                        let input_text = serde_json::to_string_pretty(&block["input"])
                                            .unwrap_or_default();
                                        messages.push(HistoryMessage {
                                            role: "tool_use".into(),
                                            text: input_text,
                                            thinking: None,
                                            tool_name: Some(tool_name),
                                            tool_use_id,
                                            opened_files: vec![],
                                            selected_code: vec![],
                                        });
                                    }
                                    _ => {}
                                }
                            }
                        }
                        if !parts.is_empty() {
                            messages.push(HistoryMessage {
                                role: "assistant".into(),
                                text: parts.join("\n"),
                                thinking,
                                tool_name: None,
                                tool_use_id: None,
                                opened_files: vec![],
                                selected_code: vec![],
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(messages)
        }
        "codex" => {
            validate_session_id(&session_id)?;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let root = home.join(".codex").join("sessions");
            let sid = session_id.clone();
            tokio::task::spawn_blocking(move || {
                let Some(path) = codex_find_session_file(&root, &sid) else {
                    return Ok(vec![]);
                };
                let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let mut messages: Vec<HistoryMessage> = vec![];
                let mut pending_tool: std::collections::HashMap<String, HistoryMessage> = std::collections::HashMap::new();

                for line in content.lines() {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
                    let t = v["type"].as_str().unwrap_or("");
                    let p = &v["payload"];

                    match t {
                        "event_msg" => match p["type"].as_str() {
                            Some("user_message") => {
                                if let Some(text) = p["message"].as_str() {
                                    if !text.trim().is_empty() {
                                        messages.push(HistoryMessage { role: "user".into(), text: text.to_string(), thinking: None, tool_name: None, tool_use_id: None, opened_files: vec![], selected_code: vec![] });
                                    }
                                }
                            }
                            Some("agent_message") => {
                                if let Some(text) = p["message"].as_str() {
                                    if !text.trim().is_empty() {
                                        messages.push(HistoryMessage { role: "assistant".into(), text: text.to_string(), thinking: None, tool_name: None, tool_use_id: None, opened_files: vec![], selected_code: vec![] });
                                    }
                                }
                            }
                            Some("mcp_tool_call_end") => {
                                let call_id = p["call_id"].as_str().unwrap_or("");
                                if let Some(tool_use) = pending_tool.remove(call_id) {
                                    let result = if let Some(ok) = p["result"].get("Ok") {
                                        ok["content"].as_array()
                                            .and_then(|a| a.first())
                                            .and_then(|b| b["text"].as_str())
                                            .unwrap_or("").to_string()
                                    } else {
                                        p["result"]["Err"].as_str().unwrap_or("error").to_string()
                                    };
                                    let tuid = tool_use.tool_use_id.clone();
                                    messages.push(tool_use);
                                    messages.push(HistoryMessage { role: "tool_result".into(), text: result, thinking: None, tool_name: None, tool_use_id: tuid, opened_files: vec![], selected_code: vec![] });
                                }
                            }
                            Some("mcp_tool_call_begin") => {
                                let call_id = p["call_id"].as_str().unwrap_or("").to_string();
                                let inv = &p["invocation"];
                                let tool_name = format!("{}_{}", inv["server"].as_str().unwrap_or("mcp"), inv["tool"].as_str().unwrap_or("tool"));
                                let input = serde_json::to_string_pretty(&inv["arguments"]).unwrap_or_default();
                                pending_tool.insert(call_id.clone(), HistoryMessage { role: "tool_use".into(), text: input, thinking: None, tool_name: Some(tool_name), tool_use_id: Some(call_id), opened_files: vec![], selected_code: vec![] });
                            }
                            _ => {}
                        },
                        "response_item" => match p["type"].as_str() {
                            // Tool call: parse function name + arguments
                            Some("function_call") => {
                                let call_id = p["call_id"].as_str().unwrap_or("").to_string();
                                let name = p["name"].as_str().unwrap_or("tool").to_string();
                                let args_str = p["arguments"].as_str().unwrap_or("{}");
                                // Use raw argument string as the tool input text
                                let input_text = serde_json::from_str::<serde_json::Value>(args_str)
                                    .ok()
                                    .and_then(|v| {
                                        // For exec_command show the command; others show full args
                                        v["cmd"].as_str().map(|s| serde_json::json!({"command": s}).to_string())
                                        .or_else(|| serde_json::to_string_pretty(&v).ok())
                                    })
                                    .unwrap_or_else(|| args_str.to_string());
                                pending_tool.insert(call_id.clone(), HistoryMessage {
                                    role: "tool_use".into(),
                                    text: input_text,
                                    thinking: None,
                                    tool_name: Some(name),
                                    tool_use_id: Some(call_id),
                                    opened_files: vec![], selected_code: vec![],
                                });
                            }
                            // Tool result — output is a string OR an array of content blocks
                            Some("function_call_output") => {
                                let call_id = p["call_id"].as_str().unwrap_or("");
                                if let Some(tool_use) = pending_tool.remove(call_id) {
                                    let output = match &p["output"] {
                                        v if v.is_string() => v.as_str().unwrap_or("").to_string(),
                                        v if v.is_array() => v.as_array().unwrap()
                                            .iter()
                                            .filter_map(|b| b["text"].as_str())
                                            .collect::<Vec<_>>()
                                            .join("\n"),
                                        _ => String::new(),
                                    };
                                    let tuid = tool_use.tool_use_id.clone();
                                    messages.push(tool_use);
                                    messages.push(HistoryMessage { role: "tool_result".into(), text: output, thinking: None, tool_name: None, tool_use_id: tuid, opened_files: vec![], selected_code: vec![] });
                                }
                            }
                            // Custom tool call (Windows/newer codex encodes exec as a custom tool
                            // whose `input` is a freeform JS string rather than JSON args).
                            Some("custom_tool_call") => {
                                let call_id = p["call_id"].as_str().unwrap_or("").to_string();
                                let name = p["name"].as_str().unwrap_or("tool").to_string();
                                let raw = p["input"].as_str().unwrap_or("");
                                // Try to pull a "cmd" out of an embedded {...} JSON object for a
                                // clean command label; otherwise fall back to the raw input.
                                let input_text = raw
                                    .find('{')
                                    .and_then(|s| raw[s..].rfind('}').map(|e| &raw[s..s + e + 1]))
                                    .and_then(|obj| serde_json::from_str::<serde_json::Value>(obj).ok())
                                    .and_then(|v| v["cmd"].as_str().map(|c| serde_json::json!({ "command": c }).to_string()))
                                    .unwrap_or_else(|| raw.to_string());
                                pending_tool.insert(call_id.clone(), HistoryMessage {
                                    role: "tool_use".into(),
                                    text: input_text,
                                    thinking: None,
                                    tool_name: Some(name),
                                    tool_use_id: Some(call_id),
                                    opened_files: vec![], selected_code: vec![],
                                });
                            }
                            Some("custom_tool_call_output") => {
                                let call_id = p["call_id"].as_str().unwrap_or("");
                                if let Some(tool_use) = pending_tool.remove(call_id) {
                                    // output is either a plain string or an array of {text} parts
                                    let output = match &p["output"] {
                                        v if v.is_string() => v.as_str().unwrap_or("").to_string(),
                                        v if v.is_array() => v.as_array().unwrap()
                                            .iter()
                                            .filter_map(|b| b["text"].as_str())
                                            .collect::<Vec<_>>()
                                            .join("\n"),
                                        _ => String::new(),
                                    };
                                    let tuid = tool_use.tool_use_id.clone();
                                    messages.push(tool_use);
                                    messages.push(HistoryMessage { role: "tool_result".into(), text: output, thinking: None, tool_name: None, tool_use_id: tuid, opened_files: vec![], selected_code: vec![] });
                                }
                            }
                            _ => {}
                        },
                        _ => {}
                    }
                }
                Ok(messages)
            })
            .await
            .map_err(|e| e.to_string())?
        }
        _ => Err(format!("Agent type '{agent_type}' does not support session history")),
    }
}

/// Warm up an agent when selected (Codex: start the persistent process).
#[tauri::command]
pub async fn ensure_agent_ready(app: AppHandle, agent_type: String) -> Result<(), String> {
    if agent_type == "codex" {
        ensure_codex_process(&app).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn check_agent_cli(app: AppHandle, agent_type: String) -> bool {
    let cmd_name = match agent_type.as_str() {        "claude-code" => "claude",
        "codex" => "codex",
        _ => return false,
    };
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        tokio::process::Command::new("where")
            .arg(cmd_name)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Wait for capture_shell_path() to finish (runs async at startup).
        // Poll up to 10 s before falling back to system PATH.
        let shell_path = {
            let state = app.state::<AgentManagerState>();
            let mut path = None;
            for _ in 0..50 {
                path = state.0.lock().await.shell_path.clone();
                if path.is_some() { break; }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            path
        };
        let mut cmd = tokio::process::Command::new("which");
        cmd.arg(cmd_name);
        if let Some(ref path) = shell_path {
            cmd.env("PATH", path);
        }
        cmd.output().await.map(|o| o.status.success()).unwrap_or(false)
    }
}

#[tauri::command]
pub async fn delete_session(
    app: AppHandle,
    agent_type: String,
    folder_path: String,
    session_id: String,
) -> Result<(), String> {
    match agent_type.as_str() {
        "claude-code" => {
            validate_session_id(&session_id)?;
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let key = sanitize_path(&folder_path);
            let path = home
                .join(".claude")
                .join("projects")
                .join(key)
                .join(format!("{session_id}.jsonl"));
            tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())
        }
        "codex" => {
            validate_session_id(&session_id)?;
            // Archive via the persistent process — moves the rollout to
            // archived_sessions AND updates codex's state DB (so it stays
            // consistent with codex CLI's own archive listing).
            ensure_codex_process(&app).await?;
            let state = app.state::<AgentManagerState>();
            let (rx, req, tx) = {
                let mut mgr = state.0.lock().await;
                let handle = mgr.codex.as_mut().ok_or("Codex process not available")?;
                let stdin_tx = handle.stdin_tx.clone();
                let mut d = handle.driver.lock().await;
                let codex = d.as_any_mut().downcast_mut::<CodexDriver>().ok_or("Codex driver missing")?;
                let (id, rx) = codex.register_rpc();
                let req = serde_json::json!({
                    "id": id,
                    "method": "thread/archive",
                    "params": { "threadId": session_id }
                }).to_string();
                (rx, req, stdin_tx)
            };
            tx.send(req).await.map_err(|e| e.to_string())?;
            let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
                .await
                .map_err(|_| "thread/archive timed out".to_string())?
                .map_err(|_| "thread/archive channel closed".to_string())?;
            if result.is_null() {
                return Err("Codex failed to archive the session".into());
            }
            Ok(())
        }
        _ => Err(format!("Agent type '{agent_type}' does not support session deletion")),
    }
}

#[tauri::command]
pub async fn list_agent_runs(app: AppHandle) -> Vec<RunSummary> {
    let state = app.state::<AgentManagerState>();
    let mgr = state.0.lock().await;
    mgr.runs.values().map(|r| RunSummary {
        run_id: r.run_id.clone(),
        agent_type: r.agent_type.clone(),
        folder_path: r.folder_path.clone(),
        session_id: r.session_id.clone(),
    }).collect()
}

#[tauri::command]
pub async fn send_agent_message(
    app: AppHandle,
    run_id: String,
    content: String,
) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    let (driver, session_id, tx) = {
        let mgr = state.0.lock().await;
        let (driver, tx, session_id) = mgr.resolve(&run_id).ok_or("Run not found")?;
        (driver, session_id, tx)
    };
    let line = {
        let mut d = driver.lock().await;
        if content == "\x03" {
            d.build_interrupt().ok_or("Driver does not support interrupt")?
        } else {
            d.build_user_message(&content, session_id.as_deref())
                .ok_or("Driver does not support multi-turn messages")?
        }
    };
    tx.send(line).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kill_agent_run(app: AppHandle, run_id: String) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    let mut mgr = state.0.lock().await;
    if mgr.runs.remove(&run_id).is_some() {
        // Dropping AgentRun drops stdin_tx → stdin pump exits → process stdin EOF → kill_on_drop fires
        return Ok(());
    }
    // Codex: a logical session on the shared process — don't kill the process,
    // just drop the run mapping and interrupt any in-flight turn.
    if let Some(codex) = mgr.codex.as_mut() {
        if codex.run_ids.remove(&run_id) {
            // Interrupt the in-flight turn and unsubscribe the thread so codex
            // can unload it (mirrors the switch path); then forget it locally.
            let msgs = {
                let mut d = codex.driver.lock().await;
                let mut msgs: Vec<String> = vec![];
                if let Some(interrupt) = d.build_interrupt() {
                    msgs.push(interrupt);
                }
                if let Some(cx) = d.as_any_mut().downcast_mut::<CodexDriver>() {
                    if let Some(unsub) = cx.build_unsubscribe_active(None) {
                        msgs.push(unsub);
                    }
                    cx.clear_active();
                }
                msgs
            };
            for msg in msgs {
                let _ = codex.stdin_tx.send(msg).await;
            }
            return Ok(());
        }
    }
    Err("Run not found".into())
}

#[tauri::command]
pub async fn respond_agent_permission(
    app: AppHandle,
    run_id: String,
    request_id: String,
    approved: bool,
    tool_input: Option<Value>,
    deny_message: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    let (driver, tx) = {
        let mgr = state.0.lock().await;
        let (driver, tx, _) = mgr.resolve(&run_id).ok_or("Run not found")?;
        (driver, tx)
    };
    let line = driver
        .lock()
        .await
        .build_permission_response(&request_id, approved, tool_input.as_ref(), deny_message.as_deref())
        .ok_or("Driver does not support permission responses")?;
    tx.send(line).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_agent_permission_mode(
    app: AppHandle,
    run_id: String,
    mode: String,
) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    let (driver, tx) = {
        let mgr = state.0.lock().await;
        let (driver, tx, _) = mgr.resolve(&run_id).ok_or("Run not found")?;
        (driver, tx)
    };
    let line = driver
        .lock()
        .await
        .build_set_permission_mode(&mode)
        .ok_or("Driver does not support permission mode switching")?;
    tx.send(line).await.map_err(|e| e.to_string())
}
