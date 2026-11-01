use crate::{Result, platform};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Registry {
    pub vaults: Vec<Vault>,
}

impl Registry {
    pub fn load(config: &Path) -> Result<Self> {
        let path = config.join("registry.json");
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
            Ok(meta) if platform::is_link(&meta) || !meta.is_file() || meta.len() > 1024 * 1024 => {
                Err("invalid registry file".into())
            }
            Ok(_) => Ok(serde_json::from_slice(&fs::read(path)?)?),
        }
    }

    pub fn get(&self, name: &str) -> Result<&Vault> {
        self.vaults
            .iter()
            .find(|v| v.name == name || v.id == name)
            .ok_or_else(|| "registered Vault not found".into())
    }

    pub fn add(config: &Path, name: &str, path: &Path) -> Result<Vault> {
        if name.is_empty()
            || name.len() > 80
            || !name
                .chars()
                .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            return Err("invalid Vault name".into());
        }
        let path = root_path(path)?;
        if !config.is_absolute() || config.components().any(|c| c == Component::ParentDir) {
            return Err("configuration path must be absolute without parent traversal".into());
        }
        // Normalize the existing prefix before creating anything: registry state
        // must never be created inside the Vault, including Windows verbatim paths.
        let ancestor = config
            .ancestors()
            .find(|p| p.exists())
            .ok_or("configuration parent missing")?;
        reject_links(ancestor)?;
        let config = ancestor
            .canonicalize()?
            .join(config.strip_prefix(ancestor)?);
        if config.starts_with(&path) {
            return Err("configuration must be outside the Vault".into());
        }
        platform::private_directory(&config)?;
        let lock_path = config.join("registry.lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|meta| platform::is_link(&meta)) {
            return Err("registry lock cannot be a link".into());
        }
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(lock_path)?;
        lock.try_lock().map_err(|_| "registry is busy; retry")?;
        let mut registry = Self::load(&config)?;
        if let Some(existing) = registry.vaults.iter().find(|v| v.path == path) {
            return Ok(existing.clone());
        }
        if registry.vaults.iter().any(|v| v.name == name) {
            return Err("Vault name already registered to another directory".into());
        }
        let path_text = path.to_str().ok_or("Vault path must be Unicode")?;
        #[cfg(windows)]
        let path_text = path_text.to_lowercase();
        let vault = Vault {
            id: blake3::hash(path_text.as_bytes()).to_hex().to_string(),
            name: name.to_owned(),
            path,
        };
        registry.vaults.push(vault.clone());
        let mut temporary = tempfile::NamedTempFile::new_in(&config)?;
        temporary.write_all(&serde_json::to_vec_pretty(&registry)?)?;
        temporary.as_file().sync_all()?;
        temporary.persist(config.join("registry.json"))?;
        Ok(vault)
    }
}

pub fn root_path(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err("Vault path must be absolute".into());
    }
    reject_links(path)?;
    if !fs::metadata(path)?.is_dir() {
        return Err("Vault must be a directory".into());
    }
    Ok(path.canonicalize()?)
}

fn reject_links(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("parent traversal is not allowed".into());
        }
        current.push(component);
        if matches!(component, Component::Prefix(_) | Component::RootDir) {
            continue;
        }
        if platform::is_link(&fs::symlink_metadata(&current)?) {
            return Err("symbolic links and reparse points are not supported".into());
        }
    }
    Ok(())
}

pub fn excluded(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".obsidian" | ".git" | ".trash" | ".herdrmd"
    ) || name.to_ascii_lowercase().starts_with(".herdrmd-")
}

impl Vault {
    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        if relative.contains(['\\', ':', '\0'])
            || relative.starts_with('/')
            || relative
                .split('/')
                .any(|p| p == ".." || p == "." || excluded(p))
        {
            return Err("invalid or excluded Vault-relative path".into());
        }
        let root = root_path(&self.path)?;
        let candidate = root.join(relative);
        reject_links(&candidate)?;
        let resolved = candidate.canonicalize()?;
        if !resolved.starts_with(&root) {
            return Err("path escapes Vault".into());
        }
        Ok(resolved)
    }

    pub fn list(&self, relative: &str) -> Result<Listing> {
        let directory = self.resolve(relative)?;
        let mut entries = Vec::new();
        let mut truncated = false;
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if excluded(&name) || name.contains(['\\', ':']) {
                continue;
            }
            let meta = fs::symlink_metadata(entry.path())?;
            if platform::is_link(&meta) {
                continue;
            }
            let directory = meta.is_dir();
            if !directory && (!meta.is_file() || !is_markdown(&entry.path())) {
                continue;
            }
            if entries.len() == 1000 {
                truncated = true;
                break;
            }
            entries.push(Entry {
                path: if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{relative}/{name}")
                },
                name,
                directory,
            });
        }
        entries.sort_by(|a, b| {
            b.directory
                .cmp(&a.directory)
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(Listing { entries, truncated })
    }
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|x| x.to_str())
        .is_some_and(|x| x.eq_ignore_ascii_case("md"))
}

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub directory: bool,
}
#[derive(Serialize)]
pub struct Listing {
    pub entries: Vec<Entry>,
    pub truncated: bool,
}
