use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn get_opened_files(app: tauri::AppHandle) -> Vec<String> {
    let state = app.state::<OpenedFiles>();
    let mut files = state.0.lock().unwrap();
    let result = files.clone();
    files.clear();
    result
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
                .on_navigation(|_webview, url| {
                    let s = url.as_str();
                    if s.starts_with("tauri://localhost") {
                        return true;
                    }
                    #[cfg(debug_assertions)]
                    if s.starts_with("http://localhost:3000") {
                        return true;
                    }
                    let _ = open::that(s);
                    false
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![copy_image_to_clipboard, get_opened_files])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                _app.get_webview_window("main").unwrap().open_devtools();
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
                    _app.state::<OpenedFiles>().0.lock().unwrap().extend(filtered);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
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
