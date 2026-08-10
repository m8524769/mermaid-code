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
    Message { id: String, text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String },
    SessionReady { session_id: String },
    PermissionRequest { request_id: String, tool_name: String, tool_input: Value },
    Exit { is_error: bool, cost_usd: Option<f64>, error: Option<String> },
}

// ── Driver trait ──────────────────────────────────────────────────────────────

pub trait AgentDriver: Send {
    /// Returns a configured Command ready to spawn, or None for HTTP-based drivers.
    fn spawn_command(&self, config: &SessionConfig) -> Option<Command>;
    /// Encodes a user turn as a stdin/HTTP payload. Returns None if multi-turn is unsupported.
    fn build_user_message(&self, _content: &str) -> Option<String> { None }
    fn parse_line(&mut self, line: &str) -> Vec<DriverEvent>;
    /// Encodes a permission response payload. Returns None if unsupported.
    fn build_permission_response(&self, request_id: &str, approved: bool, tool_input: Option<&Value>) -> Option<String>;
}

fn make_driver(agent_type: &str) -> Option<Box<dyn AgentDriver>> {
    match agent_type {
        "claude-code" => Some(Box::new(ClaudeCodeDriver)),
        _ => None,
    }
}

// ── ClaudeCodeDriver ──────────────────────────────────────────────────────────

pub struct ClaudeCodeDriver;

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
            "--mcp-config".to_string(),
            config.mcp_config_path.to_string_lossy().to_string(),
        ];
        if let Some(id) = &config.resume_session_id {
            args.push("--resume".to_string());
            args.push(id.clone());
        }
        let mut cmd = Command::new("claude");
        cmd.args(args);
        Some(cmd)
    }

    fn build_user_message(&self, content: &str) -> Option<String> {
        let msg = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": content }
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
                    events.push(DriverEvent::SessionReady {
                        session_id: id.to_string(),
                    });
                }
            }
            // Permission request from --permission-prompt-tool stdio
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
            Some("assistant") => {
                let msg_id = val["message"]["id"].as_str().unwrap_or("").to_string();
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") => {
                            let text = block["text"].as_str().unwrap_or("").to_string();
                            if !text.is_empty() {
                                events.push(DriverEvent::Message { id: msg_id.clone(), text });
                            }
                        }
                        Some("tool_use") => events.push(DriverEvent::ToolUse {
                            id: block["id"].as_str().unwrap_or("").to_string(),
                            name: block["name"].as_str().unwrap_or("").to_string(),
                            input: block["input"].clone(),
                        }),
                        _ => {}
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
                events.push(DriverEvent::Exit {
                    is_error: val["is_error"].as_bool().unwrap_or(false),
                    cost_usd: val["total_cost_usd"].as_f64(),
                    error: val["error"].as_str().map(str::to_string),
                });
            }
            _ => {}
        }
        events
    }
    fn build_permission_response(&self, request_id: &str, approved: bool, tool_input: Option<&Value>) -> Option<String> {
        let inner = if approved {
            serde_json::json!({
                "behavior": "allow",
                "updatedInput": tool_input.unwrap_or(&Value::Object(Default::default())),
            })
        } else {
            serde_json::json!({ "behavior": "deny", "message": "User denied permission" })
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
    pub mcp_config_path: PathBuf,
    pub resume_session_id: Option<String>, // Claude Code session_id for --resume
}

// ── AgentManager ──────────────────────────────────────────────────────────────

pub struct AgentRun {
    pub run_id: String,
    pub agent_type: String,
    pub folder_path: String,
    pub session_id: Option<String>,
    pub stdin_tx: mpsc::Sender<String>,
    pub driver: Box<dyn AgentDriver>,
}

#[derive(Default)]
pub struct AgentManager {
    runs: HashMap<String, AgentRun>,
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
    // Read current MCP token
    let token = {
        let mcp_state = app.state::<McpServerState>();
        let guard = mcp_state.0.lock().await;
        guard
            .as_ref()
            .ok_or("MCP server is not running")?
            .token
            .clone()
    };

    // Write mcp.json with current token
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let run_dir = data_dir.join("agent-runs").join(&run_id);
    tokio::fs::create_dir_all(&run_dir).await.map_err(|e| e.to_string())?;
    let mcp_config_path = run_dir.join("mcp.json");
    let mcp_json = serde_json::json!({
        "mcpServers": {
            "mermaid-code-mcp": {
                "type": "http",
                "url": format!("http://127.0.0.1:{MCP_SERVER_PORT}"),
                "headers": { "Authorization": format!("Bearer {token}") }
            }
        }
    });
    tokio::fs::write(&mcp_config_path, serde_json::to_string_pretty(&mcp_json).unwrap())
        .await
        .map_err(|e| e.to_string())?;

    // Build driver (two instances: one for read_loop, one stored in AgentRun for permission responses)
    let agent_type = params.agent_type.as_str();
    let driver: Box<dyn AgentDriver> = make_driver(agent_type)
        .ok_or_else(|| format!("Unknown agent type: {}", params.agent_type))?;
    let driver_for_run: Box<dyn AgentDriver> = make_driver(agent_type).unwrap();

    let config = SessionConfig {
        prompt: params.prompt,
        mcp_config_path: mcp_config_path.clone(),
        resume_session_id: params.resume_session_id,
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
        });
    }

    // Spawn read loop; child is moved in to keep the process alive
    let rid = run_id.clone();
    let app2 = app.clone();
    tokio::spawn(async move {
        let _child = child; // keep alive until read_loop finishes
        read_loop(app2.clone(), rid.clone(), stdout, driver, mcp_config_path).await;
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
    mcp_config_path: PathBuf,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut got_exit = false;
    let mut should_kill = false;

    'outer: while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }

        for event in driver.parse_line(&line) {
            // Store session_id when Claude Code reports it
            if let DriverEvent::SessionReady { ref session_id } = event {
                let mgr_state = app.state::<AgentManagerState>();
                let mut mgr = mgr_state.0.lock().await;
                if let Some(run) = mgr.runs.get_mut(&run_id) {
                    run.session_id = Some(session_id.clone());
                }
            }
            if let DriverEvent::Exit { is_error, .. } = &event {
                got_exit = true;
                should_kill = *is_error; // error → kill; normal result → keep alive for next turn
            }
            let _ = app.emit("agent-event", serde_json::json!({
                "run_id": &run_id,
                "event": &event,
            }));
            if should_kill { break 'outer; }
        }
    }

    if !got_exit {
        let _ = app.emit("agent-event", serde_json::json!({
            "run_id": &run_id,
            "event": DriverEvent::Exit {
                is_error: true,
                cost_usd: None,
                error: Some("Process exited unexpectedly".to_string()),
            },
        }));
    }

    let _ = tokio::fs::remove_file(&mcp_config_path).await;
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
            let key: String = folder_path
                .chars()
                .map(|c| if c == '/' || c == '\\' || c == ':' { '-' } else { c })
                .collect();
            let dir = home.join(".claude").join("projects").join(key);
            let mut entries = match tokio::fs::read_dir(&dir).await {
                Ok(e) => e,
                Err(_) => return Ok(vec![]),
            };
            let mut sessions = vec![];
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if let Some(id) = name.strip_suffix(".jsonl") {
                    if entry.metadata().await.map(|m| m.is_file()).unwrap_or(false) {
                        let first_prompt = read_first_prompt(&entry.path()).await;
                        sessions.push(SessionInfo {
                            session_id: id.to_string(),
                            first_prompt,
                        });
                    }
                }
            }
            Ok(sessions)
        }
        _ => Err(format!("Agent type '{agent_type}' does not support session listing")),
    }
}

