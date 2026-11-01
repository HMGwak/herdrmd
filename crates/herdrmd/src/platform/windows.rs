use crate::service::Result;
use std::{
    ffi::OsStr,
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::ExitStatusExt,
    },
    path::Path,
    process::ExitStatus,
    ptr,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{
        CREATE_NEW_PROCESS_GROUP, CreateProcessW, DETACHED_PROCESS, GetExitCodeProcess, INFINITE,
        PROCESS_INFORMATION, STARTUPINFOW, TerminateProcess, WaitForSingleObject,
    },
};

pub struct ServiceChild(OwnedHandle);

impl ServiceChild {
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        // SAFETY: the owned process handle stays alive throughout the call.
        match unsafe { WaitForSingleObject(self.0.as_raw_handle(), 0) } {
            WAIT_OBJECT_0 => self.exit_status().map(Some),
            WAIT_TIMEOUT => Ok(None),
            _ => Err(io::Error::last_os_error()),
        }
    }

    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        // SAFETY: the owned process handle is valid until Self is dropped.
        if unsafe { WaitForSingleObject(self.0.as_raw_handle(), INFINITE) } != WAIT_OBJECT_0 {
            return Err(io::Error::last_os_error());
        }
        self.exit_status()
    }

    pub fn kill(&mut self) -> io::Result<()> {
        // Only the child we created can be terminated through this handle.
        if unsafe { TerminateProcess(self.0.as_raw_handle(), 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn exit_status(&self) -> io::Result<ExitStatus> {
        let mut code = 0;
        // SAFETY: valid owned handle and writable exit-code storage.
        if unsafe { GetExitCodeProcess(self.0.as_raw_handle(), &mut code) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(ExitStatus::from_raw(code))
    }
}

// Standard CRT argument quoting, preserving non-UTF-8 Windows path code units.
fn quoted(argument: &OsStr) -> Vec<u16> {
    let mut result = vec![b'"' as u16];
    let mut slashes = 0;
    for ch in argument.encode_wide() {
        if ch == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        result.extend(std::iter::repeat_n(
            b'\\' as u16,
            slashes * if ch == b'"' as u16 { 2 } else { 1 },
        ));
        if ch == b'"' as u16 {
            result.push(b'\\' as u16);
        }
        result.push(ch);
        slashes = 0;
    }
    result.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    result.push(b'"' as u16);
    result
}

pub fn spawn_service(directory: &Path) -> Result<ServiceChild> {
    let executable = std::env::current_exe()?;
    let application: Vec<u16> = executable.as_os_str().encode_wide().chain([0]).collect();
    let mut command = quoted(executable.as_os_str());
    command.extend(" serve --state-dir ".encode_utf16());
    command.extend(quoted(directory.as_os_str()));
    command.push(0);
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut information = PROCESS_INFORMATION::default();
    // SAFETY: UTF-16 buffers are NUL-terminated and live for the call; the command
    // buffer is writable. No handles (including sibling launcher pipes) inherit.
    // A detached process gets no console/standard handles, which this server does
    // not use. Environment and current directory inherit via the documented NULLs.
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            ptr::null(),
            ptr::null(),
            &startup,
            &mut information,
        )
    };
    if created == 0 {
        return Err(io::Error::last_os_error().into());
    }
    // SAFETY: CreateProcessW succeeded and transferred two valid owned handles.
    unsafe {
        CloseHandle(information.hThread);
        Ok(ServiceChild(OwnedHandle::from_raw_handle(
            information.hProcess,
        )))
    }
}
