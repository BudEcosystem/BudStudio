# BudAgent Desktop App Implementation Plan

## Overview

This plan outlines the implementation of **BudAgent** - an autonomous AI agent integrated into Onyx as a **Tauri desktop application called "Bud Studio"**. This enables local file system access, code execution, and browser automation while maintaining the existing Onyx chat experience.

**Why Tauri over Electron:**
- 🪶 **Lightweight**: ~10MB vs Electron's ~150MB (uses system WebView instead of bundling Chromium)
- ⚡ **Performance**: Lower memory footprint, faster startup
- 🦀 **Rust Backend**: Secure, performant native operations
- 🔐 **Security**: Better sandboxing and permission model
- 📦 **Smaller Bundle**: Distributes as native binary with embedded resources

**Architecture:**
- **Frontend**: Next.js 15.5.2 server runs **locally** (embedded in app, not remote)
- **Backend**: Rust process manages Next.js server, agent runtime, and native operations
- **Configuration**: Backend URL configurable for connecting to Onyx API server
- **Desktop Features**: Full keyboard shortcuts, menu bar, system tray, custom titlebar

**Key Features:**

| Feature | Description |
|---------|-------------|
| 🖥️ Local Frontend | Next.js runs locally in embedded Node.js process |
| ⚙️ Backend Config | Settings UI to configure Onyx backend URL |
| ⌨️ Keyboard Shortcuts | ⌘N (new chat), ⌘⇧N (new window), ⌘R (reload), etc. |
| 📋 Menu Bar | Native File/Edit/View/Help menus |
| 🔔 System Tray | Quick access from menu bar/taskbar |
| 🎨 Custom Titlebar | macOS-style overlay titlebar with drag support |
| 💾 Window State | Remembers size/position between sessions |
| 🤖 BudAgent | Local file access, code execution, autonomous operation |
| 🔐 Workspace Security | File operations limited to selected workspace |
| 🌐 Multi-window | Open multiple Bud Studio windows |

---

## Issues to Address

### Primary Goals

1. **Local File Access**: Agent can read, write, and edit files on the user's machine without uploads
2. **Code Execution**: Agent can run commands locally (bash, python, npm, etc.)
3. **Autonomous Operation**: Agent can plan, execute multi-step tasks, and iterate without constant user input
4. **Single Install Experience**: Users install one desktop app with embedded Next.js server
5. **Cowork-like UX**: Similar to Claude Desktop's Cowork feature - workspace selection, file browser, streaming visibility

### Secondary Goals

1. Browser automation via local Playwright
2. Subagent coordination for parallel tasks
3. Session persistence and resume capability
4. Cross-platform support (macOS, Windows, Linux)

---

## Important Notes

### Current Onyx Architecture

1. **Frontend**: Next.js 15.5.2 with heavy SSR usage
   - Server components fetch data on render
   - `output: "standalone"` mode configured
   - React 18.3.1 + TypeScript + Tailwind CSS

2. **Backend Communication**:
   - All API calls go through `/api/[...path]` proxy route
   - Streaming via fetch + ReadableStream (not WebSocket)
   - Cookie-based auth (`fastapiusersauth`)

3. **Existing Chat Flow**:
   - `backend/onyx/chat/process_message.py` - main orchestration
   - `backend/onyx/chat/turn/fast_chat_turn.py` - agent loop with `agents` library
   - Packet-based streaming: `MessageStart`, `MessageDelta`, `ToolStart`, etc.

### Technical Constraints

1. **SSR Dependency**: Converting to static export would require refactoring ~100+ server components. Instead, we'll embed the Next.js server in Tauri's Rust process.

2. **Python Backend**: Onyx backend is Python/FastAPI. For full offline capability, we'd need to embed it. Initial version can connect to remote backend via configurable URL.

3. **OAuth Flows**: Desktop apps need special handling for OAuth callbacks (deep links or local callback server).

4. **WebView Limitations**: Tauri uses system WebView (WebKit on macOS, WebView2 on Windows). Need to test Next.js compatibility.

### Reference Implementations

1. **Onyx Tauri Desktop** (from main repo): Loads remote URL, injects titlebar, config management - serves as basis for Bud Studio
2. **Claude Desktop Cowork**: Sub-agent coordination, VM execution, file system access, streaming visibility
3. **OpenClaw**: Local gateway on `ws://localhost:18789`, session isolation, multi-channel support
4. **Claude Agent SDK**: Subagents via Task tool, tool restrictions, session resume, MCP integration
5. **AgentAPI**: HTTP wrapper for CLI agents, message parsing, SSE streaming

---

## Implementation Strategy

### Phase 1: Tauri Shell + Embedded Next.js + Desktop Features

**Objective**: Get existing Onyx frontend running **locally** in a Tauri app with full desktop integration (shortcuts, menus, titlebar, config management).

#### 1.1 Project Structure Setup

Create new `desktop/` directory alongside existing `web/`:

```
onyx/
├── web/                          # Existing frontend (unchanged)
├── backend/                      # Existing backend (unchanged)
└── desktop/                      # NEW: Tauri app
    ├── package.json              # Node dependencies & scripts
    ├── tsconfig.json             # TypeScript config for Node side
    ├── src-tauri/
    │   ├── Cargo.toml            # Rust dependencies
    │   ├── tauri.conf.json       # Tauri configuration
    │   ├── build.rs              # Rust build script
    │   ├── icons/                # App icons
    │   └── src/
    │       ├── main.rs           # Rust main process
    │       ├── agent/            # Agent runtime (Rust)
    │       │   ├── mod.rs
    │       │   ├── orchestrator.rs
    │       │   ├── tools/
    │       │   │   ├── mod.rs
    │       │   │   ├── filesystem.rs
    │       │   │   ├── bash.rs
    │       │   │   ├── glob.rs
    │       │   │   └── grep.rs
    │       │   └── llm.rs
    │       ├── next_server.rs    # Next.js server management
    │       └── config.rs         # Config management
    ├── src/                      # Node.js services (called from Rust)
    │   ├── next-launcher.ts      # Next.js server spawner
    │   └── agent-bridge.ts       # Agent LLM bridge
    └── scripts/
        ├── build.sh              # Build script
        └── dev.sh                # Dev script
```

#### 1.2 Loading Screen

Create a simple loading screen that displays while Next.js server starts:

```html
<!-- desktop/src/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bud Studio</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        color: white;
      }

      .loader {
        text-align: center;
      }

      .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      h1 {
        font-size: 32px;
        font-weight: 600;
        margin: 0 0 10px 0;
      }

      p {
        font-size: 16px;
        opacity: 0.8;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div class="loader">
      <div class="spinner"></div>
      <h1>Bud Studio</h1>
      <p>Starting application...</p>
    </div>

    <script>
      // This page is shown briefly while Next.js server starts
      // The Rust code will navigate to localhost:PORT once ready
    </script>
  </body>
</html>
```

#### 1.3 Tauri Configuration

