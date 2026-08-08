use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

mod mcp;

struct OpenedFiles(Mutex<Vec<String>>);
struct McpServerState(tokio::sync::Mutex<Option<mcp::McpServer>>);
struct MenuHandles {
    file: Submenu<tauri::Wry>,
    view: Submenu<tauri::Wry>,
    window: Submenu<tauri::Wry>,
    help: Submenu<tauri::Wry>,
}
// Holds the "Open Recent ▶" submenu so update_recent_folders can mutate it at runtime.
struct RecentFoldersMenuState(Mutex<Submenu<tauri::Wry>>);
// Monotonically increasing counter to ensure unique menu item IDs on each update_recent call.
// muda caches IDs globally; reusing the same ID after remove() can fail on some platforms.
static RECENT_MENU_GEN: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[tauri::command]
fn popup_submenu(app: tauri::AppHandle, menu_id: String, x: f64, y: f64) {
    let Some(state) = app.try_state::<MenuHandles>() else { return };
    let Some(win) = app.get_webview_window("main") else { return };
    let pos = tauri::Position::Logical(tauri::LogicalPosition { x, y });
    let _ = match menu_id.as_str() {
        "file" => win.popup_menu_at(&state.file, pos),
        "view" => win.popup_menu_at(&state.view, pos),
        "window" => win.popup_menu_at(&state.window, pos),
        "help" => win.popup_menu_at(&state.help, pos),
        _ => Ok(()),
    };
}

#[tauri::command]
fn update_recent(app: tauri::AppHandle, folders: Vec<String>, files: Vec<String>) {
    let Some(state) = app.try_state::<RecentFoldersMenuState>() else { return };
    let guard = state.0.lock().unwrap();
    let gen = RECENT_MENU_GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    // Remove all current items from the submenu
    if let Ok(items) = guard.items() {
        for item in items {
            let _ = guard.remove(&item);
        }
    }
    let has_folders = !folders.is_empty();
    let has_files = !files.is_empty();
    if !has_folders && !has_files {
        let _ = MenuItem::with_id(&app, format!("recent-empty-{gen}"), "No Recent Items", false, None::<&str>)
            .map(|item| guard.append(&item));
        return;
    }
    for (i, path) in folders.iter().enumerate() {
        let id = format!("open-recent-folder-{gen}-{i}");
        if let Ok(item) = MenuItem::with_id(&app, id, path, true, None::<&str>) {
            let _ = guard.append(&item);
        }
    }
    if has_folders && has_files {
        if let Ok(sep) = PredefinedMenuItem::separator(&app) {
            let _ = guard.append(&sep);
        }
    }
    for (i, path) in files.iter().enumerate() {
        let id = format!("open-recent-file-{gen}-{i}");
        if let Ok(item) = MenuItem::with_id(&app, id, path, true, None::<&str>) {
            let _ = guard.append(&item);
        }
    }
}

#[tauri::command]
async fn update_mcp_context(app: tauri::AppHandle, context: mcp::ContextData) {
    let state = app.state::<McpServerState>();
    let guard = state.0.lock().await;
    if let Some(server) = guard.as_ref() {
        *server.context.lock().unwrap() = context;
    }
}

#[tauri::command]
fn get_opened_files(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<OpenedFiles>();
    let mut files = state.0.lock().unwrap();
    let result = files.clone();
    files.clear();
    result
}

#[tauri::command]
async fn start_mcp_server(app: tauri::AppHandle) -> Result<u16, String> {
    // Hold the lock across the entire start sequence to prevent TOCTOU race
    let state = app.state::<McpServerState>();
    let mut guard = state.0.lock().await;
    if guard.is_some() {
        return Ok(mcp::MCP_SERVER_PORT);
    }
    let server = mcp::McpServer::start(app.clone()).await?;
    *guard = Some(server);
    Ok(mcp::MCP_SERVER_PORT)
}

#[tauri::command]
async fn stop_mcp_server(app: tauri::AppHandle) {
    let state = app.state::<McpServerState>();
    let mut guard = state.0.lock().await;
    if let Some(mut server) = guard.take() {
        server.stop();
    }
}

#[tauri::command]
async fn get_mcp_port(app: tauri::AppHandle) -> Option<u16> {
    let state = app.state::<McpServerState>();
    let guard = state.0.lock().await;
    guard.as_ref().map(|_| mcp::MCP_SERVER_PORT)
}

#[tauri::command]
fn copy_image_to_clipboard(png_base64: String) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use image::GenericImageView;
    use std::borrow::Cow;

    let bytes = STANDARD.decode(&png_base64).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = img.dimensions();
    let image_data = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(rgba.into_raw()),
    };
    Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_image(image_data)
        .map_err(|e| e.to_string())
}

fn filter_mmd_paths(paths: Vec<std::path::PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| {
            p.extension()
                .map(|ext| {
                    let ext = ext.to_string_lossy().to_lowercase();
                    ext == "mmd" || ext == "mermaid"
                })
                .unwrap_or(false)
        })
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect()
}

