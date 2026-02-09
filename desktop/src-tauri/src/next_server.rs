use anyhow::{Context, Result};
use command_group::{CommandGroup, GroupChild};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

/// Find the node executable path
/// When launched from Finder, PATH doesn't include common node locations
fn find_node_executable() -> String {
    // Common node installation paths on macOS
    let common_paths = [
        "/usr/local/bin/node",           // Homebrew Intel
        "/opt/homebrew/bin/node",        // Homebrew Apple Silicon
        "/usr/bin/node",                 // System
        // nvm paths - check common locations
        &format!("{}/.nvm/versions/node", std::env::var("HOME").unwrap_or_default()),
    ];

    // First try the simple locations
    for path in &common_paths[..3] {
        if Path::new(path).exists() {
            log::info!("Found node at: {}", path);
            return path.to_string();
        }
    }

    // Check for nvm - find the default or latest version
    if let Ok(home) = std::env::var("HOME") {
        let nvm_dir = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();

            // Sort by version (newest first)
            versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

            if let Some(latest) = versions.first() {
                let node_path = latest.path().join("bin/node");
                if node_path.exists() {
                    let path_str = node_path.to_string_lossy().to_string();
                    log::info!("Found node via nvm at: {}", path_str);
                    return path_str;
                }
            }
        }
    }

    // Fallback to just "node" and hope PATH works
    log::warn!("Could not find node executable, falling back to 'node'");
    "node".to_string()
}

pub struct NextServer {
    process: Arc<Mutex<Option<GroupChild>>>,
    port: Arc<Mutex<Option<u16>>>,
    preferred_port: u16,
    base_path: String,
}