```json
// desktop/src-tauri/tauri.conf.json
{
  "$schema": "https://schema.tauri.app/config/2.0.0",
  "productName": "Bud Studio",
  "version": "1.0.0",
  "identifier": "com.bud.studio",
  "build": {
    "beforeBuildCommand": "cd ../web && npm run build",
    "beforeDevCommand": "",
    "frontendDist": "../dist",
    "devUrl": "http://localhost:3456"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Bud Studio",
        "label": "main",
        "width": 1400,
        "height": 900,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "url": "index.html"
      }
    ],
    "fileDropEnabled": false,
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    },
    "macOSPrivateApi": true
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": [
      "../web/.next/standalone/**",
      "../web/.next/static/**",
      "../web/public/**",
      "binaries/*"
    ],
    "externalBin": [
      "binaries/node"
    ],
    "category": "Productivity",
    "shortDescription": "Bud Studio - AI Assistant with BudAgent",
    "longDescription": "Bud Studio desktop app with autonomous AI agent capabilities for local file access and code execution",
    "macOS": {
      "entitlements": null,
      "minimumSystemVersion": "10.15"
    }
  },
  "plugins": {
    "shell": {
      "open": true,
      "scope": [
        {
          "name": "node",
          "cmd": "node",
          "args": true,
          "sidecar": false
        }
      ]
    }
  }
}
```

#### 1.4 Rust Main Process

```rust
// desktop/src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{Manager, State, Window};
use tokio::sync::oneshot;

mod agent;
mod config;
mod next_server;

use agent::AgentRuntime;
use config::{AppConfig, load_config, save_config};
use next_server::NextServer;

// ============================================================================
// State Management
// ============================================================================

struct AppState {
    config: Arc<Mutex<AppConfig>>,
    agent_runtime: Arc<Mutex<Option<AgentRuntime>>>,
    next_server: Arc<Mutex<Option<NextServer>>>,
}

// ============================================================================
// Tauri Commands - Configuration
// ============================================================================

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[tauri::command]
fn set_server_url(state: State<AppState>, url: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.server_url = url;
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
fn get_next_server_port(state: State<AppState>) -> Result<u16, String> {
    let server = state.next_server.lock().unwrap();
    server
        .as_ref()
        .map(|s| s.port())
        .ok_or_else(|| "Next.js server not started".to_string())
}

// ============================================================================
// Tauri Commands - File System
// ============================================================================

#[tauri::command]
async fn fs_read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
async fn fs_write_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
async fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    while let Some(entry) = dir.next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))? {
        let metadata = entry.metadata()
            .await
            .map_err(|e| format!("Failed to get metadata: {}", e))?;

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            is_file: metadata.is_file(),
        });
    }

    Ok(entries)
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    is_directory: bool,
    is_file: bool,
}

#[tauri::command]
async fn fs_stat(path: String) -> Result<FileStats, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to stat file: {}", e))?;

    Ok(FileStats {
        size: metadata.len(),
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
        modified: metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs()),
    })
}

#[derive(serde::Serialize)]
struct FileStats {
    size: u64,
    is_directory: bool,
    is_file: bool,
    modified: Option<u64>,
}

#[tauri::command]
async fn fs_exists(path: String) -> Result<bool, String> {
    Ok(tokio::fs::try_exists(&path).await.unwrap_or(false))
}

#[tauri::command]
async fn fs_mkdir(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
async fn fs_delete(path: String) -> Result<(), String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to stat path: {}", e))?;

    if metadata.is_dir() {
        tokio::fs::remove_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete file: {}", e))
    }
}

// ============================================================================
// Tauri Commands - Agent
// ============================================================================

#[tauri::command]
async fn agent_initialize(
    state: State<'_, AppState>,
    workspace: String,
    llm_endpoint: String,
    api_key: String,
) -> Result<(), String> {
    let runtime = AgentRuntime::new(workspace, llm_endpoint, api_key)
        .map_err(|e| format!("Failed to initialize agent: {}", e))?;

    let mut agent = state.agent_runtime.lock().unwrap();
    *agent = Some(runtime);

    Ok(())
}

#[tauri::command]
async fn agent_execute(
    state: State<'_, AppState>,
    window: Window,
    message: String,
) -> Result<(), String> {
    let agent_lock = state.agent_runtime.lock().unwrap();
    let agent = agent_lock
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;

    // Clone agent handle for async execution
    let agent_handle = agent.clone();

    // Spawn execution task
    tauri::async_runtime::spawn(async move {
        let mut stream = agent_handle.execute(message).await;

        while let Some(packet) = stream.next().await {
            let _ = window.emit("agent:packet", packet);
        }
    });

    Ok(())
}

#[tauri::command]
fn agent_cancel(state: State<AppState>) -> Result<(), String> {
    let agent = state.agent_runtime.lock().unwrap();
    if let Some(runtime) = agent.as_ref() {
        runtime.cancel();
        Ok(())
    } else {
        Err("Agent not initialized".to_string())
    }
}

#[tauri::command]
fn agent_get_status(state: State<AppState>) -> Result<AgentStatus, String> {
    let agent = state.agent_runtime.lock().unwrap();
    if let Some(runtime) = agent.as_ref() {
        Ok(runtime.status())
    } else {
        Ok(AgentStatus {
            is_running: false,
            workspace: None,
            message_count: 0,
        })
    }
}

#[derive(serde::Serialize)]
struct AgentStatus {
    is_running: bool,
    workspace: Option<String>,
    message_count: usize,
}

// ============================================================================
// Dialogs
// ============================================================================

#[tauri::command]
async fn dialog_select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;

    let result = FileDialogBuilder::new()
        .set_title("Select Workspace Directory")
        .pick_folder();

    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn dialog_select_file(
    app: tauri::AppHandle,
    filters: Option<Vec<(String, Vec<String>)>>,
) -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;

    let mut builder = FileDialogBuilder::new()
        .set_title("Select File");

    if let Some(filter_list) = filters {
        for (name, extensions) in filter_list {
            builder = builder.add_filter(&name, &extensions);
        }
    }

    let result = builder.pick_file();
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

// ============================================================================
// Main Entry Point
// ============================================================================

fn main() {
    // Load configuration
    let config = load_config().unwrap_or_default();

    tauri::Builder::default()
        .manage(AppState {
            config: Arc::new(Mutex::new(config)),
            agent_runtime: Arc::new(Mutex::new(None)),
            next_server: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            // Config
            get_config,
            set_server_url,
            get_next_server_port,
            // File system
            fs_read_file,
            fs_write_file,
            fs_read_dir,
            fs_stat,
            fs_exists,
            fs_mkdir,
            fs_delete,
            // Agent
            agent_initialize,
            agent_execute,
            agent_cancel,
            agent_get_status,
            // Dialogs
            dialog_select_directory,
            dialog_select_file,
        ])
        .setup(|app| {
            let app_handle = app.handle();
            let state = app.state::<AppState>();

            // Start Next.js server
            tauri::async_runtime::spawn(async move {
                match NextServer::start().await {
                    Ok(server) => {
                        let port = server.port();
                        println!("Next.js server started on port {}", port);

                        // Store server instance
                        let mut next_server = state.next_server.lock().unwrap();
                        *next_server = Some(server);

                        // Navigate main window to Next.js server
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let url = format!("http://localhost:{}", port);
                            let _ = window.eval(&format!("window.location.href = '{}'", url));
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to start Next.js server: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 1.5 Next.js Server Management (Rust)

```rust
// desktop/src-tauri/src/next_server.rs
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};

