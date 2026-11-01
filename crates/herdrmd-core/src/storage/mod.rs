//! Revision-checked atomic publication with private recovery records.
use crate::{
    Result, platform,
    platform::UserDirectories,
    vault::{Vault, root_path},
};
use serde_json::json;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(crate) struct Creation {
    _lock: fs::File,
    recovery: PathBuf,
}

fn private_outside(path: &Path, vault: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err("creation state path must be absolute".into());
    }
    let ancestor = path
        .ancestors()
        .find(|p| p.exists())
        .ok_or("state parent missing")?;
    let resolved = root_path(ancestor)?.join(path.strip_prefix(ancestor)?);
    if resolved.starts_with(vault)
        || path
            .components()
            .any(|p| p == std::path::Component::ParentDir)
    {
        return Err("creation state must be outside the Vault".into());
    }
    platform::private_directory(&resolved)?;
    root_path(&resolved)
}

impl Creation {
    pub(crate) fn begin(vault: &Vault, directories: &UserDirectories) -> Result<Self> {
        if vault.id.len() != 64 || !vault.id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid Vault identifier".into());
        }
        let root = root_path(&vault.path)?;
        let state = private_outside(&directories.state.join("locks"), &root)?;
        let recovery = private_outside(&directories.data.join("recovery").join(&vault.id), &root)?;
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x00200000);
        }
        let lock = options.open(state.join(format!("{}.lock", vault.id)))?;
        let metadata = lock.metadata()?;
        if platform::is_link(&metadata) || !metadata.is_file() {
            return Err("invalid Vault creation lock".into());
        }
        lock.try_lock()
            .map_err(|_| "Vault is busy; retry the link")?;
        Ok(Self {
            _lock: lock,
            recovery,
        })
    }

    pub(crate) fn empty_note(&self, vault: &Vault, relative: &str) -> Result<bool> {
        let (parent, filename) = relative.rsplit_once('/').unwrap_or(("", relative));
        let mut prefix = String::new();
        for part in parent.split('/').filter(|p| !p.is_empty()) {
            let directory = vault.resolve(&prefix)?;
            match fs::create_dir(directory.join(part)) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(error) => return Err(error.into()),
            }
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if !vault.resolve(&prefix)?.is_dir() {
                return Err("note parent is not a directory".into());
            }
        }
        let directory = vault.resolve(parent)?;
        let destination = directory.join(filename);
        // Keep prepared records on failure too; an empty note has a known payload.
        let operation = tempfile::Builder::new()
            .prefix("create-")
            .tempdir_in(&self.recovery)?
            .keep();
        let record = json!({"operation":"create", "path":relative,
            "expected_revision":null, "new_revision":blake3::hash(b"").to_hex().to_string(), "bytes":0});
        let mut journal = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(operation.join("prepared.json"))?;
        journal.write_all(&serde_json::to_vec(&record)?)?;
        journal.sync_all()?;
        #[cfg(unix)]
        {
            fs::File::open(&operation)?.sync_all()?;
            fs::File::open(&self.recovery)?.sync_all()?;
        }
        let temporary = tempfile::Builder::new()
            .prefix(".herdrmd-create-")
            .tempfile_in(&directory)?;
        temporary.as_file().sync_all()?;
        if vault.resolve(parent)? != directory {
            return Err("note parent changed during creation".into());
        }
        let created = match temporary.persist_noclobber(&destination) {
            Ok(_) => true,
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => false,
            Err(error) => return Err(error.into()),
        };
        let verified = vault.resolve(relative)?;
        if verified != destination || !verified.is_file() {
            return Err("created note path changed".into());
        }
        #[cfg(unix)]
        fs::File::open(&directory)?.sync_all()?;
        let mut completed = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(operation.join("completed.json"))?;
        completed.write_all(&serde_json::to_vec(&json!({"created":created}))?)?;
        completed.sync_all()?;
        #[cfg(unix)]
        fs::File::open(&operation)?.sync_all()?;
        Ok(created)
    }
}