fn emit_open_files(app: &tauri::AppHandle, paths: Vec<std::path::PathBuf>) {
    let filtered = filter_mmd_paths(paths);
    if !filtered.is_empty() {
        let _ = app.emit("open-files", filtered);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(vec![])))
        .manage(McpServerState(tokio::sync::Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus the main window when a second instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            // Forward file paths from the new instance's args (Windows already running)
            let paths: Vec<std::path::PathBuf> = args
                .into_iter()
                .skip(1)
                .map(std::path::PathBuf::from)
                .filter(|p| p.exists())
                .collect();
            emit_open_files(app, paths);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            // Intercept external navigation and open in system browser
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|webview, url| {
                    let s = url.as_str();
                    // Allow all Tauri internal URLs and blob URLs
                    if s.starts_with("tauri://")
                        || s.starts_with("http://tauri.localhost")
                        || s.starts_with("https://tauri.localhost")
                        || s.starts_with("blob:")
                        || s.starts_with("data:")
                    {
                        return true;
                    }
                    #[cfg(debug_assertions)]
                    if s.starts_with("http://localhost:3000") {
                        return true;
                    }
                    // External URL — prompt user
                    let url_owned = s.to_string();
                    let app = webview.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
                        let confirmed = app
                            .dialog()
                            .message(format!("Do you trust this link?\n\n{url_owned}"))
                            .title("External Link")
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                "Open in Browser".into(),
                                "Cancel".into(),
                            ))
                            .blocking_show();
                        if confirmed {
                            let _ = open::that(&url_owned);
                        }
                    });
                    false
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            copy_image_to_clipboard,
            get_opened_files,
            start_mcp_server,
            stop_mcp_server,
            get_mcp_port,
            update_mcp_context,
            popup_submenu,
            update_recent
        ])
        .setup(|app| {
            // macOS App menu (always first on macOS)
            #[cfg(target_os = "macos")]
            let app_menu = Submenu::with_items(
                app,
                "Mermaid Code",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let open_recent_menu = Submenu::with_items(
                app,
                "Open Recent",
                true,
                &[
                    &MenuItem::with_id(app, "recent-empty", "No Recent Folders", false, None::<&str>)?,
                ],
            )?;

            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &MenuItem::with_id(app, "open-file", "Open File...", true, Some("CmdOrCtrl+O"))?,
                    &MenuItem::with_id(app, "open-folder", "Open Folder...", true, Some("CmdOrCtrl+Shift+O"))?,
                    &open_recent_menu,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "save", "Save", true, None::<&str>)?,
                    &MenuItem::with_id(app, "save-as", "Save As...", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "close-tab", "Close Tab", true, None::<&str>)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?;

            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &MenuItem::with_id(app, "toggle-explorer", "Toggle File Explorer", true, Some("CmdOrCtrl+B"))?,
                    &MenuItem::with_id(app, "toggle-editor", "Toggle Editor", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "toggle-presentation", "Toggle Presentation Mode", true, Some("CmdOrCtrl+Shift+F"))?,
                ],
            )?;

            let window_menu = Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::fullscreen(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::bring_all_to_front(app, None)?,
                ],
            )?;

            let help_menu = Submenu::with_items(
                app,
                "Help",
                true,
                &[
                    &MenuItem::with_id(app, "help-github", "GitHub Repository", true, None::<&str>)?,
                    &MenuItem::with_id(app, "help-issue", "Report an Issue", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "help-changelog", "What's New", true, None::<&str>)?,
                ],
            )?;

            #[cfg(target_os = "macos")]
            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &view_menu, &window_menu, &help_menu])?;
            #[cfg(not(target_os = "macos"))]
            let menu = Menu::with_items(app, &[&file_menu, &view_menu, &window_menu, &help_menu])?;

            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu", event.id().as_ref());
            });

            // Store submenu handles for popup_submenu command
            app.manage(MenuHandles {
                file: file_menu,
                view: view_menu,
                window: window_menu,
                help: help_menu,
            });
            app.manage(RecentFoldersMenuState(Mutex::new(open_recent_menu)));

            #[cfg(debug_assertions)]
            {
                app.get_webview_window("main").unwrap().open_devtools();
            }
            // Windows: handle files passed as CLI args on first launch ("Open with")
            #[cfg(windows)]
            {
                let paths: Vec<std::path::PathBuf> = std::env::args()
                    .skip(1)
                    .map(std::path::PathBuf::from)
                    .filter(|p| p.exists())
                    .collect();
                let filtered = filter_mmd_paths(paths);
                if !filtered.is_empty() {
                    app.state::<OpenedFiles>().0.lock().unwrap().extend(filtered);
                }
            }
            // Windows: remove native title bar
            #[cfg(windows)]
            {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_decorations(false);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Stop MCP server when app exits (covers Dock quit, Command+Q, etc.)
            if matches!(event, tauri::RunEvent::Exit) {
                let server = app.state::<McpServerState>().0.blocking_lock().take();
                if let Some(mut s) = server {
                    s.stop();
                }
            }
            // macOS: handle files opened via Finder / "Open with"
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<std::path::PathBuf> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .collect();
                let filtered = filter_mmd_paths(paths);
                if !filtered.is_empty() {
                    // Store in state — frontend pulls via get_opened_files() on mount.
                    // Also emit for the case where the app is already running and fully loaded.
                    app.state::<OpenedFiles>().0.lock().unwrap().extend(filtered.clone());
                    let _ = app.emit("open-files", filtered);
                }
            }
        });
}
