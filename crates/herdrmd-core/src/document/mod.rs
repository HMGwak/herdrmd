use crate::{
    Result, platform,
    vault::{Vault, is_markdown},
};
use serde::Serialize;
use std::{fs, io::Read};

// Even the worst JSON escaping fits Herdr exec's 8 MiB output cap.
pub const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
pub struct Document {
    pub path: String,
    pub text: Option<String>,
    pub revision: String,
    pub bytes: usize,
    pub encoding: &'static str,
    pub bom: bool,
    pub line_endings: &'static str,
    pub final_newline: bool,
    pub read_only: bool,
}

pub fn read(vault: &Vault, relative: &str) -> Result<Document> {
    let path = vault.resolve(relative)?;
    if !is_markdown(&path) {
        return Err("only Markdown files can be read".into());
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
        options.custom_flags(0x00200000);
    } // OPEN_REPARSE_POINT
    let file = options.open(&path)?;
    let meta = file.metadata()?;
    if platform::has_multiple_links(&file)? {
        return Err("hard-linked documents are not supported".into());
    }
    if !meta.is_file() || platform::is_link(&meta) || meta.len() > MAX_BYTES {
        return Err("unsupported file type or document exceeds 1 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("document exceeds 1 MiB".into());
    }
    if vault.resolve(relative)? != path {
        return Err("path changed during read".into());
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let source = if bom { &bytes[3..] } else { &bytes };
    let text = std::str::from_utf8(source)
        .ok()
        .filter(|s| !s.contains('\0'));
    let crlf = source.windows(2).filter(|pair| *pair == b"\r\n").count();
    let lf = source.iter().filter(|&&b| b == b'\n').count() - crlf;
    let cr = source.iter().filter(|&&b| b == b'\r').count() - crlf;
    let line_endings = match (crlf > 0, lf > 0, cr > 0) {
        (false, false, false) => "none",
        (true, false, false) => "crlf",
        (false, true, false) => "lf",
        (false, false, true) => "cr",
        _ => "mixed",
    };
    Ok(Document {
        path: relative.to_owned(),
        text: text.map(str::to_owned),
        revision: blake3::hash(&bytes).to_hex().to_string(),
        bytes: bytes.len(),
        encoding: if text.is_some() {
            "utf-8"
        } else {
            "unsupported"
        },
        bom,
        line_endings,
        final_newline: source.ends_with(b"\n") || source.ends_with(b"\r"),
        read_only: text.is_none() || line_endings == "mixed",
    })
}