/// Replace a Markdown document after checking its byte revision. The lock coordinates
/// herdrmd writers only; external writers can still race the last revision check.
pub fn write(
    vault: &Vault,
    relative: &str,
    expected_revision: &str,
    text: &str,
    directories: &UserDirectories,
) -> Result<crate::document::Document> {
    use crate::document;
    let guard = Creation::begin(vault, directories)?;
    let current = document::read(vault, relative)?;
    if current.revision != expected_revision {
        return Err("revision conflict; reload the original before retrying".into());
    }
    if current.read_only || text.contains('\0') {
        return Err("document encoding or line endings are read-only".into());
    }
    let destination = vault.resolve(relative)?;
    let permissions = fs::metadata(&destination)?.permissions();
    if permissions.readonly() {
        return Err("document is read-only".into());
    }
    let directory = destination.parent().ok_or("document parent missing")?;
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let encoded = match current.line_endings {
        "crlf" => normalized.replace('\n', "\r\n"),
        "cr" => normalized.replace('\n', "\r"),
        _ => normalized,
    };
    let mut next = Vec::new();
    let mut previous = Vec::new();
    if current.bom {
        next.extend_from_slice(&[0xef, 0xbb, 0xbf]);
        previous.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    next.extend_from_slice(encoded.as_bytes());
    previous.extend_from_slice(
        current
            .text
            .as_ref()
            .ok_or("unsupported encoding")?
            .as_bytes(),
    );
    if next.len() as u64 > document::MAX_BYTES {
        return Err("document exceeds 1 MiB".into());
    }
    if previous == next {
        return Ok(current);
    }
    let operation = tempfile::Builder::new()
        .prefix("write-")
        .tempdir_in(&guard.recovery)?
        .keep();
    let mut backup = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(operation.join("original.bin"))?;
    backup.write_all(&previous)?;
    backup.sync_all()?;
    let mut candidate = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(operation.join("new.bin"))?;
    candidate.write_all(&next)?;
    candidate.sync_all()?;
    let record = json!({"operation":"write", "path":relative,
        "expected_revision":expected_revision,
        "new_revision":blake3::hash(&next).to_hex().to_string(),
        "bytes":next.len(), "backup":"original.bin", "candidate":"new.bin"});
    let mut journal = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(operation.join("prepared.json"))?;
    journal.write_all(&serde_json::to_vec(&record)?)?;
    journal.sync_all()?;
    #[cfg(unix)]
    {
        fs::File::open(&operation)?.sync_all()?;
        fs::File::open(&guard.recovery)?.sync_all()?;
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".herdrmd-write-")
        .tempfile_in(directory)?;
    temporary.write_all(&next)?;
    temporary.as_file().set_permissions(permissions)?;
    temporary.as_file().sync_all()?;
    if vault.resolve(relative)? != destination
        || document::read(vault, relative)?.revision != expected_revision
    {
        return Err("revision conflict; original changed during save".into());
    }
    // persist atomically replaces on supported platforms; never truncate the original.
    temporary.persist(&destination)?;
    #[cfg(unix)]
    fs::File::open(directory)?.sync_all()?;
    let mut completed = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(operation.join("completed.json"))?;
    completed.write_all(&serde_json::to_vec(&record)?)?;
    completed.sync_all()?;
    #[cfg(unix)]
    fs::File::open(&operation)?.sync_all()?;
    let saved = document::read(vault, relative)?;
    if saved.revision != blake3::hash(&next).to_hex().as_str() {
        return Err("revision conflict; document changed after save".into());
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Registry;
    #[test]
    fn publication_loses_to_an_external_creator_without_overwriting() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let files = root.join("vault");
        fs::create_dir(&files).unwrap();
        let vault = Registry::add(&root.join("config"), "demo", &files).unwrap();
        let dirs = UserDirectories {
            config: root.join("config"),
            data: root.join("data"),
            state: root.join("state"),
            cache: root.join("cache"),
        };
        let creation = Creation::begin(&vault, &dirs).unwrap();
        assert!(
            Creation::begin(&vault, &dirs).is_err(),
            "another herdrmd writer must not enter"
        );
        fs::write(files.join("existing.md"), "original").unwrap();
        let existing = crate::document::read(&vault, "existing.md").unwrap();
        assert!(write(&vault, "existing.md", &existing.revision, "changed", &dirs).is_err());
        assert_eq!(fs::read(files.join("existing.md")).unwrap(), b"original");
        // Simulate a non-cooperating writer after the resolver's absence check.
        let bytes = b"External writer\r\n";
        fs::write(files.join("new.md"), bytes).unwrap();
        assert!(!creation.empty_note(&vault, "new.md").unwrap());
        assert_eq!(fs::read(files.join("new.md")).unwrap(), bytes);
        #[cfg(unix)]
        {
            let outside = root.join("outside.md");
            fs::write(&outside, bytes).unwrap();
            std::os::unix::fs::symlink(&outside, files.join("trap.md")).unwrap();
            assert!(creation.empty_note(&vault, "trap.md").is_err());
            assert_eq!(fs::read(outside).unwrap(), bytes);
        }
    }
}
