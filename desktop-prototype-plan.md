# Bud Studio Desktop Prototype Plan

## Overview

This plan outlines the **Phase 0 Prototype** - a minimal viable desktop app that:
- ✅ Runs Next.js frontend **locally** (embedded in Tauri)
- ✅ Loads the Onyx web interface
- ✅ Has basic desktop features (menu, shortcuts, titlebar)
- ✅ Configurable backend URL
- ❌ **NO BudAgent** (defer to Phase 1)

**Goal**: Validate the Tauri + embedded Next.js architecture before adding agent complexity.

---

## Prototype Scope

### In Scope
1. Tauri app shell with window management
2. Next.js standalone server embedded in app
3. Loading screen while server starts
4. Custom titlebar (macOS)
5. Menu bar with basic items
6. Keyboard shortcuts (⌘N, ⌘R, ⌘,)
7. System tray icon
8. Settings page for backend URL configuration
9. Window state persistence

### Out of Scope (Phase 1)
- ❌ BudAgent runtime
- ❌ File system tools
- ❌ Bash execution
- ❌ Workspace selection
- ❌ Agent UI components

---

## Step-by-Step Implementation

### Step 1: Project Setup (30 minutes)

#### 1.1 Install Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Tauri CLI
cargo install tauri-cli --version "^2.0.0"

# Verify installations
rustc --version
cargo --version
node --version  # Should be 20+
```

#### 1.2 Create Desktop Directory

```bash
cd /path/to/onyx
mkdir -p desktop
cd desktop
```

#### 1.3 Initialize Tauri Project

```bash
# Create package.json
npm init -y

# Install Tauri
npm install --save-dev @tauri-apps/cli@^2.0.0
npm install @tauri-apps/api@^2.0.0