impl NextServer {
    pub fn new(preferred_port: u16) -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(None)),
            preferred_port,
            base_path: String::new(),
        }
    }

    pub async fn start(&mut self, standalone_path: String, backend_url: String) -> Result<String> {
        log::info!("Starting Next.js server (preferred port: {}, backend: {})", self.preferred_port, backend_url);
        self.base_path = standalone_path.clone();

        // Kill any existing process on our preferred port to avoid stale servers
        Self::kill_process_on_port(self.preferred_port);

        // In debug mode, use Next.js dev server for hot reload
        // In release mode, use the standalone build
        let mut group_child = if cfg!(debug_assertions) {
            // Development mode: run `npm run dev` in the web directory
            let web_dir = std::path::Path::new(&standalone_path)
                .parent() // .next
                .and_then(|p| p.parent()) // web
                .ok_or_else(|| anyhow::anyhow!("Could not determine web directory"))?;

            log::info!("Starting Next.js dev server in {:?}", web_dir);

            // Let Next.js auto-select port if preferred is busy
            // Construct the internal API URL from backend_url
            let internal_url = format!("{}/api", backend_url.trim_end_matches('/'));

            Command::new("npm")
                .args(["run", "dev", "--", "--port", &self.preferred_port.to_string()])
                .env("INTERNAL_URL", &internal_url)
                .current_dir(web_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .group_spawn()
                .context("Failed to start Next.js dev server")?
        } else {
            // Production mode: use standalone build
            // Next.js standalone preserves the absolute path structure, so we need to find server.js
            let (server_js, server_dir) = Self::find_server_js(&standalone_path)?;

            log::info!("Found server.js at: {}", server_js);
            log::info!("Server working directory: {}", server_dir);

            let node_path = find_node_executable();
            // Construct the internal API URL from backend_url
            let internal_url = format!("{}/api", backend_url.trim_end_matches('/'));

            Command::new(&node_path)
                .arg(&server_js)
                .env("PORT", self.preferred_port.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .env("INTERNAL_URL", &internal_url)
                .current_dir(&server_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .group_spawn()
                .context(format!("Failed to start Next.js server with node at: {}", node_path))?
        };

        log::info!("Next.js process group started with PID: {:?}", group_child.id());

        // Parse stdout to detect the actual port Next.js is using
        let stdout = group_child.inner().stdout.take();
        let port_arc = self.port.clone();
        let preferred = self.preferred_port;

        if let Some(stdout) = stdout {
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        log::info!("[Next.js] {}", line);
                        // Look for port in output like "- Local: http://localhost:3030"
                        // or "ready started server on 0.0.0.0:3030"
                        if let Some(port) = Self::extract_port_from_line(&line) {
                            let mut port_guard = port_arc.lock().unwrap();
                            if port_guard.is_none() {
                                log::info!("Detected Next.js running on port {}", port);
                                *port_guard = Some(port);
                            }
                        }
                    }
                }
            });
        }

        // Store the process group
        {
            let mut process = self.process.lock().unwrap();
            *process = Some(group_child);
        }

        // Wait for server to be ready and detect port
        let actual_port = self.wait_for_ready_and_detect_port(preferred).await?;

        // Update port
        {
            let mut port_guard = self.port.lock().unwrap();
            *port_guard = Some(actual_port);
        }

        let url = format!("http://127.0.0.1:{}", actual_port);
        log::info!("Next.js server ready at {}", url);
        Ok(url)
    }

    fn extract_port_from_line(line: &str) -> Option<u16> {
        // Match patterns like:
        // "- Local: http://localhost:3030"
        // "ready started server on 0.0.0.0:3030"
        // "http://127.0.0.1:3030"
        let patterns = [
            r"localhost:(\d+)",
            r"127\.0\.0\.1:(\d+)",
            r"0\.0\.0\.0:(\d+)",
            r":(\d{4,5})\b",
        ];

        for pattern in patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(line) {
                    if let Some(port_str) = caps.get(1) {
                        if let Ok(port) = port_str.as_str().parse::<u16>() {
                            if port >= 3000 {
                                return Some(port);
                            }
                        }
                    }
                }
            }
        }
        None
    }

    fn is_port_in_use(port: u16) -> bool {
        use std::net::TcpListener;
        TcpListener::bind(("127.0.0.1", port)).is_err()
    }

    /// Kill any process listening on the specified port (macOS/Linux only) - static version for fallback
    pub fn kill_process_on_port_static(port: u16) {
        Self::kill_process_on_port(port);
    }

    /// Kill any process listening on the specified port (macOS/Linux only)
    fn kill_process_on_port(port: u16) {
        if !Self::is_port_in_use(port) {
            return;
        }

        log::info!("Killing existing process on port {}", port);

        // Use lsof to find the PID and kill it
        #[cfg(unix)]
        {
            // Get PID using lsof
            if let Ok(output) = Command::new("lsof")
                .args(["-ti", &format!(":{}", port)])
                .output()
            {
                let pids = String::from_utf8_lossy(&output.stdout);
                for pid in pids.lines() {
                    if let Ok(pid_num) = pid.trim().parse::<i32>() {
                        log::info!("Killing process {} on port {}", pid_num, port);
                        let _ = Command::new("kill")
                            .args(["-9", &pid_num.to_string()])
                            .output();
                    }
                }
            }

            // Give it a moment to release the port
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }

    /// Find server.js in the standalone directory.
    /// Next.js standalone build preserves absolute paths, so server.js might be nested.
    fn find_server_js(standalone_path: &str) -> Result<(String, String)> {
        use std::path::Path;

        // First, try direct path (development case)
        let direct_path = format!("{}/server.js", standalone_path);
        if Path::new(&direct_path).exists() {
            return Ok((direct_path, standalone_path.to_string()));
        }

        // Search for server.js in subdirectories (production case with nested paths)
        fn find_recursively(dir: &Path, depth: usize) -> Option<std::path::PathBuf> {
            if depth > 10 {
                return None; // Prevent infinite recursion
            }

            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if path.is_file() && path.file_name().map(|n| n == "server.js").unwrap_or(false) {
                        // Make sure it's the right server.js (should be at root of a Next.js project)
                        // by checking for sibling .next directory
                        if let Some(parent) = path.parent() {
                            if parent.join(".next").exists() {
                                return Some(path);
                            }
                        }
                    } else if path.is_dir() {
                        if let Some(found) = find_recursively(&path, depth + 1) {
                            return Some(found);
                        }
                    }
                }
            }
            None
        }

        let standalone_dir = Path::new(standalone_path);
        if let Some(server_js_path) = find_recursively(standalone_dir, 0) {
            let server_js = server_js_path.to_string_lossy().to_string();
            let server_dir = server_js_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| standalone_path.to_string());
            return Ok((server_js, server_dir));
        }

        Err(anyhow::anyhow!(
            "Next.js standalone server not found in {}. Please build the Next.js app first.",
            standalone_path
        ))
    }

    async fn wait_for_ready_and_detect_port(&self, preferred_port: u16) -> Result<u16> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
        let max_attempts = 240; // 120 seconds - Next.js can take a while to compile

        // Ports to try: preferred, then check if port was detected from stdout
        for attempt in 1..=max_attempts {
            // First check if we detected a port from stdout
            let detected_port = {
                let port_guard = self.port.lock().unwrap();
                *port_guard
            };

            let ports_to_try: Vec<u16> = if let Some(p) = detected_port {
                vec![p]
            } else {
                // Try preferred port and a few alternatives
                vec![preferred_port, preferred_port + 1, preferred_port + 2]
            };

            for port in ports_to_try {
                let url = format!("http://127.0.0.1:{}", port);
                match client.get(&url).send().await {
                    Ok(response) if response.status().is_success() || response.status().is_redirection() => {
                        log::info!("Next.js server is ready on port {} (attempt {})", port, attempt);
                        return Ok(port);
                    }
                    Ok(_) => {}
                    Err(_) => {}
                }
            }

            if attempt % 10 == 0 {
                log::info!("Still waiting for Next.js server... (attempt {}/{})", attempt, max_attempts);
            }

            sleep(Duration::from_millis(500)).await;
        }

        Err(anyhow::anyhow!(
            "Next.js server failed to start after {} seconds",
            max_attempts / 2
        ))
    }

    pub fn stop(&self) -> Result<()> {
        log::info!("Stopping Next.js server");

        let mut process = self.process.lock().unwrap();
        let port = {
            let port_guard = self.port.lock().unwrap();
            port_guard.unwrap_or(self.preferred_port)
        };

        if let Some(mut group_child) = process.take() {
            // Kill the entire process group (this kills all child processes too)
            log::info!("Killing Next.js process group");
            if let Err(e) = group_child.kill() {
                log::warn!("Failed to kill process group: {}", e);
            }

            // Wait for the process group to terminate
            match group_child.wait() {
                Ok(status) => log::info!("Process group exited with status: {:?}", status),
                Err(e) => log::warn!("Failed to wait for process group: {}", e),
            }

            // Also kill any process on the port (in case of orphaned processes)
            Self::kill_process_on_port(port);

            log::info!("Next.js server stopped");
        } else {
            log::warn!("No Next.js process to stop, checking port...");
            // Still try to kill any orphaned process on the port
            Self::kill_process_on_port(port);
        }

        Ok(())
    }

    pub fn is_running(&self) -> bool {
        let process = self.process.lock().unwrap();
        process.is_some()
    }

    pub fn get_url(&self) -> String {
        let port = self.port.lock().unwrap();
        let actual_port = port.unwrap_or(self.preferred_port);
        format!("http://127.0.0.1:{}", actual_port)
    }
}

impl Drop for NextServer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_next_server_creation() {
        let server = NextServer::new(3030);
        assert_eq!(server.preferred_port, 3030);
        assert_eq!(server.get_url(), "http://127.0.0.1:3030");
        assert!(!server.is_running());
    }

    #[test]
    fn test_url_generation() {
        let server = NextServer::new(4000);
        assert_eq!(server.get_url(), "http://127.0.0.1:4000");
    }

    #[test]
    fn test_port_extraction() {
        assert_eq!(NextServer::extract_port_from_line("- Local: http://localhost:3030"), Some(3030));
        assert_eq!(NextServer::extract_port_from_line("http://127.0.0.1:3031"), Some(3031));
        assert_eq!(NextServer::extract_port_from_line("ready started server on 0.0.0.0:3032"), Some(3032));
        assert_eq!(NextServer::extract_port_from_line("no port here"), None);
    }
}
