use crate::service::Result;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};

// Run only at the start of the standalone `serve` process, before opening state
// or creating a runtime. Besides stdio, launchers can carry non-CLOEXEC pipes
// from a concurrently spawned sibling. Holding those prevents its EOF forever.
pub fn close_inherited_descriptors() -> Result<()> {
    #[cfg(unix)]
    {
        let descriptors: Vec<i32> = fs::read_dir("/dev/fd")?
            .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse().ok())
            .filter(|fd| *fd > 2)
            .collect();
        // read_dir and its directory handle have been dropped at this point.
        for fd in descriptors {
            // SAFETY: this is a new, single-threaded serve process. No owned
            // Rust files/runtime exist yet. Standard streams remain open.
            unsafe { libc::close(fd) };
        }
    }
    Ok(())
}

// Task 00 accepts an explicit scratch location. OS user-directory policy belongs to 01.
pub fn prepare_directory(directory: &Path) -> Result<()> {
    fs::create_dir_all(directory)?;
    if fs::symlink_metadata(directory)?.file_type().is_symlink() {
        return Err("state directory must not be a symlink".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn private_file(path: &Path, create_new: bool) -> Result<File> {
    if path.symlink_metadata().is_ok_and(|m| m.is_symlink()) {
        return Err("state file must not be a symlink".into());
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true).truncate(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

pub fn publish_connection(directory: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = directory.join(format!(".service-{}.tmp", std::process::id()));
    let result = (|| -> Result<()> {
        let mut file = private_file(&temporary, true)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // The server holds the instance lock. Windows cannot rename over the old file.
        let connection = directory.join("service.json");
        match fs::remove_file(&connection) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.into()),
        }
        fs::rename(&temporary, connection)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn spawn_service(directory: &Path) -> Result<Child> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("serve")
        .arg("--state-dir")
        .arg(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    Ok(command.spawn()?)
}