pub struct NextServer {
    process: Arc<Mutex<Child>>,
    port: u16,
}

impl NextServer {
    pub async fn start() -> Result<Self, String> {
        // Find available port
        let port = find_available_port().await?;

        // Get path to bundled Next.js standalone server
        let resources_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .ok_or_else(|| "Failed to get resources directory".to_string())?;

        let next_dir = resources_dir.join("web");
        let node_bin = resources_dir.join("binaries/node");
        let server_js = next_dir.join("server.js");

        // Start Node.js process
        let mut child = Command::new(&node_bin)
            .arg(server_js)
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .current_dir(&next_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn Next.js server: {}", e))?;

        // Capture stdout/stderr for debugging
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            tokio::spawn(async move {
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    println!("[Next.js] {}", line);
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            tokio::spawn(async move {
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[Next.js] {}", line);
                }
            });
        }

        // Wait for server to be ready
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        Ok(Self {
            process: Arc::new(Mutex::new(child)),
            port,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for NextServer {
    fn drop(&mut self) {
        // Kill Next.js process when app closes
        if let Ok(mut process) = self.process.try_lock() {
            let _ = process.kill();
        }
    }
}

async fn find_available_port() -> Result<u16, String> {
    use std::net::TcpListener;

    // Try ports 3456-3500
    for port in 3456..3500 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }

    Err("No available ports found".to_string())
}
```

#### 1.7 Configuration Management (Rust)

```rust
// desktop/src-tauri/src/config.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    pub window_title: String,
    pub workspace: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: "http://localhost:8080".to_string(),
            window_title: "Bud Studio".to_string(),
            workspace: None,
        }
    }
}

pub fn get_config_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "Failed to get config directory".to_string())?;

    let app_config_dir = config_dir.join("com.bud.studio");
    std::fs::create_dir_all(&app_config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    Ok(app_config_dir.join("config.json"))
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = get_config_path()?;

    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path()?;

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write config: {}", e))
}
```

#### 1.6 Desktop Features Integration

##### 1.6.1 Keyboard Shortcuts

Add global keyboard shortcuts for common actions:

```rust
// desktop/src-tauri/src/main.rs (add to main function)

use tauri::GlobalShortcutManager;

fn setup_shortcuts(app: &AppHandle) -> Result<(), String> {
    let mut shortcuts = app.global_shortcut_manager();

    // New Chat: Cmd+N / Ctrl+N
    shortcuts.register("CmdOrCtrl+N", {
        let app = app.clone();
        move || {
            trigger_new_chat(&app);
        }
    }).map_err(|e| e.to_string())?;

    // New Window: Cmd+Shift+N / Ctrl+Shift+N
    shortcuts.register("CmdOrCtrl+Shift+N", {
        let app = app.clone();
        move || {
            trigger_new_window(&app);
        }
    }).map_err(|e| e.to_string())?;

    // Reload: Cmd+R / Ctrl+R
    shortcuts.register("CmdOrCtrl+R", {
        let app = app.clone();
        move || {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
    }).map_err(|e| e.to_string())?;

    // Back: Cmd+[ / Ctrl+[
    shortcuts.register("CmdOrCtrl+[", {
        let app = app.clone();
        move || {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.history.back()");
            }
        }
    }).map_err(|e| e.to_string())?;

    // Forward: Cmd+] / Ctrl+]
    shortcuts.register("CmdOrCtrl+]", {
        let app = app.clone();
        move || {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.history.forward()");
            }
        }
    }).map_err(|e| e.to_string())?;

    // Settings: Cmd+, / Ctrl+,
    shortcuts.register("CmdOrCtrl+,", {
        let app = app.clone();
        move || {
            open_settings(&app);
        }
    }).map_err(|e| e.to_string())?;

    Ok(())
}

fn trigger_new_chat(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Navigate to chat page
        let _ = window.eval("window.location.href = '/chat'");
    }
}

fn trigger_new_window(app: &AppHandle) {
    let state = app.state::<AppState>();
    let port = {
        let server = state.next_server.lock().unwrap();
        server.as_ref().map(|s| s.port())
    };

    if let Some(port) = port {
        tauri::async_runtime::spawn(async move {
            let window_label = format!("bud-studio-{}", uuid::Uuid::new_v4());
            let url = format!("http://localhost:{}", port);

            let builder = tauri::WebviewWindowBuilder::new(
                app,
                &window_label,
                tauri::WebviewUrl::External(url.parse().unwrap()),
            )
            .title("Bud Studio")
            .inner_size(1400.0, 900.0)
            .min_inner_size(800.0, 600.0)
            .transparent(true);

            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            if let Ok(window) = builder.build() {
                #[cfg(target_os = "macos")]
                inject_titlebar(&window);

                let _ = window.set_focus();
            }
        });
    }
}

fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Navigate to settings page with hash
        let _ = window.eval("window.location.hash = '#settings'");
    }
}
```

##### 1.6.2 Menu Bar Setup

```rust
// desktop/src-tauri/src/main.rs

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