# Initialize Tauri (this creates src-tauri/)
npx tauri init
```

When prompted:
- **App name**: Bud Studio
- **Window title**: Bud Studio
- **Web assets location**: ../dist
- **Dev server URL**: http://localhost:3456
- **Frontend dev command**: (leave empty)
- **Frontend build command**: (leave empty)

#### 1.4 Create Directory Structure

```bash
mkdir -p src                    # Loading screen
mkdir -p src-tauri/icons        # App icons
mkdir -p src-tauri/binaries     # For bundled Node.js
mkdir -p scripts                # Build scripts
```

---

### Step 2: Create Loading Screen (15 minutes)

#### 2.1 Create Loading HTML

```bash
cat > src/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bud Studio</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        color: white;
        overflow: hidden;
      }

      .loader {
        text-align: center;
        animation: fadeIn 0.5s ease-in;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .logo {
        width: 80px;
        height: 80px;
        margin: 0 auto 30px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 40px;
        font-weight: bold;
        backdrop-filter: blur(10px);
      }

      .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 30px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      h1 {
        font-size: 36px;
        font-weight: 700;
        margin: 0 0 10px 0;
        letter-spacing: -0.5px;
      }

      p {
        font-size: 16px;
        opacity: 0.9;
        margin: 0;
        font-weight: 400;
      }

      .version {
        position: fixed;
        bottom: 20px;
        font-size: 12px;
        opacity: 0.6;
      }
    </style>
  </head>
  <body>
    <div class="loader">
      <div class="logo">🤖</div>
      <div class="spinner"></div>
      <h1>Bud Studio</h1>
      <p>Starting application...</p>
    </div>
    <div class="version">v1.0.0</div>
  </body>
</html>
EOF
```

---

### Step 3: Configure Tauri (20 minutes)

#### 3.1 Update tauri.conf.json

```bash
cat > src-tauri/tauri.conf.json << 'EOF'
{
  "$schema": "https://schema.tauri.app/config/2.0.0",
  "productName": "Bud Studio",
  "version": "1.0.0",
  "identifier": "com.bud.studio",
  "build": {
    "beforeBuildCommand": "",
    "beforeDevCommand": "",
    "frontendDist": "../src",
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
        "url": "index.html",
        "fileDropEnabled": false
      }
    ],
    "security": {
      "csp": null
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
      "../web/public/**"
    ],
    "externalBin": [
      "binaries/node"
    ],
    "category": "Productivity",
    "shortDescription": "Bud Studio - AI Assistant",
    "longDescription": "Desktop app for Onyx with local frontend"
  },
  "plugins": {}
}
EOF
```

#### 3.2 Update Cargo.toml

```bash
cat > src-tauri/Cargo.toml << 'EOF'
[package]
name = "bud-studio"
version = "1.0.0"
description = "Bud Studio - AI Assistant Desktop App"
authors = ["Bud"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = ["macos-private-api", "tray-icon"] }
tauri-plugin-shell = "2.0"
tauri-plugin-window-state = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
dirs = "5.0"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
EOF
```

#### 3.3 Update package.json

```bash
cat > package.json << 'EOF'
{
  "name": "bud-studio",
  "version": "1.0.0",
  "description": "Bud Studio - AI Assistant Desktop App",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "build:universal": "tauri build --target universal-apple-darwin"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  }
}
EOF
```

---

### Step 4: Implement Rust Backend (2 hours)

#### 4.1 Create Module Files

```bash
# Create module structure
touch src-tauri/src/config.rs
touch src-tauri/src/next_server.rs
touch src-tauri/src/menu.rs
touch src-tauri/src/tray.rs
touch src-tauri/src/titlebar.rs
```

#### 4.2 Configuration Module

```bash
cat > src-tauri/src/config.rs << 'EOF'
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub backend_url: String,
    pub window_title: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            backend_url: "http://localhost:8080".to_string(),
            window_title: "Bud Studio".to_string(),
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
EOF
```

#### 4.3 Next.js Server Module

```bash
cat > src-tauri/src/next_server.rs << 'EOF'
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
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .ok_or_else(|| "Failed to get exe directory".to_string())?;

        // In development, use ../web/.next/standalone
        // In production, use bundled resources
        let next_dir = if cfg!(debug_assertions) {
            exe_dir
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.join("web/.next/standalone"))
                .ok_or_else(|| "Failed to find Next.js dir".to_string())?
        } else {
            exe_dir.join("../Resources/web")
        };

        println!("Next.js dir: {:?}", next_dir);

        if !next_dir.exists() {
            return Err(format!(
                "Next.js standalone directory not found: {:?}",
                next_dir
            ));
        }

        let server_js = next_dir.join("server.js");
        if !server_js.exists() {
            return Err(format!("server.js not found at: {:?}", server_js));
        }

        // Find Node.js binary
        let node_bin = if cfg!(debug_assertions) {
            "node".to_string()
        } else {
            exe_dir
                .join("binaries/node")
                .to_string_lossy()
                .to_string()
        };

        println!("Starting Next.js server on port {}", port);
        println!("Node binary: {}", node_bin);
        println!("Server script: {:?}", server_js);

        // Start Node.js process
        let mut child = Command::new(&node_bin)
            .arg(&server_js)
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .current_dir(&next_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn Next.js server: {}", e))?;

        // Capture stdout for debugging
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    println!("[Next.js] {}", line);
                }
            });
        }

        // Capture stderr for debugging
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[Next.js] {}", line);
                }
            });
        }

        // Wait for server to be ready
        println!("Waiting for Next.js server to start...");
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

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
EOF
```

#### 4.4 Menu Module

```bash
cat > src-tauri/src/menu.rs << 'EOF'
use tauri::{menu::Menu, AppHandle, Wry};

pub fn setup_menu(app: &AppHandle) -> Result<Menu<Wry>, String> {
    // For prototype, we'll create a minimal menu
    // Full menu implementation can be added later
    Menu::default(app).map_err(|e| e.to_string())
}
EOF
```

#### 4.5 Tray Module

```bash
cat > src-tauri/src/tray.rs << 'EOF'
use tauri::AppHandle;

