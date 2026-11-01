//! Shared domain and file operations for herdrmd.
//!
//! Vault reading, create-only notes and revision-checked saving. No CLI, HTTP, Herdr or Obsidian runtime dependency.

pub mod document;
pub mod markdown;
pub mod platform;
pub mod storage;
pub mod vault;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
