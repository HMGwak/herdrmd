use herdrmd_core::{document, vault::Registry};
use std::{fs, path::PathBuf};

fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let vault = root.join("개인 Vault");
    let config = root.join("config");
    fs::create_dir(&vault).unwrap();
    (temp, vault, config)
}

#[test]
fn registration_reuse_and_conflicts_preserve_registry() {
    let (_temp, root, config) = setup();
    let first = Registry::add(&config, "personal", &root).unwrap();
    let again = Registry::add(&config, "another-name", &root).unwrap();
    assert_eq!(first.id, again.id);
    assert_eq!(again.name, "personal");
    assert_eq!(Registry::load(&config).unwrap().vaults.len(), 1);
    let other = root.parent().unwrap().join("other");
    fs::create_dir(&other).unwrap();
    assert!(Registry::add(&config, "personal", &other).is_err());
    let original = fs::read(config.join("registry.json")).unwrap();
    assert!(Registry::add(&config, "../bad", &other).is_err());
    assert_eq!(fs::read(config.join("registry.json")).unwrap(), original);
    assert!(Registry::add(&root.join("state"), "personal", &root).is_err());
    assert!(!root.join("state").exists());
}

#[test]
fn listing_and_reads_enforce_boundary_and_exclusions() {
    let (_temp, root, config) = setup();
    fs::create_dir(root.join("폴더")).unwrap();
    fs::write(root.join("폴더/노트.md"), "안녕하세요 🌿\n").unwrap();
    fs::write(root.join("secret.txt"), "not Markdown").unwrap();
    for name in [".obsidian", ".git", ".trash", ".herdrmd-work"] {
        fs::create_dir(root.join(name)).unwrap();
        fs::write(root.join(name).join("private.md"), "hidden").unwrap();
    }
    let vault = Registry::add(&config, "personal", &root).unwrap();
    let listing = vault.list("").unwrap();
    assert_eq!(listing.entries.len(), 1);
    assert_eq!(listing.entries[0].name, "폴더");
    for path in [
        "../outside.md",
        "/absolute.md",
        "C:/outside.md",
        "폴더/../../x.md",
        ".obsidian/private.md",
        ".git/private.md",
        "a\\b.md",
        "폴더/노트.md:secret",
        ".trash/private.md",
    ] {
        assert!(vault.resolve(path).is_err(), "must reject {path}");
    }
    assert!(document::read(&vault, "secret.txt").is_err());
    let before = fs::read(root.join("폴더/노트.md")).unwrap();
    let read = document::read(&vault, "폴더/노트.md").unwrap();
    assert_eq!(read.text.as_deref(), Some("안녕하세요 🌿\n"));
    assert!(read.read_only);
    assert_eq!(fs::read(root.join("폴더/노트.md")).unwrap(), before);
}

#[test]
fn exact_bytes_bom_line_endings_revision_and_unsupported_encoding() {
    let (_temp, root, config) = setup();
    let vault = Registry::add(&config, "personal", &root).unwrap();
    for (source, endings, bom, encoding) in [
        ("한글 🌿\r\n둘째 줄\r\n".as_bytes(), "crlf", false, "utf-8"),
        ("\u{feff}한글\n끝".as_bytes(), "lf", true, "utf-8"),
        (b"a\nb\r\nc\r".as_slice(), "mixed", false, "utf-8"),
        (b"a\rb".as_slice(), "cr", false, "utf-8"),
        (b"\xff\xfe\x00\xac".as_slice(), "none", false, "unsupported"),
    ] {
        fs::write(root.join("sample.md"), source).unwrap();
        let doc = document::read(&vault, "sample.md").unwrap();
        assert_eq!(doc.bytes, source.len());
        assert_eq!(doc.revision, blake3::hash(source).to_hex().to_string());
        assert_eq!(doc.bom, bom);
        assert_eq!(doc.encoding, encoding);
        assert_eq!(doc.line_endings, endings);
        assert_eq!(
            doc.final_newline,
            source.ends_with(b"\n") || source.ends_with(b"\r")
        );
        if encoding == "unsupported" {
            assert!(doc.text.is_none());
        } else {
            assert_eq!(
                doc.text.unwrap().as_bytes(),
                if bom { &source[3..] } else { source }
            );
        }
        assert_eq!(fs::read(root.join("sample.md")).unwrap(), source);
    }
}

#[test]
fn oversized_documents_and_corrupt_registry_fail_without_replacement() {
    let (_temp, root, config) = setup();
    let vault = Registry::add(&config, "personal", &root).unwrap();
    fs::write(
        root.join("large.md"),
        vec![b'x'; document::MAX_BYTES as usize + 1],
    )
    .unwrap();
    assert!(document::read(&vault, "large.md").is_err());
    fs::write(config.join("registry.json"), b"invalid registry").unwrap();
    assert!(Registry::add(&config, "another", &root).is_err());
    assert_eq!(
        fs::read(config.join("registry.json")).unwrap(),
        b"invalid registry"
    );
}

#[cfg(unix)]
#[test]
fn symlinks_and_special_files_are_never_followed() {
    use std::os::unix::fs::symlink;
    let (_temp, root, config) = setup();
    let outside = root.parent().unwrap().join("outside.md");
    fs::write(&outside, "outside").unwrap();
    symlink(&outside, root.join("link.md")).unwrap();
    let vault = Registry::add(&config, "personal", &root).unwrap();
    assert!(vault.list("").unwrap().entries.is_empty());
    assert!(document::read(&vault, "link.md").is_err());
    let alias = root.parent().unwrap().join("alias");
    symlink(&root, &alias).unwrap();
    assert!(Registry::add(&config, "alias", &alias).is_err());
    let socket = std::os::unix::net::UnixListener::bind(root.join("socket.md")).unwrap();
    assert!(document::read(&vault, "socket.md").is_err());
    drop(socket);
}

#[cfg(windows)]
#[test]
fn windows_junctions_cannot_escape_vault() {
    let (_temp, root, config) = setup();
    let outside = root.parent().unwrap().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("private.md"), "outside").unwrap();
    let junction = root.join("junction");
    let status = std::process::Command::new("cmd.exe")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&outside)
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "{}",
        String::from_utf8_lossy(&status.stderr)
    );
    let vault = Registry::add(&config, "personal", &root).unwrap();
    assert!(vault.resolve("junction/private.md").is_err());
    assert!(vault.list("").unwrap().entries.is_empty());
    assert!(Registry::add(&config, "alias", &junction).is_err());
    fs::remove_dir(junction).unwrap();
}
