// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod next_server;
mod titlebar;

use config::AppConfig;
use next_server::NextServer;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex as TokioMutex;

struct AppState {
    config: Arc<Mutex<AppConfig>>,
    next_server: Arc<TokioMutex<NextServer>>,
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[tauri::command]
fn set_backend_url(state: State<AppState>, url: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config
        .update_backend_url(url)
        .map_err(|e| format!("Failed to update backend URL: {}", e))?;
    log::info!("Backend URL updated successfully");
    Ok(())
}

#[tauri::command]
async fn get_next_url(state: State<'_, AppState>) -> Result<String, String> {
    let server = state.next_server.lock().await;
    Ok(server.get_url())
}

#[tauri::command]
async fn start_drag_window(window: tauri::Window) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|e| format!("Failed to start window drag: {}", e))?;
    Ok(())
}

#[tokio::main]
async fn main() {
    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    log::info!("Starting Bud Studio...");

    // Load or create config
    let config = match AppConfig::load() {
        Ok(cfg) => {
            log::info!("Loaded config from disk");
            cfg
        }
        Err(e) => {
            log::warn!("Failed to load config: {}, using defaults", e);
            AppConfig::default()
        }
    };

    let next_port = config.next_port;

    // Create app state
    let app_state = AppState {
        config: Arc::new(Mutex::new(config)),
        next_server: Arc::new(TokioMutex::new(NextServer::new(next_port))),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_backend_url,
            get_next_url,
            start_drag_window
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Get app data directory for persistent cookie storage
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");

            // Create the directory if it doesn't exist
            std::fs::create_dir_all(&app_data_dir).ok();

            log::info!("App data directory: {:?}", app_data_dir);

            // Create the main window programmatically with persistent data directory
            let webview_data_dir = app_data_dir.join("webview_data");
            std::fs::create_dir_all(&webview_data_dir).ok();
            log::info!("WebView data directory: {:?}", webview_data_dir);

            let main_window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into())
            )
            .title("Bud Studio")
            .inner_size(1400.0, 900.0)
            .min_inner_size(1000.0, 700.0)
            .resizable(true)
            .fullscreen(false)
            .decorations(true)
            .transparent(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .accept_first_mouse(true)
            .center()
            .data_directory(webview_data_dir)
            .build()
            .expect("Failed to create main window");

            log::info!("Main window created with persistent data directory");

            // Clone the Arc to move into the async task
            let next_server_arc = app.state::<AppState>().next_server.clone();

            // Spawn async task to start Next.js server
            tauri::async_runtime::spawn(async move {
                log::info!("Initializing Next.js server...");

                // Get the resource path for Next.js standalone build
                let resource_path = handle
                    .path()
                    .resource_dir()
                    .expect("Failed to get resource directory");

                let standalone_path = if cfg!(debug_assertions) {
                    // In development, use the web directory
                    // When running from desktop/src-tauri, go up two levels to reach project root
                    let current_dir = std::env::current_dir()
                        .expect("Failed to get current directory");
                    current_dir
                        .parent()
                        .expect("Failed to get parent directory (src-tauri)")
                        .parent()
                        .expect("Failed to get parent directory (desktop)")
                        .join("web")
                        .join(".next")
                        .join("standalone")
                } else {
                    // In production, use the bundled resources
                    resource_path.join("web").join(".next").join("standalone")
                };

                log::info!("Next.js standalone path: {:?}", standalone_path);

                // Start Next.js server
                let start_result = {
                    let mut server = next_server_arc.lock().await;
                    server.start(standalone_path.to_string_lossy().to_string()).await
                };

                match start_result {
                    Ok(url) => {
                        log::info!("Next.js server started successfully at {}", url);

                        // Get the main window
                        if let Some(window) = handle.get_webview_window("main") {
                            // Navigate to Next.js server
                            let _ = window.eval(&format!("window.location.href = '{}'", url));
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to start Next.js server: {}", e);
                        log::error!(
                            "Make sure to build the Next.js app first with 'npm run build' in the web directory"
                        );
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if *focused {
                    // Note: Titlebar injection happens on initial page load
                    // Re-injection on focus is not critical for the prototype
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
