use anyhow::{Context, Result};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

pub struct NextServer {
    process: Arc<Mutex<Option<Child>>>,
    port: u16,
    base_path: String,
}

impl NextServer {
    pub fn new(port: u16) -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            port,
            base_path: String::new(),
        }
    }

    /// Check if a port is available
    fn is_port_available(port: u16) -> bool {
        TcpListener::bind(("127.0.0.1", port)).is_ok()
    }

    /// Find an available port starting from the preferred port
    fn find_available_port(preferred: u16) -> u16 {
        // Try the preferred port first
        if Self::is_port_available(preferred) {
            return preferred;
        }

        log::warn!("Port {} is in use, searching for available port...", preferred);

        // Try ports in range preferred+1 to preferred+100
        for offset in 1..=100 {
            let port = preferred + offset;
            if Self::is_port_available(port) {
                log::info!("Found available port: {}", port);
                return port;
            }
        }

        // Fallback: let the OS assign a port (bind to 0)
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) {
            if let Ok(addr) = listener.local_addr() {
                log::info!("OS assigned port: {}", addr.port());
                return addr.port();
            }
        }

        // Last resort, return preferred and let it fail later with a clear error
        preferred
    }

    pub async fn start(&mut self, standalone_path: String) -> Result<String> {
        // Find an available port
        self.port = Self::find_available_port(self.port);
        log::info!("Starting Next.js server on port {}", self.port);
        self.base_path = standalone_path.clone();

        let server_js = format!("{}/server.js", standalone_path);

        // Check if server.js exists
        if !std::path::Path::new(&server_js).exists() {
            return Err(anyhow::anyhow!(
                "Next.js standalone server not found at {}. Please build the Next.js app first.",
                server_js
            ));
        }

        // Start the Node.js process
        let child = Command::new("node")
            .arg(&server_js)
            .env("PORT", self.port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("INTERNAL_URL", "https://chat.pnap.bud.studio/api")
            .env("OVERRIDE_API_PRODUCTION", "true")
            .current_dir(&standalone_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to start Next.js server")?;

        log::info!("Next.js process started with PID: {:?}", child.id());

        // Store the process
        {
            let mut process = self.process.lock().unwrap();
            *process = Some(child);
        }

        // Wait for server to be ready
        self.wait_for_ready().await?;

        let url = format!("http://127.0.0.1:{}", self.port);
        log::info!("Next.js server ready at {}", url);
        Ok(url)
    }

    async fn wait_for_ready(&self) -> Result<()> {
        let url = format!("http://127.0.0.1:{}", self.port);
        let client = reqwest::Client::new();
        let max_attempts = 30;

        for attempt in 1..=max_attempts {
            match client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    log::info!("Next.js server is ready (attempt {})", attempt);
                    return Ok(());
                }
                Ok(response) => {
                    log::debug!("Server responded with status: {} (attempt {})", response.status(), attempt);
                }
                Err(e) => {
                    log::debug!("Waiting for server... (attempt {}/{}): {}", attempt, max_attempts, e);
                }
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

        if let Some(mut child) = process.take() {
            child.kill().context("Failed to kill Next.js process")?;
            log::info!("Next.js server stopped");
        } else {
            log::warn!("No Next.js process to stop");
        }

        Ok(())
    }

    pub fn is_running(&self) -> bool {
        let process = self.process.lock().unwrap();
        process.is_some()
    }

    pub fn get_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
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
        assert_eq!(server.port, 3030);
        assert_eq!(server.get_url(), "http://127.0.0.1:3030");
        assert!(!server.is_running());
    }

    #[test]
    fn test_url_generation() {
        let server = NextServer::new(4000);
        assert_eq!(server.get_url(), "http://127.0.0.1:4000");
    }
}
