use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use uuid::Uuid;

pub const TAURI_AXUM_PORT: u16 = 37078;
pub const MCP_SERVER_PORT: u16 = 37079;

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct MmdFile {
    pub path: String,
    pub name: String,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ActiveTab {
    pub path: Option<String>,
    pub name: String,
    pub is_draft: bool,
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct ContextData {
    pub folder: Option<String>,
    pub files: Vec<MmdFile>,
    pub active_tab: Option<ActiveTab>,
}

#[derive(Deserialize)]
pub struct PreviewRequest {
    pub code: String,
}

struct McpState {
    app: AppHandle,
    context: Arc<std::sync::Mutex<ContextData>>,
    token: String,
}

fn check_token(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t == token)
        .unwrap_or(false)
}

async fn context_handler(
    State(state): State<Arc<McpState>>,
    headers: HeaderMap,
) -> Result<Json<ContextData>, StatusCode> {
    if !check_token(&headers, &state.token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let ctx = state.context.lock().unwrap().clone();
    Ok(Json(ctx))
}

async fn preview_handler(
    State(state): State<Arc<McpState>>,
    headers: HeaderMap,
    Json(req): Json<PreviewRequest>,
) -> StatusCode {
    if !check_token(&headers, &state.token) {
        return StatusCode::UNAUTHORIZED;
    }
    let _ = state.app.emit("mcp-preview", req.code);
    StatusCode::OK
}

fn find_sidecar(_app: &AppHandle) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let name = format!("mermaid-code-mcp{ext}");
    let path = exe_dir.join(&name);
    if path.exists() { Some(path) } else { None }
}

pub struct McpServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
    mcp_process: Option<std::process::Child>,
    pub context: Arc<std::sync::Mutex<ContextData>>,
    pub token: String,
}

impl McpServer {
    pub async fn start(app: AppHandle) -> Result<Self, String> {
        let listener = TcpListener::bind(format!("127.0.0.1:{TAURI_AXUM_PORT}"))
            .await
            .map_err(|e| format!("Port {TAURI_AXUM_PORT} unavailable: {e}"))?;

        let token = Uuid::new_v4().to_string();
        let context = Arc::new(std::sync::Mutex::new(ContextData::default()));
        let state = Arc::new(McpState {
            app: app.clone(),
            context: context.clone(),
            token: token.clone(),
        });
        let router = Router::new()
            .route("/preview", post(preview_handler))
            .route("/context", get(context_handler))
            .with_state(state);

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        let mcp_process = find_sidecar(&app).and_then(|path| {
            let mut cmd = std::process::Command::new(&path);
            cmd.env("MCP_TOKEN", &token);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            cmd.spawn().ok()
        });

        // Verify sidecar is listening, retrying up to 3 seconds
        if mcp_process.is_some() {
            let mut reachable = false;
            for _ in 0..12 {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                if tokio::net::TcpStream::connect(format!("127.0.0.1:{MCP_SERVER_PORT}"))
                    .await
                    .is_ok()
                {
                    reachable = true;
                    break;
                }
            }
            if !reachable {
                return Err(format!("MCP server failed to start on port {MCP_SERVER_PORT}"));
            }
        }

        Ok(McpServer {
            shutdown_tx: Some(shutdown_tx),
            mcp_process,
            context,
            token,
        })
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(mut child) = self.mcp_process.take() {
            let _ = child.kill();
            let _ = child.wait(); // Reap exit status to avoid zombie process
        }
        let port = MCP_SERVER_PORT;
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncWriteExt;
            if let Ok(mut stream) = tokio::net::TcpStream::connect(
                format!("127.0.0.1:{port}")
            ).await {
                let req = format!(
                    "POST /shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(req.as_bytes()).await;
            }
        });
    }
}