fn setup_menu(app: &AppHandle) -> Result<(), String> {
    let menu = Menu::new(app).map_err(|e| e.to_string())?;

    // File Menu
    let new_chat = MenuItem::with_id(
        app,
        "new_chat",
        "New Chat",
        true,
        Some("CmdOrCtrl+N"),
    ).map_err(|e| e.to_string())?;

    let new_window = MenuItem::with_id(
        app,
        "new_window",
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    ).map_err(|e| e.to_string())?;

    let settings = MenuItem::with_id(
        app,
        "settings",
        "Settings...",
        true,
        Some("CmdOrCtrl+,"),
    ).map_err(|e| e.to_string())?;

    let close_window = PredefinedMenuItem::close_window(app, None)
        .map_err(|e| e.to_string())?;

    let quit = PredefinedMenuItem::quit(app, None)
        .map_err(|e| e.to_string())?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_chat,
            &new_window,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &settings,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &close_window,
            &quit,
        ],
    ).map_err(|e| e.to_string())?;

    // Edit Menu (standard)
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::redo(app, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::cut(app, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::copy(app, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::paste(app, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::select_all(app, None).map_err(|e| e.to_string())?,
        ],
    ).map_err(|e| e.to_string())?;

    // View Menu
    let reload = MenuItem::with_id(
        app,
        "reload",
        "Reload",
        true,
        Some("CmdOrCtrl+R"),
    ).map_err(|e| e.to_string())?;

    let back = MenuItem::with_id(
        app,
        "back",
        "Back",
        true,
        Some("CmdOrCtrl+["),
    ).map_err(|e| e.to_string())?;

    let forward = MenuItem::with_id(
        app,
        "forward",
        "Forward",
        true,
        Some("CmdOrCtrl+]"),
    ).map_err(|e| e.to_string())?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&reload, &back, &forward],
    ).map_err(|e| e.to_string())?;

    // Help Menu
    let docs = MenuItem::with_id(
        app,
        "docs",
        "Documentation",
        true,
        None::<&str>,
    ).map_err(|e| e.to_string())?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[&docs],
    ).map_err(|e| e.to_string())?;

    // Add menus
    menu.append(&file_menu).map_err(|e| e.to_string())?;
    menu.append(&edit_menu).map_err(|e| e.to_string())?;
    menu.append(&view_menu).map_err(|e| e.to_string())?;
    menu.append(&help_menu).map_err(|e| e.to_string())?;

    app.set_menu(menu).map_err(|e| e.to_string())?;

    // Handle menu events
    app.on_menu_event(|app, event| {
        match event.id().as_ref() {
            "new_chat" => trigger_new_chat(app),
            "new_window" => trigger_new_window(app),
            "settings" => open_settings(app),
            "reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.location.reload()");
                }
            }
            "back" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.history.back()");
                }
            }
            "forward" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.history.forward()");
                }
            }
            "docs" => {
                let _ = open::that("https://docs.onyx.app");
            }
            _ => {}
        }
    });

    Ok(())
}
```

##### 1.6.3 System Tray Icon

```rust
// desktop/src-tauri/src/main.rs

use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let icon = tauri::image::Image::from_bytes(TRAY_ICON_BYTES)
        .map_err(|e| e.to_string())?;

    let tray_menu = Menu::new(app).map_err(|e| e.to_string())?;

    let open_app = MenuItem::with_id(
        app,
        "tray_open",
        "Open Bud Studio",
        true,
        None::<&str>,
    ).map_err(|e| e.to_string())?;

    let new_chat = MenuItem::with_id(
        app,
        "tray_new_chat",
        "New Chat",
        true,
        None::<&str>,
    ).map_err(|e| e.to_string())?;

    let quit = PredefinedMenuItem::quit(app, Some("Quit"))
        .map_err(|e| e.to_string())?;

    tray_menu.append(&open_app).map_err(|e| e.to_string())?;
    tray_menu.append(&new_chat).map_err(|e| e.to_string())?;
    tray_menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    tray_menu.append(&quit).map_err(|e| e.to_string())?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&tray_menu)
        .tooltip("Bud Studio")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "tray_open" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "tray_new_chat" => trigger_new_chat(app),
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

##### 1.6.4 Custom Titlebar Injection (macOS)

```rust
// desktop/src-tauri/src/titlebar.rs

const TITLEBAR_SCRIPT: &str = r#"
(function() {
    const TITLEBAR_ID = 'bud-studio-titlebar';
    const TITLEBAR_HEIGHT = 36;

    if (document.getElementById(TITLEBAR_ID)) return;

    // Create titlebar
    const titlebar = document.createElement('div');
    titlebar.id = TITLEBAR_ID;
    titlebar.setAttribute('data-tauri-drag-region', '');

    // Style
    titlebar.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: ${TITLEBAR_HEIGHT}px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.78) 100%);
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.04);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        user-select: none;
        -webkit-user-select: none;
        -webkit-app-region: drag;
        backdrop-filter: blur(18px) saturate(180%);
        -webkit-backdrop-filter: blur(18px) saturate(180%);
    `;

    // Dark mode support
    const updateTheme = () => {
        const isDark = document.documentElement.classList.contains('dark') ||
                      document.body.classList.contains('dark');

        if (isDark) {
            titlebar.style.background = 'linear-gradient(180deg, rgba(18, 18, 18, 0.82) 0%, rgba(18, 18, 18, 0.72) 100%)';
            titlebar.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';
        } else {
            titlebar.style.background = 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.78) 100%)';
            titlebar.style.borderBottom = '1px solid rgba(0, 0, 0, 0.06)';
        }
    };

    // Observe theme changes
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (document.body) {
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    // Inject into DOM
    if (document.body) {
        document.body.insertBefore(titlebar, document.body.firstChild);

        // Adjust body padding
        document.body.style.paddingTop = `${TITLEBAR_HEIGHT}px`;

        updateTheme();
    }

    // Re-inject on navigation
    window.addEventListener('load', updateTheme);
})();
"#;

pub fn inject_titlebar(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;

        // Inject immediately
        let _ = window.eval(TITLEBAR_SCRIPT);

        // Re-inject after delays to catch navigation
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            let delays = [200, 600, 1200, 2000, 4000];
            for delay in delays {
                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                let _ = window_clone.eval(TITLEBAR_SCRIPT);
            }
        });
    }
}
```

##### 1.6.5 Settings UI for Backend Configuration

Create a settings page in the Next.js frontend:

```typescript
// web/src/app/settings/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { TauriAPI, isTauri } from '@/lib/tauri';

