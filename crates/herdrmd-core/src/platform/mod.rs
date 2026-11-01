use crate::Result;
use serde::Serialize;
use std::{fs, path::PathBuf};

#[derive(Serialize)]
pub struct UserDirectories {
    pub config: PathBuf,
    pub data: PathBuf,
    pub state: PathBuf,
    pub cache: PathBuf,
}

fn absolute_env(name: &str) -> Result<PathBuf> {
    let path = PathBuf::from(std::env::var_os(name).ok_or("user directory unavailable")?);
    if !path.is_absolute() {
        return Err("user directory must be absolute".into());
    }
    Ok(path)
}

pub fn user_directories() -> Result<UserDirectories> {
    #[cfg(windows)]
    {
        let local = absolute_env("LOCALAPPDATA")?;
        Ok(UserDirectories {
            config: absolute_env("APPDATA")?.join("herdrmd"),
            data: local.join("herdrmd/data"),
            state: local.join("herdrmd/runtime"),
            cache: local.join("herdrmd/cache"),
        })
    }
    #[cfg(target_os = "macos")]
    {
        let library = absolute_env("HOME")?.join("Library");
        let application = library.join("Application Support/herdrmd");
        Ok(UserDirectories {
            config: application.join("config"),
            data: application.join("data"),
            state: application.join("runtime"),
            cache: library.join("Caches/herdrmd"),
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let home = absolute_env("HOME")?;
        Ok(UserDirectories {
            config: absolute_env("XDG_CONFIG_HOME")
                .unwrap_or(home.join(".config"))
                .join("herdrmd"),
            data: absolute_env("XDG_DATA_HOME")
                .unwrap_or(home.join(".local/share"))
                .join("herdrmd"),
            state: absolute_env("XDG_STATE_HOME")
                .unwrap_or(home.join(".local/state"))
                .join("herdrmd"),
            cache: absolute_env("XDG_CACHE_HOME")
                .unwrap_or(home.join(".cache"))
                .join("herdrmd"),
        })
    }
}

pub fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn private_directory(path: &std::path::Path) -> Result<()> {
    fs::create_dir_all(path)?;
    if is_link(&fs::symlink_metadata(path)?) {
        return Err("configuration directory cannot be a link".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
