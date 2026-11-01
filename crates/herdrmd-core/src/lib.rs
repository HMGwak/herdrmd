//! Shared domain and file operations for herdrmd.
//!
//! Read-only Vault access. No CLI, HTTP, Herdr or Obsidian runtime dependency.

pub mod document;
pub mod platform;
pub mod vault;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