fn extract_text(content: &serde_json::Value) -> Option<String> {
    let text = if let Some(s) = content.as_str() {
        s.trim().to_string()
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .find(|b| b["type"].as_str() == Some("text"))
            .and_then(|b| b["text"].as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    } else {
        return None;
    };
    if text.is_empty() { None } else { Some(text) }
}

async fn read_first_prompt(path: &std::path::Path) -> Option<String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let file = tokio::fs::File::open(path).await.ok()?;
    let mut lines = BufReader::new(file).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if val["type"].as_str() != Some("user")
            || val["message"]["role"].as_str() != Some("user")
        {
            continue;
        }
        // Skip task-notification injections
        if val["origin"]["kind"].as_str() == Some("task-notification") {
            continue;
        }
        let content = &val["message"]["content"];
        // Skip tool_result messages (content is an array of tool_result blocks)
        if let Some(arr) = content.as_array() {
            if arr.iter().any(|b| b["type"].as_str() == Some("tool_result")) {
                continue;
            }
        }
        if let Some(text) = extract_text(content) {
            return Some(text);
        }
    }
    None
}

#[derive(Serialize)]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
    pub thinking: Option<String>,
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
            let key: String = folder_path
                .chars()
                .map(|c| if c == '/' || c == '\\' || c == ':' { '-' } else { c })
                .collect();
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
                        // Only accept messages explicitly authored by a human
                        if val["origin"]["kind"].as_str() != Some("human") { continue; }
                        if let Some(text) = extract_text(&val["message"]["content"]) {
                            messages.push(HistoryMessage { role: "user".into(), text, thinking: None });
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
                                    _ => {}
                                }
                            }
                        }
                        if !parts.is_empty() {
                            messages.push(HistoryMessage {
                                role: "assistant".into(),
                                text: parts.join("\n"),
                                thinking,
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
        let line = run
            .driver
            .build_user_message(&content)
            .ok_or("Driver does not support multi-turn messages")?;
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
) -> Result<(), String> {
    let state = app.state::<AgentManagerState>();
    let (line, tx) = {
        let mgr = state.0.lock().await;
        let run = mgr.runs.get(&run_id).ok_or("Run not found")?;
        let line = run
            .driver
            .build_permission_response(&request_id, approved, tool_input.as_ref())
            .ok_or("Driver does not support permission responses")?;
        (line, run.stdin_tx.clone())
    }; // lock released here
    tx.send(line).await.map_err(|e| e.to_string())
}
