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

/// Query link count from the opened file, rather than a potentially replaced path.
pub fn has_multiple_links(file: &fs::File) -> Result<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(file.metadata()?.nlink() > 1)
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        #[repr(C)]
        struct FileInformation {
            attributes_times_volume_size: [u32; 10],
            number_of_links: u32,
            file_index: [u32; 2],
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetFileInformationByHandle(
                handle: *mut std::ffi::c_void,
                information: *mut FileInformation,
            ) -> i32;
        }
        let mut information = std::mem::MaybeUninit::<FileInformation>::uninit();
        // The OS fills the fixed-layout BY_HANDLE_FILE_INFORMATION structure.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) }
            == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(unsafe { information.assume_init() }.number_of_links > 1)
    }
}