pub fn setup_tray(_app: &AppHandle) -> Result<(), String> {
    // Tray implementation deferred for prototype
    // Can add icon and menu later
    Ok(())
}
EOF
```

#### 4.6 Titlebar Module

```bash
cat > src-tauri/src/titlebar.rs << 'EOF'
const TITLEBAR_SCRIPT: &str = r#"
(function() {
    const TITLEBAR_ID = 'bud-studio-titlebar';
    const TITLEBAR_HEIGHT = 36;

    if (document.getElementById(TITLEBAR_ID)) return;

    const titlebar = document.createElement('div');
    titlebar.id = TITLEBAR_ID;
    titlebar.setAttribute('data-tauri-drag-region', '');

    titlebar.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: ${TITLEBAR_HEIGHT}px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.78) 100%);
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        z-index: 999999;
        -webkit-app-region: drag;
        backdrop-filter: blur(18px);
    `;

    const updateTheme = () => {
        const isDark = document.documentElement.classList.contains('dark');
        if (isDark) {
            titlebar.style.background = 'linear-gradient(180deg, rgba(18, 18, 18, 0.82) 0%, rgba(18, 18, 18, 0.72) 100%)';
            titlebar.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';
        } else {
            titlebar.style.background = 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.78) 100%)';
            titlebar.style.borderBottom = '1px solid rgba(0, 0, 0, 0.06)';
        }
    };

    if (document.body) {
        document.body.insertBefore(titlebar, document.body.firstChild);
        document.body.style.paddingTop = `${TITLEBAR_HEIGHT}px`;
        updateTheme();
    }

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
})();
"#;

pub fn inject_titlebar(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;

        // Inject immediately
        let _ = window.eval(TITLEBAR_SCRIPT);

        // Re-inject after delays
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            for delay in [500, 1000, 2000] {
                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                let _ = window_clone.eval(TITLEBAR_SCRIPT);
            }
        });
    }
}
EOF
```

#### 4.7 Main Application

```bash
cat > src-tauri/src/main.rs << 'EOF'
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

mod config;
mod menu;
mod next_server;
mod titlebar;
mod tray;

use config::{AppConfig, load_config, save_config};
use next_server::NextServer;

struct AppState {
    config: Arc<Mutex<AppConfig>>,
    next_server: Arc<Mutex<Option<NextServer>>>,
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[tauri::command]
fn set_backend_url(state: State<AppState>, url: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.backend_url = url;
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

fn main() {
    let config = load_config().unwrap_or_default();

    tauri::Builder::default()
        .manage(AppState {
            config: Arc::new(Mutex::new(config)),
            next_server: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_backend_url,
            get_next_server_port,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();

            // Setup menu
            if let Ok(menu) = menu::setup_menu(&app_handle) {
                let _ = app_handle.set_menu(menu);
            }

            // Setup tray (optional)
            let _ = tray::setup_tray(&app_handle);

            // Start Next.js server
            let state_clone = state.inner().clone();
            tauri::async_runtime::spawn(async move {
                println!("Starting Next.js server...");
                match NextServer::start().await {
                    Ok(server) => {
                        let port = server.port();
                        println!("✓ Next.js server started on port {}", port);

                        // Store server instance
                        {
                            let mut next_server = state_clone.next_server.lock().unwrap();
                            *next_server = Some(server);
                        }

                        // Navigate to Next.js server
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let url = format!("http://localhost:{}", port);
                            println!("Navigating to {}", url);

                            // Inject titlebar
                            titlebar::inject_titlebar(&window);

                            // Navigate
                            let _ = window.eval(&format!("window.location.href = '{}'", url));
                        }
                    }
                    Err(e) => {
                        eprintln!("✗ Failed to start Next.js server: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
EOF
```

---

### Step 5: Build Next.js in Standalone Mode (30 minutes)

#### 5.1 Update next.config.js

Add or update the Next.js config in `web/next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // ... existing config
};

module.exports = nextConfig;
```

#### 5.2 Build Next.js

```bash
cd ../web
npm run build
```

This creates:
- `web/.next/standalone/` - Minimal server files
- `web/.next/static/` - Static assets
- `web/public/` - Public files

