use herdrmd_core::{
    document,
    platform::UserDirectories,
    storage,
    vault::{Registry, Vault},
};
use std::fs;

fn setup() -> (tempfile::TempDir, Vault, UserDirectories) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    fs::create_dir(root.join("vault")).unwrap();
    let dirs = UserDirectories {
        config: root.join("config"),
        data: root.join("data"),
        state: root.join("state"),
        cache: root.join("cache"),
    };
    let vault = Registry::add(&dirs.config, "test", &root.join("vault")).unwrap();
    (temp, vault, dirs)
}

#[test]
fn writes_preserve_format_and_recover_exact_original_bytes() {
    let (_temp, vault, dirs) = setup();
    for (old, new, expected) in [
        (
            "\u{feff}- [ ] 한글\r\n끝\r\n",
            "- [x] 한글\n끝\n",
            "\u{feff}- [x] 한글\r\n끝\r\n",
        ),
        ("a\rb\r", "a\nc\n", "a\rc\r"),
        ("a\nb", "a\nc", "a\nc"),
        ("", "새 노트\n", "새 노트\n"),
    ] {
        fs::write(vault.path.join("note.md"), old).unwrap();
        let current = document::read(&vault, "note.md").unwrap();
        let saved = storage::write(&vault, "note.md", &current.revision, new, &dirs).unwrap();
        assert_eq!(
            fs::read(vault.path.join("note.md")).unwrap(),
            expected.as_bytes()
        );
        assert_eq!(
            saved.revision,
            blake3::hash(expected.as_bytes()).to_hex().to_string()
        );
        let operations = fs::read_dir(dirs.data.join("recovery").join(&vault.id)).unwrap();
        assert!(operations.filter_map(Result::ok).any(|op| {
            let p = op.path();
            fs::read(p.join("original.bin")).unwrap() == old.as_bytes()
                && p.join("prepared.json").exists()
                && p.join("completed.json").exists()
                && fs::read(p.join("new.bin")).unwrap() == expected.as_bytes()
        }));
        assert!(storage::write(&vault, "note.md", &current.revision, "stale", &dirs).is_err());
        assert_eq!(
            fs::read(vault.path.join("note.md")).unwrap(),
            expected.as_bytes()
        );
        let second = storage::write(&vault, "note.md", &saved.revision, "latest", &dirs).unwrap();
        assert_eq!(second.text.as_deref(), Some("latest"));
    }
}

#[test]
fn conflicts_readonly_encodings_and_invalid_paths_never_change_original() {
    let (_temp, vault, dirs) = setup();
    for old in [b"a\r\nb\n".as_slice(), b"\xff\xfe\0a", b"normal\n"] {
        fs::write(vault.path.join("note.md"), old).unwrap();
        let doc = document::read(&vault, "note.md").unwrap();
        assert!(storage::write(&vault, "note.md", "stale", "bad", &dirs).is_err());
        if doc.read_only {
            assert!(storage::write(&vault, "note.md", &doc.revision, "bad", &dirs).is_err());
        }
        for path in [
            "../note.md",
            "/note.md",
            ".obsidian/note.md",
            "note.md:stream",
        ] {
            assert!(storage::write(&vault, path, &doc.revision, "bad", &dirs).is_err());
        }
        assert!(storage::write(&vault, "note.md", &doc.revision, "nul\0text", &dirs).is_err());
        assert_eq!(fs::read(vault.path.join("note.md")).unwrap(), old);
    }
}

#[test]
fn permissions_and_links_are_rejected_without_mutation() {
    let (temp, vault, dirs) = setup();
    let path = vault.path.join("note.md");
    fs::write(&path, "original").unwrap();
    let revision = document::read(&vault, "note.md").unwrap().revision;
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    assert!(storage::write(&vault, "note.md", &revision, "bad", &dirs).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
    fs::set_permissions(&path, permissions).unwrap();
    #[cfg(unix)]
    {
        let outside = temp.path().join("outside.md");
        fs::write(&outside, "outside").unwrap();
        std::os::unix::fs::symlink(&outside, vault.path.join("link.md")).unwrap();
        assert!(storage::write(&vault, "link.md", &revision, "bad", &dirs).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
    }
    #[cfg(not(unix))]
    let _ = temp;
}

#[test]
fn hardlinks_cannot_be_replaced() {
    let (_temp, vault, dirs) = setup();
    let path = vault.path.join("note.md");
    fs::write(&path, "original").unwrap();
    let revision = document::read(&vault, "note.md").unwrap().revision;
    fs::hard_link(&path, vault.path.join("alias.md")).unwrap();
    assert!(storage::write(&vault, "note.md", &revision, "bad", &dirs).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
    assert_eq!(fs::read(vault.path.join("alias.md")).unwrap(), b"original");
}
