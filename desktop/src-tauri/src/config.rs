use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub backend_url: String,
    pub window_title: String,
    pub next_port: u16,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            backend_url: String::from("http://localhost:8080"),
            window_title: String::from("Bud Studio"),
            next_port: 3030,
        }
    }
}

impl AppConfig {
    pub fn config_path() -> Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .context("Failed to get config directory")?
            .join("bud-studio");

        fs::create_dir_all(&config_dir)
            .context("Failed to create config directory")?;

        Ok(config_dir.join("config.json"))
    }

    pub fn load() -> Result<Self> {
        let config_path = Self::config_path()?;

        if !config_path.exists() {
            let default_config = Self::default();
            default_config.save()?;
            return Ok(default_config);
        }

        let config_str = fs::read_to_string(&config_path)
            .context("Failed to read config file")?;

        let config: AppConfig = serde_json::from_str(&config_str)
            .context("Failed to parse config file")?;

        Ok(config)
    }

    pub fn save(&self) -> Result<()> {
        let config_path = Self::config_path()?;
        let config_str = serde_json::to_string_pretty(self)
            .context("Failed to serialize config")?;

        fs::write(&config_path, config_str)
            .context("Failed to write config file")?;

        log::info!("Config saved to {:?}", config_path);
        Ok(())
    }

    pub fn update_backend_url(&mut self, url: String) -> Result<()> {
        self.backend_url = url;
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.backend_url, "http://localhost:8080");
        assert_eq!(config.window_title, "Bud Studio");
        assert_eq!(config.next_port, 3030);
    }

    #[test]
    fn test_config_serialization() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config.backend_url, deserialized.backend_url);
        assert_eq!(config.window_title, deserialized.window_title);
        assert_eq!(config.next_port, deserialized.next_port);
    }
}
