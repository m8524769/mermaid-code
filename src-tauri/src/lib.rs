use tauri::Emitter;

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

fn emit_open_files(app: &tauri::AppHandle, paths: Vec<std::path::PathBuf>) {
    let paths: Vec<String> = paths
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
        .collect();

    if !paths.is_empty() {
        let _ = app.emit("open-files", paths);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::Manager;
            // Focus the main window when a second instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            // Forward file paths from the new instance's args (Windows)
            let paths: Vec<std::path::PathBuf> = args
                .into_iter()
                .skip(1) // skip the executable path
                .map(std::path::PathBuf::from)
                .filter(|p| p.exists())
                .collect();
            emit_open_files(app, paths);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![copy_image_to_clipboard])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                app.get_webview_window("main").unwrap().open_devtools();
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
