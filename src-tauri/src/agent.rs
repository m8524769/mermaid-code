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

pub trait AgentDriver: Send {
    /// Returns a configured Command ready to spawn, or None for HTTP-based drivers.
    fn spawn_command(&self, config: &SessionConfig) -> Option<Command>;
    /// Encodes a user turn as a stdin/HTTP payload. Returns None if multi-turn is unsupported.
    fn build_user_message(&self, _content: &str) -> Option<String> { None }
    /// Encodes an interrupt signal. Returns None if unsupported.
    fn build_interrupt(&self) -> Option<String> { None }
    fn parse_line(&mut self, line: &str) -> Vec<DriverEvent>;
    /// Encodes a permission response payload. Returns None if unsupported.
    fn build_permission_response(&self, request_id: &str, approved: bool, tool_input: Option<&Value>, deny_message: Option<&str>) -> Option<String>;
}

fn make_driver(agent_type: &str) -> Option<Box<dyn AgentDriver>> {
    match agent_type {
        "claude-code" => Some(Box::new(ClaudeCodeDriver::new())),
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
    fn spawn_command(&self, config: &SessionConfig) -> Option<Command> {
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
        if let Some(id) = &config.resume_session_id {
            args.push("--resume".to_string());
            args.push(id.clone());
        }
        #[cfg(target_os = "windows")]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
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

    fn build_user_message(&self, content: &str) -> Option<String> {
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

    fn parse_line(&mut self, line: &str) -> Vec<DriverEvent> {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            return vec![];
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
                events.push(DriverEvent::Exit {
                    is_error: val["is_error"].as_bool().unwrap_or(false),
                    cost_usd: val["total_cost_usd"].as_f64(),
                    error: val["error"].as_str().map(str::to_string),
                    is_final: false, // driver always yields turn-complete; read_loop decides finality
                });
            }
            _ => {}
        }
        events
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
}

// ── Session config ────────────────────────────────────────────────────────────

pub struct SessionConfig {
    pub prompt: String,
    pub mcp_config_path: Option<PathBuf>,
    pub resume_session_id: Option<String>,
    pub shell_path: Option<String>,
}

// ── AgentManager ──────────────────────────────────────────────────────────────

pub struct AgentRun {
    pub run_id: String,
    pub agent_type: String,
    pub folder_path: String,
    pub session_id: Option<String>,
    pub stdin_tx: mpsc::Sender<String>,
    pub driver: Box<dyn AgentDriver>,
    #[allow(dead_code)] // drop triggers kill_rx in the read loop's select!
    pub kill_tx: tokio::sync::oneshot::Sender<()>,
}

pub struct AgentManager {
    runs: HashMap<String, AgentRun>,
    /// PATH captured from the user's login+interactive shell at startup.
    /// Used to ensure `claude` is findable even in packaged .app bundles
    /// that inherit only launchd's minimal PATH.
    pub shell_path: Option<String>,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self { runs: HashMap::new(), shell_path: None }
    }
}

pub struct AgentManagerState(pub Mutex<AgentManager>);

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StartAgentParams {
    pub prompt: String,
    pub folder_path: String,
    pub agent_type: String,
    pub resume_session_id: Option<String>,
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

    let run_id = uuid::Uuid::new_v4().to_string();

    // Build driver (two instances: one for read_loop, one stored in AgentRun for permission responses)
    let agent_type = params.agent_type.as_str();
    let driver: Box<dyn AgentDriver> = make_driver(agent_type)
        .ok_or_else(|| format!("Unknown agent type: {}", params.agent_type))?;
    let driver_for_run: Box<dyn AgentDriver> = make_driver(agent_type).unwrap();

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
    };

    // Spawn process
    let mut cmd = driver
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
    if let Some(initial) = driver.build_user_message(&config.prompt) {
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
            driver: driver_for_run,
            kill_tx,
        });
    }
    let mcp_path_for_kill = mcp_config_path.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = read_loop(app2.clone(), rid.clone(), stdout, driver, mcp_config_path) => {}
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
    mut driver: Box<dyn AgentDriver>,
    mcp_config_path: Option<PathBuf>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut in_turn = false;
    let mut had_any_output = false;
    let mut exited_via_error = false; // true when we break due to an error exit event

    'outer: while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }

        for event in driver.parse_line(&line) {
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

            // Rewrite Exit events: errors are final; normal turn-complete is not final
            let event = match event {
                DriverEvent::Exit { is_error, cost_usd, error, .. } => {
                    in_turn = false;
                    let is_final = is_error;
                    DriverEvent::Exit { is_error, cost_usd, error, is_final }
                }
                other => other,
            };

            let should_break = matches!(&event, DriverEvent::Exit { is_error: true, .. });
            let _ = app.emit("agent-event", serde_json::json!({
                "run_id": &run_id,
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
        _ => Err(format!("Agent type '{agent_type}' does not support session history")),
    }
}

#[tauri::command]
pub async fn check_agent_cli(app: AppHandle, agent_type: String) -> bool {
    let cmd_name = match agent_type.as_str() {
        "claude-code" => "claude",
        _ => return false,
    };
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
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
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let key = sanitize_path(&folder_path);
            let path = home
                .join(".claude")
                .join("projects")
                .join(key)
                .join(format!("{session_id}.jsonl"));
            tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())
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
    let (line, tx) = {
        let mgr = state.0.lock().await;
        let run = mgr.runs.get(&run_id).ok_or("Run not found")?;
        let line = if content == "\x03" {
            run.driver
                .build_interrupt()
                .ok_or("Driver does not support interrupt")?
        } else {
            run.driver
                .build_user_message(&content)
                .ok_or("Driver does not support multi-turn messages")?
        };
        (line, run.stdin_tx.clone())
    };
    tx.send(line).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kill_agent_run(app: AppHandle, run_id: String) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    let mut mgr = state.0.lock().await;
    mgr.runs.remove(&run_id).ok_or("Run not found")?;
    // Dropping AgentRun drops stdin_tx → stdin pump exits → process stdin EOF → kill_on_drop fires
    Ok(())
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
    let (line, tx) = {
        let mgr = state.0.lock().await;
        let run = mgr.runs.get(&run_id).ok_or("Run not found")?;
        let line = run
            .driver
            .build_permission_response(&request_id, approved, tool_input.as_ref(), deny_message.as_deref())
            .ok_or("Driver does not support permission responses")?;
        (line, run.stdin_tx.clone())
    }; // lock released here
    tx.send(line).await.map_err(|e| e.to_string())
}