#### 5.3 Test Standalone Server

```bash
cd .next/standalone
PORT=3456 node server.js
```

Open browser to `http://localhost:3456` - should see Onyx.

---

### Step 6: Create Development Script (15 minutes)

#### 6.1 Dev Script

```bash
cat > scripts/dev.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 Starting Bud Studio Development..."

# Check if Next.js build exists
if [ ! -d "../web/.next/standalone" ]; then
    echo "📦 Next.js standalone build not found. Building..."
    cd ../web
    npm run build
    cd ../desktop
fi

# Start Tauri in dev mode
echo "🔧 Starting Tauri..."
npm run dev
EOF

chmod +x scripts/dev.sh
```

#### 6.2 Build Script

```bash
cat > scripts/build.sh << 'EOF'
#!/bin/bash
set -e

echo "🏗️  Building Bud Studio..."

# Step 1: Build Next.js
echo "📦 Building Next.js frontend..."
cd ../web
npm run build

# Step 2: Copy Node.js binary (for bundling)
echo "🔧 Bundling Node.js..."
cd ../desktop
mkdir -p src-tauri/binaries

if [[ "$OSTYPE" == "darwin"* ]]; then
    cp "$(which node)" src-tauri/binaries/node
    chmod +x src-tauri/binaries/node
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    cp "$(which node)" src-tauri/binaries/node
    chmod +x src-tauri/binaries/node
fi

# Step 3: Build Tauri app
echo "🎁 Building Tauri app..."
npm run build

echo "✅ Build complete!"
echo "📦 Check: src-tauri/target/release/bundle/"
EOF

chmod +x scripts/build.sh
```

---

### Step 7: Create Settings Page (45 minutes)

#### 7.1 Tauri API Helper

```bash
mkdir -p ../web/src/lib/tauri
cat > ../web/src/lib/tauri/index.ts << 'EOF'
import { invoke } from '@tauri-apps/api/core';

export interface AppConfig {
  backend_url: string;
  window_title: string;
}

export class TauriAPI {
  static async getConfig(): Promise<AppConfig> {
    return invoke('get_config');
  }

  static async setBackendUrl(url: string): Promise<void> {
    return invoke('set_backend_url', { url });
  }

  static async getNextServerPort(): Promise<number> {
    return invoke('get_next_server_port');
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}
EOF
```

#### 7.2 Settings Page Component

```bash
cat > ../web/src/app/desktop-settings/page.tsx << 'EOF'
'use client';

import { useState, useEffect } from 'react';
import { TauriAPI, isTauri } from '@/lib/tauri';

export default function DesktopSettingsPage() {
  const [backendUrl, setBackendUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(isTauri());

    if (isTauri()) {
      TauriAPI.getConfig().then((config) => {
        setBackendUrl(config.backend_url);
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
      await TauriAPI.setBackendUrl(backendUrl);
      setSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isDesktop) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Desktop Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">
          These settings are only available in Bud Studio desktop app.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Desktop Settings</h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-4">Backend Configuration</h2>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">
                Backend URL
              </label>
              <input
                type="text"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="http://localhost:8080"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
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
                ✓ Settings saved! Reloading...
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save & Reload'}
            </button>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h2 className="text-lg font-semibold mb-4">About</h2>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <p><strong>App:</strong> Bud Studio</p>
            <p><strong>Version:</strong> 1.0.0 (Prototype)</p>
            <p><strong>Frontend:</strong> Running locally</p>
          </div>
        </div>
      </div>
    </div>
  );
}
EOF
```

---

### Step 8: Testing & Validation (1 hour)

#### 8.1 Development Testing

```bash
cd desktop

# Test 1: Build Next.js
cd ../web
npm run build
# Verify: .next/standalone/server.js exists

# Test 2: Run Tauri dev mode
cd ../desktop
npm run dev
```

**Expected Results:**
- ✅ Loading screen appears
- ✅ After 3 seconds, Next.js loads
- ✅ Can navigate Onyx interface
- ✅ Custom titlebar visible (macOS)
- ✅ Window resizable