export default function SettingsPage() {
  const [backendUrl, setBackendUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isTauri()) {
      TauriAPI.getConfig().then((config) => {
        setBackendUrl(config.server_url);
      });
    }
  }, []);

  const handleSave = async () => {
    if (!backendUrl.startsWith('http://') && !backendUrl.startsWith('https://')) {
      setError('URL must start with http:// or https://');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      await TauriAPI.setServerUrl(backendUrl);
      setSuccess(true);
      setTimeout(() => {
        // Reload to apply new backend URL
        window.location.reload();
      }, 1000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isTauri()) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <p className="text-gray-600">
          Desktop settings are only available in Bud Studio desktop app.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-4">Backend Configuration</h2>

          <div>
            <label className="block text-sm font-medium mb-2">
              Backend URL
            </label>
            <input
              type="text"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900"
            />
            <p className="text-sm text-gray-500 mt-1">
              The URL of your Onyx backend server
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-3 rounded-lg text-sm">
              Settings saved! Reloading...
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Reload'}
          </button>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h2 className="text-lg font-semibold mb-4">Keyboard Shortcuts</h2>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">New Chat</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">⌘N</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">New Window</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">⌘⇧N</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Reload</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">⌘R</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Back</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">⌘[</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Forward</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">⌘]</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Settings</span>
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">⌘,</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

##### 1.6.6 Update Main Setup Function

```rust
// desktop/src-tauri/src/main.rs (update setup function)

fn main() {
    let config = load_config().unwrap_or_default();

    tauri::Builder::default()
        .manage(AppState {
            config: Arc::new(Mutex::new(config)),
            agent_runtime: Arc::new(Mutex::new(None)),
            next_server: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_server_url,
            get_next_server_port,
            fs_read_file,
            fs_write_file,
            fs_read_dir,
            fs_stat,
            fs_exists,
            fs_mkdir,
            fs_delete,
            agent_initialize,
            agent_execute,
            agent_cancel,
            agent_get_status,
            dialog_select_directory,
            dialog_select_file,
        ])
        .setup(|app| {
            let app_handle = app.handle();
            let state = app.state::<AppState>();

            // Setup menu bar
            if let Err(e) = setup_menu(&app_handle) {
                eprintln!("Failed to setup menu: {}", e);
            }

            // Setup system tray
            if let Err(e) = setup_tray(&app_handle) {
                eprintln!("Failed to setup tray: {}", e);
            }

            // Setup keyboard shortcuts
            if let Err(e) = setup_shortcuts(&app_handle) {
                eprintln!("Failed to setup shortcuts: {}", e);
            }

            // Start Next.js server
            let app_clone = app_handle.clone();
            let state_clone = state.clone();
            tauri::async_runtime::spawn(async move {
                match NextServer::start().await {
                    Ok(server) => {
                        let port = server.port();
                        println!("Next.js server started on port {}", port);

                        let mut next_server = state_clone.next_server.lock().unwrap();
                        *next_server = Some(server);

                        if let Some(window) = app_clone.get_webview_window("main") {
                            let url = format!("http://localhost:{}", port);

                            #[cfg(target_os = "macos")]
                            inject_titlebar(&window);

                            let _ = window.eval(&format!("window.location.href = '{}'", url));
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to start Next.js server: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

### Phase 2: BudAgent Runtime (Rust)

**Objective**: Implement agent orchestrator and tools in Rust for performance and security.

#### 2.1 Agent Module Structure

```rust
// desktop/src-tauri/src/agent/mod.rs
mod orchestrator;
mod tools;
mod llm;

pub use orchestrator::{AgentRuntime, AgentPacket};
pub use tools::*;
```

#### 2.2 Agent Orchestrator

```rust
// desktop/src-tauri/src/agent/orchestrator.rs
use serde::{Deserialize, Serialize};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use tokio::sync::mpsc;

use super::tools::{Tool, ToolRegistry, FileSystemTool, BashTool, GlobTool, GrepTool};
use super::llm::LLMClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentPacket {
    Plan { content: String },
    Thinking { content: String },
    ToolStart { tool: String, args: serde_json::Value },
    ToolResult { tool: String, result: ToolResult },
    Message { content: String },
    Error { content: String },
    Complete { content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct AgentRuntime {
    workspace: String,
    llm_client: Arc<LLMClient>,
    tool_registry: Arc<ToolRegistry>,
    cancel_flag: Arc<AtomicBool>,
    max_iterations: usize,
}

impl AgentRuntime {
    pub fn new(workspace: String, llm_endpoint: String, api_key: String) -> Result<Self, String> {
        let llm_client = LLMClient::new(llm_endpoint, api_key);

        let mut tool_registry = ToolRegistry::new();
        tool_registry.register(Box::new(FileSystemTool::new(workspace.clone())));
        tool_registry.register(Box::new(BashTool::new(workspace.clone())));
        tool_registry.register(Box::new(GlobTool::new(workspace.clone())));
        tool_registry.register(Box::new(GrepTool::new(workspace.clone())));

        Ok(Self {
            workspace,
            llm_client: Arc::new(llm_client),
            tool_registry: Arc::new(tool_registry),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            max_iterations: 50,
        })
    }

    pub async fn execute(&self, message: String) -> mpsc::Receiver<AgentPacket> {
        let (tx, rx) = mpsc::channel(100);

        let workspace = self.workspace.clone();
        let llm_client = self.llm_client.clone();
        let tool_registry = self.tool_registry.clone();
        let cancel_flag = self.cancel_flag.clone();
        let max_iterations = self.max_iterations;

        tokio::spawn(async move {
            let mut messages = vec![
                ("user".to_string(), message),
            ];

            for iteration in 0..max_iterations {
                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = tx.send(AgentPacket::Complete {
                        content: "Cancelled by user".to_string()
                    }).await;
                    break;
                }

                // Call LLM
                match llm_client.complete(&messages, tool_registry.get_definitions()).await {
                    Ok(response) => {
                        // Send message if any
                        if let Some(content) = &response.content {
                            let _ = tx.send(AgentPacket::Message {
                                content: content.clone()
                            }).await;
                        }

                        // Check if done
                        if response.tool_calls.is_empty() {
                            let _ = tx.send(AgentPacket::Complete {
                                content: "Task completed".to_string()
                            }).await;
                            break;
                        }

                        // Execute tools
                        let mut tool_results = Vec::new();

                        for tool_call in &response.tool_calls {
                            // Send tool start packet
                            let _ = tx.send(AgentPacket::ToolStart {
                                tool: tool_call.name.clone(),
                                args: tool_call.args.clone(),
                            }).await;

                            // Execute tool
                            let result = tool_registry.execute(&tool_call.name, &tool_call.args).await;

                            // Send tool result packet
                            let _ = tx.send(AgentPacket::ToolResult {
                                tool: tool_call.name.clone(),
                                result: result.clone(),
                            }).await;

                            tool_results.push((tool_call.id.clone(), result));
                        }

                        // Add assistant message
                        messages.push((
                            "assistant".to_string(),
                            response.content.unwrap_or_default()
                        ));

                        // Add tool results
                        for (id, result) in tool_results {
                            let result_text = if result.success {
                                result.output.unwrap_or_else(|| "Success".to_string())
                            } else {
                                format!("Error: {}", result.error.unwrap_or_else(|| "Unknown error".to_string()))
                            };

                            messages.push((
                                "tool".to_string(),
                                result_text
                            ));
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(AgentPacket::Error {
                            content: e.to_string()
                        }).await;
                        break;
                    }
                }
            }
        });

        rx
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::Relaxed);
    }

    pub fn status(&self) -> AgentStatus {
        AgentStatus {
            is_running: !self.cancel_flag.load(Ordering::Relaxed),
            workspace: Some(self.workspace.clone()),
            message_count: 0, // TODO: track this
        }
    }
}

pub struct AgentStatus {
    pub is_running: bool,
    pub workspace: Option<String>,
    pub message_count: usize,
}
```

#### 2.3 Tool System (Rust)

```rust
// desktop/src-tauri/src/agent/tools/mod.rs
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;

mod filesystem;
mod bash;
mod glob;
mod grep;

pub use filesystem::FileSystemTool;
pub use bash::BashTool;
pub use glob::GlobTool;
pub use grep::GrepTool;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;

    async fn execute(&self, args: &Value) -> ToolResult;
}

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub async fn execute(&self, name: &str, args: &Value) -> ToolResult {
        match self.tools.get(name) {
            Some(tool) => tool.execute(args).await,
            None => ToolResult {
                success: false,
                output: None,
                error: Some(format!("Tool not found: {}", name)),
            },
        }
    }

    pub fn get_definitions(&self) -> Vec<Value> {
        self.tools.values().map(|tool| {
            serde_json::json!({
                "name": tool.name(),
                "description": tool.description(),
                "parameters": tool.parameters(),
            })
        }).collect()
    }
}
```

#### 2.4 File System Tool (Rust)

```rust
// desktop/src-tauri/src/agent/tools/filesystem.rs
use async_trait::async_trait;
use serde_json::Value;
use tokio::fs;
use std::path::Path;

use super::{Tool, ToolResult};

pub struct FileSystemTool {
    workspace: String,
}

impl FileSystemTool {
    pub fn new(workspace: String) -> Self {
        Self { workspace }
    }

    fn resolve_path(&self, relative_path: &str) -> Result<String, String> {
        let normalized = Path::new(relative_path)
            .components()
            .filter(|c| !matches!(c, std::path::Component::ParentDir))
            .collect::<std::path::PathBuf>();

        let full_path = Path::new(&self.workspace).join(normalized);

        // Security check
        if !full_path.starts_with(&self.workspace) {
            return Err(format!("Path '{}' is outside workspace", relative_path));
        }

        Ok(full_path.to_string_lossy().to_string())
    }
}

#[async_trait]
impl Tool for FileSystemTool {
    fn name(&self) -> &str {
        "filesystem"
    }

    fn description(&self) -> &str {
        "Read, write, edit, and manage files in the workspace"
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "write", "edit", "list", "delete", "mkdir", "exists"],
                    "description": "The action to perform"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory path relative to workspace"
                },
                "content": {
                    "type": "string",
                    "description": "Content for write action"
                },
                "old_string": {
                    "type": "string",
                    "description": "String to replace (for edit action)"
                },
                "new_string": {
                    "type": "string",
                    "description": "Replacement string (for edit action)"
                }
            },
            "required": ["action", "path"]
        })
    }

    async fn execute(&self, args: &Value) -> ToolResult {
        let action = args["action"].as_str().unwrap_or("");
        let path = args["path"].as_str().unwrap_or("");

        let full_path = match self.resolve_path(path) {
            Ok(p) => p,
            Err(e) => return ToolResult {
                success: false,
                output: None,
                error: Some(e),
            },
        };

        match action {
            "read" => {
                match fs::read_to_string(&full_path).await {
                    Ok(content) => ToolResult {
                        success: true,
                        output: Some(content),
                        error: None,
                    },
                    Err(e) => ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                }
            }

            "write" => {
                let content = args["content"].as_str().unwrap_or("");

                // Ensure parent directory exists
                if let Some(parent) = Path::new(&full_path).parent() {
                    let _ = fs::create_dir_all(parent).await;
                }

                match fs::write(&full_path, content).await {
                    Ok(_) => ToolResult {
                        success: true,
                        output: Some(format!("File written: {}", path)),
                        error: None,
                    },
                    Err(e) => ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                }
            }

            "edit" => {
                let old_string = args["old_string"].as_str().unwrap_or("");
                let new_string = args["new_string"].as_str().unwrap_or("");

                match fs::read_to_string(&full_path).await {
                    Ok(content) => {
                        if !content.contains(old_string) {
                            return ToolResult {
                                success: false,
                                output: None,
                                error: Some(format!("String not found: {}", old_string)),
                            };
                        }

                        let new_content = content.replace(old_string, new_string);

                        match fs::write(&full_path, new_content).await {
                            Ok(_) => ToolResult {
                                success: true,
                                output: Some(format!("File edited: {}", path)),
                                error: None,
                            },
                            Err(e) => ToolResult {
                                success: false,
                                output: None,
                                error: Some(e.to_string()),
                            },
                        }
                    }
                    Err(e) => ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                }
            }

            "list" => {
                match fs::read_dir(&full_path).await {
                    Ok(mut entries) => {
                        let mut items = Vec::new();

                        while let Ok(Some(entry)) = entries.next_entry().await {
                            if let Ok(metadata) = entry.metadata().await {
                                items.push(serde_json::json!({
                                    "name": entry.file_name().to_string_lossy(),
                                    "type": if metadata.is_dir() { "directory" } else { "file" }
                                }));
                            }
                        }

                        ToolResult {
                            success: true,
                            output: Some(serde_json::to_string_pretty(&items).unwrap()),
                            error: None,
                        }
                    }
                    Err(e) => ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                }
            }

            "delete" => {
                let metadata = match fs::metadata(&full_path).await {
                    Ok(m) => m,
                    Err(e) => return ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                };

                let result = if metadata.is_dir() {
                    fs::remove_dir_all(&full_path).await
                } else {
                    fs::remove_file(&full_path).await
                };

                match result {
                    Ok(_) => ToolResult {
                        success: true,
                        output: Some(format!("Deleted: {}", path)),
                        error: None,
                    },
                    Err(e) => ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                }
            }

            "mkdir" => {
                match fs::create_dir_all(&full_path).await {
                    Ok(_) => ToolResult {
                        success: true,
                        output: Some(format!("Directory created: {}", path)),
                        error: None,
                    },
                    Err(e) => ToolResult {
                        success: false,
                        output: None,
                        error: Some(e.to_string()),
                    },
                }
            }

            "exists" => {
                let exists = fs::try_exists(&full_path).await.unwrap_or(false);
                ToolResult {
                    success: true,
                    output: Some(exists.to_string()),
                    error: None,
                }
            }

            _ => ToolResult {
                success: false,
                output: None,
                error: Some(format!("Unknown action: {}", action)),
            },
        }
    }
}
```

#### 2.5 Bash Tool (Rust)

```rust
// desktop/src-tauri/src/agent/tools/bash.rs
use async_trait::async_trait;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::{Tool, ToolResult};

