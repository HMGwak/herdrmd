//! Local, bounded request-file transport for hosts whose exec API has no stdin.
use herdrmd_core::{Result, platform};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const REQUEST_LIMIT: u64 = 6 * 1024 * 1024 + 64 * 1024;

fn directories() -> Result<(PathBuf, PathBuf)> {
    let data = platform::user_directories()?.data;
    let requests = data.join("client-requests");
    let drafts = data.join("client-drafts");
    platform::private_directory(&requests)?;
    platform::private_directory(&drafts)?;
    // Return ordinary OS paths: Windows verbatim paths reject the forward
    // slash appended by the JavaScript file API. Canonicalize only for comparisons.
    Ok((requests, drafts))
}

pub fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "relay-prepare" {
        let (directory, drafts) = directories()?;
        println!("{}", json!({"directory": directory, "drafts": drafts}));
        return Ok(());
    }
    if args.len() != 3 || args[0] != "relay" || args[1] != "--request" {
        return Err("usage: relay --request <absolute JSON path> | relay-prepare".into());
    }
    let path = Path::new(&args[2]);
    let request = read_request(path)?;
    let binary = required(&request, "binary")?;
    let vault = required(&request, "vault")?;
    let relative = required(&request, "path")?;
    let revision = required(&request, "expected_revision")?;
    let text = request
        .get("text")
        .and_then(Value::as_str)
        .ok_or("request text must be a string")?;
    if text.len() as u64 > herdrmd_core::document::MAX_BYTES {
        return Err("document exceeds 1 MiB".into());
    }
    let mut command = match request.get("machine") {
        None => Command::new(binary),
        Some(Value::String(machine)) if !machine.trim().is_empty() => {
            let mut command = Command::new("hc");
            command.args(["exec", "--stdin", "--on", machine, "--", binary]);
            command
        }
        _ => return Err("request machine must be a nonempty string when provided".into()),
    };
    command.args([
        "write",
        "--vault",
        vault,
        "--path",
        relative,
        "--expected-rev",
        revision,
        "--stdin",
    ]);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().ok_or("child stdin unavailable")?;
    // Drain output while writing: diagnostics must not deadlock a large request.
    let body = text.as_bytes().to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&body));
    let output = child.wait_with_output()?;
    let written = writer.join().map_err(|_| "stdin writer failed")?;
    if !output.status.success() {
        return Err(format!(
            "write failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    written?;
    let document: Value = serde_json::from_slice(&output.stdout)?;
    if !document.get("revision").is_some_and(Value::is_string)
        || !document.get("text").is_some_and(Value::is_string)
    {
        return Err("write returned an invalid document".into());
    }
    // A failed cleanup must not turn a committed save into an apparent failure.
    let _ = fs::remove_file(path);
    println!("{}", serde_json::to_string(&document)?);
    Ok(())
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("request {key} must be a nonempty string").into())
}

fn read_request(path: &Path) -> Result<Value> {
    let (requests, _) = directories()?;
    if !path.is_absolute()
        || path
            .parent()
            .ok_or("request parent missing")?
            .canonicalize()?
            != requests.canonicalize()?
    {
        return Err(
            "request must be directly inside the prepared client-requests directory".into(),
        );
    }
    let before = fs::symlink_metadata(path)?;
    if platform::is_link(&before) || !before.is_file() || before.len() > REQUEST_LIMIT {
        return Err("request must be a bounded regular file, not a link".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if platform::is_link(&metadata) || !metadata.is_file() || metadata.len() > REQUEST_LIMIT {
        return Err("invalid request file".into());
    }
    let mut bytes = Vec::new();
    file.take(REQUEST_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > REQUEST_LIMIT {
        return Err("request exceeds size limit".into());
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    let object = value.as_object().ok_or("request must be a JSON object")?;
    if object.keys().any(|key| {
        ![
            "binary",
            "machine",
            "vault",
            "path",
            "expected_revision",
            "text",
        ]
        .contains(&key.as_str())
    }) {
        return Err("unknown request field".into());
    }
    Ok(value)
}
