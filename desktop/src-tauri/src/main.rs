// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod next_server;
mod titlebar;

use config::AppConfig;
use next_server::NextServer;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex as TokioMutex;

// Global shutdown flag for signal handlers
static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

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
fn needs_setup(state: State<AppState>) -> bool {
    let config = state.config.lock().unwrap();
    config.needs_setup()
}

#[tauri::command]
fn complete_setup(state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config
        .mark_configured()
        .map_err(|e| format!("Failed to mark config as configured: {}", e))?;
    log::info!("Setup completed successfully");
    Ok(())
}

#[tauri::command]
async fn validate_backend_url(url: String) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Normalize URL - remove trailing slash
    let base_url = url.trim_end_matches('/').to_string();

    // Try multiple health endpoints in parallel
    let endpoints = vec![
        format!("{}/api/health", base_url),
        format!("{}/health", base_url),
        base_url.clone(),
    ];

    log::info!("Validating backend URL: {}", base_url);

    let futures: Vec<_> = endpoints
        .into_iter()
        .map(|endpoint| {
            let client = client.clone();
            async move {
                log::info!("Checking endpoint: {}", endpoint);
                match client.get(&endpoint).send().await {
                    Ok(response) => {
                        log::info!("Got response from {}: {}", endpoint, response.status());
                        response.status().is_success() || response.status().is_redirection()
                    }
                    Err(e) => {
                        log::warn!("Failed to reach {}: {}", endpoint, e);
                        false
                    }
                }
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;
    let is_valid = results.into_iter().any(|r| r);

    log::info!("Backend validation result: {}", is_valid);
    Ok(is_valid)
}

#[tauri::command]
async fn start_app(handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("Starting app after setup...");

    // Get backend URL from config
    let backend_url = {
        let config = state.config.lock().unwrap();
        config.backend_url.clone()
    };

    // Start Next.js server in background
    // Frontend will handle navigation to loading page
    let next_server_arc = state.next_server.clone();
    let handle_clone = handle.clone();

    tauri::async_runtime::spawn(async move {
        start_next_server(handle_clone, next_server_arc, backend_url).await;
    });

    Ok(())
}

async fn start_next_server(handle: tauri::AppHandle, next_server_arc: Arc<TokioMutex<NextServer>>, backend_url: String) {
    log::info!("Initializing Next.js server...");

    // Get the resource path for Next.js standalone build
    let resource_path = handle
        .path()
        .resource_dir()
        .expect("Failed to get resource directory");

    let standalone_path = if cfg!(debug_assertions) {
        let current_dir = std::env::current_dir().expect("Failed to get current directory");
        current_dir
            .parent()
            .expect("Failed to get parent directory (src-tauri)")
            .parent()
            .expect("Failed to get parent directory (desktop)")
            .join("web")
            .join(".next")
            .join("standalone")
    } else {
        resource_path.join("web").join(".next").join("standalone")
    };

    log::info!("Next.js standalone path: {:?}", standalone_path);

    let start_result = {
        let mut server = next_server_arc.lock().await;
        server
            .start(standalone_path.to_string_lossy().to_string(), backend_url)
            .await
    };

    match start_result {
        Ok(url) => {
            log::info!("Next.js server started successfully at {}", url);

            if let Some(window) = handle.get_webview_window("main") {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                log::info!("Navigating to {}", url);
                match url.parse::<tauri::Url>() {
                    Ok(parsed_url) => {
                        if let Err(e) = window.navigate(parsed_url) {
                            log::error!("Failed to navigate: {}", e);
                        }
                    }
                    Err(e) => {
                        log::error!("Failed to parse URL: {}", e);
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Failed to start Next.js server: {}", e);
            log::error!(
                "Make sure to build the Next.js app first with 'npm run build' in the web directory"
            );
        }
    }
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

/// Perform synchronous cleanup of the Next.js server
fn cleanup_server(next_server: Arc<TokioMutex<NextServer>>, port: u16) {
    log::info!("Performing server cleanup...");

    // Create a dedicated runtime for cleanup
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            log::error!("Failed to create runtime for cleanup: {}", e);
            // Fallback: try to kill process on port directly
            NextServer::kill_process_on_port_static(port);
            return;
        }
    };

    rt.block_on(async {
        let server = next_server.lock().await;
        if let Err(e) = server.stop() {
            log::error!("Failed to stop Next.js server: {}", e);
        } else {
            log::info!("Next.js server cleanup completed");
        }
    });
}

/// Setup signal handlers to catch SIGTERM, SIGINT, etc.
fn setup_signal_handlers(next_server: Arc<TokioMutex<NextServer>>, port: u16) {
    let server = next_server;

    ctrlc::set_handler(move || {
        // Check if we're already shutting down
        if SHUTDOWN_REQUESTED.swap(true, Ordering::SeqCst) {
            log::warn!("Force exit requested (second signal)");
            std::process::exit(1);
        }

        log::info!("Signal received (SIGINT/SIGTERM), cleaning up...");
        cleanup_server(server.clone(), port);
        log::info!("Cleanup complete, exiting");
        std::process::exit(0);
    })
    .expect("Error setting signal handler");
}

/// Create custom application menu with controlled Quit item
fn create_app_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // Custom quit menu item that we control - this ensures ExitRequested fires
    let quit_item = MenuItem::with_id(app, "quit", "Quit Bud Studio", true, Some("CmdOrCtrl+Q"))?;

    let app_menu = Submenu::with_items(
        app,
        "Bud Studio",
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
            &quit_item, // Custom quit instead of PredefinedMenuItem::quit
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

#[tokio::main]
async fn main() {
    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

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

    // Create app state with shared NextServer
    let next_server = Arc::new(TokioMutex::new(NextServer::new(next_port)));

    // Setup signal handlers BEFORE building Tauri app
    // This catches SIGTERM/SIGINT even if Tauri's handlers don't fire
    setup_signal_handlers(next_server.clone(), next_port);

    let app_state = AppState {
        config: Arc::new(Mutex::new(config)),
        next_server: next_server.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_backend_url,
            get_next_url,
            start_drag_window,
            needs_setup,
            complete_setup,
            start_app,
            validate_backend_url
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Create custom menu with controlled Quit
            let menu = create_app_menu(app)?;
            app.set_menu(menu)?;

            // Get app data directory for persistent cookie storage
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Create the directory if it doesn't exist
            std::fs::create_dir_all(&app_data_dir).ok();

            log::info!("App data directory: {:?}", app_data_dir);

            // Create the main window programmatically with persistent data directory
            let webview_data_dir = app_data_dir.join("webview_data");
            std::fs::create_dir_all(&webview_data_dir).ok();
            log::info!("WebView data directory: {:?}", webview_data_dir);

            // Determine initial page based on setup status
            let app_state = app.state::<AppState>();
            let config = app_state.config.lock().unwrap();
            let initial_page = if config.needs_setup() {
                log::info!("First run detected, showing setup page");
                "setup.html"
            } else {
                log::info!("Config found, showing loading page");
                "index.html"
            };
            drop(config); // Release lock before creating window

            let _main_window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(initial_page.into()))
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

            // Only start Next.js server if setup is already complete
            let config = app_state.config.lock().unwrap();
            let setup_complete = !config.needs_setup();
            let backend_url = config.backend_url.clone();
            drop(config);

            if setup_complete {
                // Clone the Arc to move into the async task
                let next_server_arc = app.state::<AppState>().next_server.clone();

                // Spawn async task to start Next.js server
                tauri::async_runtime::spawn(async move {
                    start_next_server(handle, next_server_arc, backend_url).await;
                });
            } else {
                log::info!("Skipping Next.js server start - waiting for setup to complete");
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                log::info!("Quit menu item clicked, initiating cleanup...");
                app.exit(0); // This will trigger ExitRequested
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                    log::info!(
                        "App reopened from Dock/Finder (has_visible_windows: {})",
                        has_visible_windows
                    );

                    // Show the main window if it exists but is hidden
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }

                    // Check if Next.js server is running, if not start it
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let next_server = state.next_server.clone();
                        let handle_clone = app_handle.clone();
                        let backend_url = {
                            let config = state.config.lock().unwrap();
                            config.backend_url.clone()
                        };

                        // Spawn async task to check and start server if needed
                        tauri::async_runtime::spawn(async move {
                            let is_running = {
                                let server = next_server.lock().await;
                                server.is_running()
                            };

                            if !is_running {
                                log::info!("Next.js server not running, starting it...");
                                start_next_server(handle_clone, next_server, backend_url).await;
                            } else {
                                log::info!("Next.js server already running");
                            }
                        });
                    }
                }
                tauri::RunEvent::ExitRequested { code, .. } => {
                    log::info!(
                        "Exit requested (code: {:?}), cleaning up Next.js server...",
                        code
                    );

                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let next_server = state.next_server.clone();
                        let port = {
                            let config = state.config.lock().unwrap();
                            config.next_port
                        };
                        // Synchronous cleanup to ensure it completes before exit
                        std::thread::spawn(move || {
                            cleanup_server(next_server, port);
                        })
                        .join()
                        .ok();
                    }
                }
                tauri::RunEvent::Exit => {
                    log::info!("Application exiting");
                }
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    if label == "main" {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            // On macOS, clicking red X just hides the window by default
                            // We explicitly quit the app - ExitRequested will handle cleanup
                            log::info!("Window close requested, quitting app...");
                            app_handle.exit(0);
                        }
                    }
                }
                _ => {}
            }
        });
}