pub struct BashTool {
    workspace: String,
}

impl BashTool {
    pub fn new(workspace: String) -> Self {
        Self { workspace }
    }

    fn is_command_blocked(&self, command: &str) -> bool {
        let blocked_patterns = [
            "rm -rf /",
            "rm -rf ~",
            "mkfs",
            "dd if=",
            "> /dev/sd",
            "chmod -R 777 /",
        ];

        blocked_patterns.iter().any(|pattern| command.contains(pattern))
    }
}

#[async_trait]
impl Tool for BashTool {
    fn name(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Execute shell commands in the workspace"
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout in milliseconds (default: 120000)"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, args: &Value) -> ToolResult {
        let command = args["command"].as_str().unwrap_or("");
        let timeout_ms = args["timeout"].as_u64().unwrap_or(120000);

        // Security check
        if self.is_command_blocked(command) {
            return ToolResult {
                success: false,
                output: None,
                error: Some("Command blocked for safety reasons".to_string()),
            };
        }

        // Execute command
        let mut child = match Command::new("bash")
            .arg("-c")
            .arg(command)
            .current_dir(&self.workspace)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return ToolResult {
                success: false,
                output: None,
                error: Some(e.to_string()),
            },
        };

        // Wait for completion with timeout
        let result = timeout(
            Duration::from_millis(timeout_ms),
            child.wait_with_output()
        ).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                // Truncate if too long
                let stdout = if stdout.len() > 50000 {
                    format!("{}... (truncated)", &stdout[..50000])
                } else {
                    stdout
                };

