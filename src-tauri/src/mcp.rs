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

async fn send_shutdown_request(port: u16) -> bool {
    use tokio::io::AsyncWriteExt;
    if let Ok(mut stream) = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await {
        let req = format!(
            "POST /shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(req.as_bytes()).await;
        let _ = stream.shutdown().await;
        return true;
    }
    false
}

/// If a previous Mermaid Code process crashed without running Exit cleanup, an
/// orphaned `mermaid-code-mcp` sidecar may still hold `MCP_SERVER_PORT` with a
/// stale token. Ask it to shut down and wait briefly for the port to clear.
async fn clear_stale_sidecar(port: u16) {
    // Fast-path check with bind (<1ms on all platforms, avoiding Windows' ~2s
    // loopback SYN retry when the port is already free).
    if TcpListener::bind(format!("127.0.0.1:{port}")).await.is_ok() {
        return;
    }
    if !send_shutdown_request(port).await {
        return;
    }
    for _ in 0..15 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if TcpListener::bind(format!("127.0.0.1:{port}")).await.is_ok() {
            break;
        }
    }
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

        let mut mcp_process = if let Some(path) = find_sidecar(&app) {
            clear_stale_sidecar(MCP_SERVER_PORT).await;
            let mut cmd = std::process::Command::new(&path);
            cmd.env("MCP_TOKEN", &token)
                .env("MCP_WATCH_STDIN", "1")
                // Keep the write end of stdin owned by `Child` so if this process
                // crashes (SIGABRT/SIGKILL), the OS closes the pipe and the sidecar
                // exits cleanly instead of becoming an orphan holding port 37079.
                .stdin(std::process::Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            cmd.spawn().ok()
        } else {
            None
        };

        // Verify sidecar is listening, retrying up to 5 seconds
        if let Some(child) = mcp_process.as_mut() {
            let mut reachable = false;
            for _ in 0..20 {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                if let Ok(Some(status)) = child.try_wait() {
                    let _ = shutdown_tx.send(());
                    return Err(format!(
                        "MCP server exited prematurely ({status}) on port {MCP_SERVER_PORT}"
                    ));
                }
                if tokio::net::TcpStream::connect(format!("127.0.0.1:{MCP_SERVER_PORT}"))
                    .await
                    .is_ok()
                {
                    reachable = true;
                    break;
                }
            }
            if !reachable {
                let _ = shutdown_tx.send(());
                let _ = child.kill();
                let _ = child.wait();
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
        let had_child = if let Some(mut child) = self.mcp_process.take() {
            let _ = child.kill();
            let _ = child.wait(); // Reap exit status to avoid zombie process
            true
        } else {
            false
        };
        // Only send HTTP /shutdown when we did not own the child (e.g. external dev server).
        // Avoids racing with an immediate restart or hitting Windows' ~2s refused-connect delay.
        if !had_child {
            let port = MCP_SERVER_PORT;
            tauri::async_runtime::spawn(async move {
                send_shutdown_request(port).await;
            });
        }
    }
}