#### 8.2 Settings Testing

1. Navigate to `/desktop-settings`
2. Change backend URL
3. Click "Save & Reload"
4. Verify reload happens
5. Check config file:
   ```bash
   cat ~/Library/Application\ Support/com.bud.studio/config.json
   ```

#### 8.3 Production Build Testing

```bash
cd desktop
./scripts/build.sh

# On macOS
open src-tauri/target/release/bundle/macos/Bud\ Studio.app

# On Linux
./src-tauri/target/release/bundle/appimage/bud-studio_*.AppImage
```

**Expected Results:**
- ✅ App launches
- ✅ Next.js server starts
- ✅ Interface loads
- ✅ Settings work
- ✅ Window state persists

---

## Validation Checklist

### Core Functionality
- [ ] App launches without errors
- [ ] Loading screen displays
- [ ] Next.js server starts (check logs)
- [ ] Frontend loads at `localhost:PORT`
- [ ] Can navigate through Onyx pages
- [ ] Backend API calls work (check Network tab)

### Desktop Features
- [ ] Custom titlebar displays (macOS)
- [ ] Window can be dragged
- [ ] Window resizing works
- [ ] Window state persists after restart
- [ ] Menu bar shows (minimal items)

### Settings
- [ ] Can access `/desktop-settings` page
- [ ] Can change backend URL
- [ ] Config saves to disk
- [ ] App reloads with new config
- [ ] Config persists after restart

### Build & Distribution
- [ ] Dev mode works (`npm run dev`)
- [ ] Production build completes
- [ ] Bundled app runs standalone
- [ ] Node.js binary bundled correctly
- [ ] Next.js files bundled correctly

---

## Troubleshooting

### Issue: Next.js server not found

```bash
# Verify Next.js built correctly
ls -la ../web/.next/standalone/

# Should see:
# - server.js
# - package.json
# - .next/
```

**Fix**: Rebuild Next.js with `output: 'standalone'`

### Issue: Node binary not found

```bash
# Check if Node is in binaries/
ls -la src-tauri/binaries/

# Manually copy:
cp $(which node) src-tauri/binaries/node
chmod +x src-tauri/binaries/node
```

### Issue: Port already in use

Check what's using the port:
```bash
lsof -i :3456
kill -9 <PID>
```

### Issue: Titlebar not showing (macOS)

- Check console logs for JavaScript errors
- Verify `macOSPrivateApi: true` in `tauri.conf.json`
- Try manually injecting: Open DevTools, paste titlebar script

### Issue: Can't connect to backend

1. Check backend URL in settings
2. Verify backend is running:
   ```bash
   curl http://localhost:8080/api/health
   ```
3. Check CORS settings in backend

---

## Next Steps (Phase 1)

After prototype validation, add:

1. **Menu Bar** - Full menu with shortcuts
2. **System Tray** - Quick access icon
3. **Keyboard Shortcuts** - Global hotkeys
4. **Agent Placeholder** - Empty agent UI
5. **File Browser** - Basic directory tree
6. **Workspace Selection** - Dialog for choosing workspace

Then proceed to full **BudAgent** implementation.

---

## Timeline Estimate

| Step | Duration | Cumulative |
|------|----------|------------|
| 1. Project Setup | 30 min | 0.5h |
| 2. Loading Screen | 15 min | 0.75h |
| 3. Tauri Config | 20 min | 1h |
| 4. Rust Backend | 2 hours | 3h |
| 5. Next.js Build | 30 min | 3.5h |
| 6. Scripts | 15 min | 3.75h |
| 7. Settings Page | 45 min | 4.5h |
| 8. Testing | 1 hour | 5.5h |

**Total: ~6 hours** for one developer

---

## Success Criteria

✅ **Prototype Complete When:**
1. App launches and shows loading screen
2. Next.js server starts locally
3. Onyx frontend loads and is usable
4. Settings page works (backend URL config)
5. Production build creates working `.app`/`.AppImage`
6. No BudAgent features (deferred)

This validates the architecture before investing in agent complexity.