                let stderr = if stderr.len() > 50000 {
                    format!("{}... (truncated)", &stderr[..50000])
                } else {
                    stderr
                };

                ToolResult {
                    success: output.status.success(),
                    output: if !stdout.is_empty() { Some(stdout) } else { None },
                    error: if !stderr.is_empty() { Some(stderr) } else { None },
                }
            }
            Ok(Err(e)) => ToolResult {
                success: false,
                output: None,
                error: Some(e.to_string()),
            },
            Err(_) => {
                let _ = child.kill().await;
                ToolResult {
                    success: false,
                    output: None,
                    error: Some("Command timed out".to_string()),
                }
            }
        }
    }
}
```

#### 2.6 LLM Client (Rust)

```rust
// desktop/src-tauri/src/agent/llm.rs
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone)]
pub struct LLMClient {
    endpoint: String,
    api_key: String,
}

#[derive(Debug, Serialize)]
struct CompletionRequest {
    model: String,
    messages: Vec<Message>,
    tools: Vec<Value>,
    tool_choice: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct CompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

pub struct LLMResponse {
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCallParsed>,
}

pub struct ToolCallParsed {
    pub id: String,
    pub name: String,
    pub args: Value,
}

impl LLMClient {
    pub fn new(endpoint: String, api_key: String) -> Self {
        Self { endpoint, api_key }
    }

    pub async fn complete(
        &self,
        messages: &[(String, String)],
        tools: Vec<Value>,
    ) -> Result<LLMResponse, String> {
        let formatted_messages: Vec<Message> = messages
            .iter()
            .map(|(role, content)| Message {
                role: role.clone(),
                content: content.clone(),
            })
            .collect();

        let request = CompletionRequest {
            model: "gpt-4o".to_string(),
            messages: formatted_messages,
            tools: tools.iter().map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": t
                })
            }).collect(),
            tool_choice: "auto".to_string(),
        };

        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/chat/completions", self.endpoint))
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API error: {}", response.status()));
        }

        let data: CompletionResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let choice = data.choices.first()
            .ok_or_else(|| "No choices in response".to_string())?;

        let tool_calls = if let Some(calls) = &choice.message.tool_calls {
            calls.iter().map(|tc| {
                let args: Value = serde_json::from_str(&tc.function.arguments)
                    .unwrap_or(Value::Null);

                ToolCallParsed {
                    id: tc.id.clone(),
                    name: tc.function.name.clone(),
                    args,
                }
            }).collect()
        } else {
            Vec::new()
        };

        Ok(LLMResponse {
            content: choice.message.content.clone(),
            tool_calls,
        })
    }
}
```

---

### Phase 3: Frontend Integration

**Objective**: Connect the Onyx web frontend to Tauri's backend.

#### 3.1 Tauri API Client

```typescript
// web/src/lib/tauri/index.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface AgentPacket {
  type: 'plan' | 'thinking' | 'tool_start' | 'tool_result' | 'message' | 'error' | 'complete';
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

export class TauriAPI {
  static async getConfig(): Promise<any> {
    return invoke('get_config');
  }

  static async setServerUrl(url: string): Promise<void> {
    return invoke('set_server_url', { url });
  }

  static async getNextServerPort(): Promise<number> {
    return invoke('get_next_server_port');
  }

  // File system
  static async readFile(path: string): Promise<string> {
    return invoke('fs_read_file', { path });
  }

  static async writeFile(path: string, content: string): Promise<void> {
    return invoke('fs_write_file', { path, content });
  }

  static async readDir(path: string): Promise<Array<{ name: string; is_directory: boolean; is_file: boolean }>> {
    return invoke('fs_read_dir', { path });
  }

  static async stat(path: string): Promise<{ size: number; is_directory: boolean; is_file: boolean; modified?: number }> {
    return invoke('fs_stat', { path });
  }

  static async exists(path: string): Promise<boolean> {
    return invoke('fs_exists', { path });
  }

  static async mkdir(path: string): Promise<void> {
    return invoke('fs_mkdir', { path });
  }

  static async delete(path: string): Promise<void> {
    return invoke('fs_delete', { path });
  }

  // Agent
  static async agentInitialize(workspace: string, llmEndpoint: string, apiKey: string): Promise<void> {
    return invoke('agent_initialize', { workspace, llmEndpoint, apiKey });
  }

  static async agentExecute(message: string): Promise<void> {
    return invoke('agent_execute', { message });
  }

  static async agentCancel(): Promise<void> {
    return invoke('agent_cancel');
  }

  static async agentGetStatus(): Promise<{ is_running: boolean; workspace?: string; message_count: number }> {
    return invoke('agent_get_status');
  }

  // Dialogs
  static async selectDirectory(): Promise<string | null> {
    return invoke('dialog_select_directory');
  }

  static async selectFile(filters?: Array<[string, string[]]>): Promise<string | null> {
    return invoke('dialog_select_file', { filters });
  }

  // Events
  static onAgentPacket(callback: (packet: AgentPacket) => void): () => void {
    let unlisten: (() => void) | undefined;

    listen<AgentPacket>('agent:packet', (event) => {
      callback(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}
```

#### 3.2 Agent Context Provider (Updated)

```typescript
// web/src/app/agent/AgentContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { TauriAPI, isTauri, AgentPacket } from '@/lib/tauri';

interface AgentContextValue {
  isAvailable: boolean;
  isRunning: boolean;
  workspace: string | null;
  packets: AgentPacket[];
  selectWorkspace: () => Promise<void>;
  executeAgent: (message: string) => Promise<void>;
  cancelAgent: () => Promise<void>;
  clearPackets: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [packets, setPackets] = useState<AgentPacket[]>([]);

  useEffect(() => {
    setIsAvailable(isTauri());

    if (isTauri()) {
      // Subscribe to agent packets
      const unsubscribe = TauriAPI.onAgentPacket((packet) => {
        setPackets((prev) => [...prev, packet]);

        if (packet.type === 'complete' || packet.type === 'error') {
          setIsRunning(false);
        }
      });

      return unsubscribe;
    }
  }, []);

  const selectWorkspace = useCallback(async () => {
    if (!isTauri()) return;

    const selected = await TauriAPI.selectDirectory();
    if (selected) {
      setWorkspace(selected);

      // Initialize agent with workspace
      await TauriAPI.agentInitialize(
        selected,
        'https://api.openai.com/v1', // TODO: Make configurable
        process.env.NEXT_PUBLIC_OPENAI_API_KEY || ''
      );
    }
  }, []);

  const executeAgent = useCallback(async (message: string) => {
    if (!isTauri() || !workspace) return;

    setIsRunning(true);
    setPackets([]);

    try {
      await TauriAPI.agentExecute(message);
    } catch (error) {
      setPackets((prev) => [
        ...prev,
        { type: 'error', content: String(error) },
      ]);
      setIsRunning(false);
    }
  }, [workspace]);

  const cancelAgent = useCallback(async () => {
    if (!isTauri()) return;

    await TauriAPI.agentCancel();
    setIsRunning(false);
  }, []);

  const clearPackets = useCallback(() => {
    setPackets([]);
  }, []);

  return (
    <AgentContext.Provider
      value={{
        isAvailable,
        isRunning,
        workspace,
        packets,
        selectWorkspace,
        executeAgent,
        cancelAgent,
        clearPackets,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent must be used within AgentProvider');
  }
  return context;
}
```

#### 3.3 Agent Panel Component (Reuse from Electron plan)

The Agent Panel and File Browser components from the Electron plan (sections 4.3 and 4.4) can be reused with minimal changes, just replacing `window.electronAPI` with `TauriAPI`.

---

### Phase 4: Build Configuration

#### 4.1 Cargo.toml

```toml
# desktop/src-tauri/Cargo.toml
[package]
name = "bud-studio"
version = "1.0.0"
description = "Bud Studio - AI Assistant Desktop App with BudAgent"
authors = ["Bud"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = ["macos-private-api", "tray-icon", "shell-open", "global-shortcut"] }
tauri-plugin-shell = "2.0"
tauri-plugin-window-state = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.11", features = ["json"] }
dirs = "5.0"
async-trait = "0.1"
glob = "0.3"
uuid = { version = "1.0", features = ["v4"] }
open = "5.0"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

#### 4.2 Package.json

```json
// desktop/package.json
{
  "name": "bud-studio",
  "version": "1.0.0",
  "description": "Bud Studio - AI Assistant Desktop App with BudAgent",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "build:universal": "tauri build --target universal-apple-darwin",
    "build:linux": "tauri build --bundles deb,rpm,appimage",
    "build:windows": "tauri build --bundles msi,nsis"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.3"
  }
}
```

#### 4.3 Build Script

```bash
#!/bin/bash
# desktop/scripts/build.sh

set -e

echo "Building Bud Studio..."

# Step 1: Build Next.js frontend
echo "Building Next.js frontend..."
cd ../web
npm run build

# Step 2: Bundle Node.js binary (for Next.js server)
echo "Bundling Node.js binary..."
mkdir -p ../desktop/src-tauri/binaries
if [[ "$OSTYPE" == "darwin"* ]]; then
    cp "$(which node)" ../desktop/src-tauri/binaries/node
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    cp "$(which node)" ../desktop/src-tauri/binaries/node
fi

# Step 3: Build Tauri app
echo "Building Tauri app..."
cd ../desktop
npm run build

echo "Build complete! Check src-tauri/target/release/bundle/"
```

---

## Tests

### Unit Tests (Rust)

**Location**: `desktop/src-tauri/src/agent/tests/`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_filesystem_tool_read() {
        let tool = FileSystemTool::new("/tmp/test".to_string());

        // Create test file
        tokio::fs::write("/tmp/test/foo.txt", "hello").await.unwrap();

        let args = serde_json::json!({
            "action": "read",
            "path": "foo.txt"
        });

        let result = tool.execute(&args).await;
        assert!(result.success);
        assert_eq!(result.output.unwrap(), "hello");
    }

    #[tokio::test]
    async fn test_bash_tool_execution() {
        let tool = BashTool::new("/tmp".to_string());

        let args = serde_json::json!({
            "command": "echo hello"
        });

        let result = tool.execute(&args).await;
        assert!(result.success);
        assert_eq!(result.output.unwrap().trim(), "hello");
    }

    #[tokio::test]
    async fn test_bash_tool_blocks_dangerous_commands() {
        let tool = BashTool::new("/tmp".to_string());

        let args = serde_json::json!({
            "command": "rm -rf /"
        });

        let result = tool.execute(&args).await;
        assert!(!result.success);
        assert!(result.error.unwrap().contains("blocked"));
    }
}
```

### Integration Tests

Same as Electron plan, but use Tauri's testing utilities.

### Playwright Tests (E2E)

Same as Electron plan.

---

## Open Questions

1. **WebView Compatibility**: Does Next.js SSR work correctly in WebKit (macOS) and WebView2 (Windows)? Need to test thoroughly.

2. **Node.js Bundling**: Should we bundle Node.js binary or require system Node? Bundling increases size but ensures compatibility.

3. **Backend Connection**: Initial version connects to remote backend. Future: embed Python backend in Tauri?

4. **Auto-Updates**: Implement tauri-plugin-updater for automatic updates?

5. **MCP Integration**: Should we add MCP server support for extensibility?

---

## Dependencies

### Required

- Rust 1.70+
- Node.js 20+
- Tauri CLI 2.0+
- Next.js 15.5.2 (existing)
- TypeScript 5.3+

### Platform-Specific

- **macOS**: Xcode Command Line Tools
- **Windows**: WebView2 Runtime, Visual Studio Build Tools
- **Linux**: webkit2gtk, libayatana-appindicator

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebView compatibility issues | Medium | High | Test early on all platforms, fallback to remote mode |
| Node.js process management | Medium | Medium | Use robust spawning/monitoring, restart on crash |
| Bundle size with Node.js | High | Low | Optimize, use system Node option |
| Rust learning curve | Medium | Medium | Start with simple tools, iterate |
| Cross-platform testing | High | High | Set up CI for all platforms |

---

## Success Criteria

1. **Local Frontend**: Next.js server runs locally, embedded in Tauri app (not remote)
2. **Desktop Integration**: Full keyboard shortcuts, menu bar, tray icon, custom titlebar
3. **Configuration**: Backend URL configurable via settings UI
4. **Agent Works**: BudAgent can read/write files and execute commands in workspace
5. **Streaming**: Tool execution and responses stream in real-time to UI
6. **Cross-Platform**: Builds successfully for macOS, Windows, Linux
7. **Secure**: File access limited to workspace, dangerous commands blocked
8. **Lightweight**: App bundle < 50MB (excluding Node.js if bundled)

---

## Advantages of Tauri over Electron

1. **Bundle Size**: ~10MB vs ~150MB (87% smaller)
2. **Memory Usage**: 30-50% less RAM usage
3. **Security**: Better sandboxing model, Rust-based backend
4. **Performance**: Faster startup, lower resource usage
5. **Native Integration**: Better OS integration, smaller API surface

## Challenges

1. **WebView Differences**: Each platform uses different WebView (WebKit, Chromium, Edge)
2. **Node.js Integration**: More complex than Electron's built-in Node
3. **Ecosystem**: Smaller community, fewer plugins
4. **Debugging**: Rust debugging more complex than Node.js
