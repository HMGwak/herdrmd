use herdrmd_core::{markdown, platform::UserDirectories, vault::Registry};
use std::{fs, path::Path};

fn directories(root: &Path) -> UserDirectories {
    UserDirectories {
        config: root.join("config"),
        data: root.join("data"),
        state: root.join("state"),
        cache: root.join("cache"),
    }
}

#[test]
fn following_missing_links_creates_empty_notes_and_keeps_existing_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let files = root.join("vault");
    fs::create_dir(&files).unwrap();
    let source = b"\xef\xbb\xbf# Source\r\n[[new]]\r\n";
    fs::write(files.join("source.md"), source).unwrap();
    let vault = Registry::add(&root.join("config"), "demo", &files).unwrap();
    let dirs = directories(&root);
    let missing = markdown::resolve(&vault, "source.md", "새 노트").unwrap();
    assert_eq!(missing.status, "not_found");
    assert!(!files.join("새 노트.md").exists());
    let created = markdown::follow(&vault, "source.md", "새 노트", &dirs).unwrap();
    assert!(created.created);
    assert_eq!(created.matches, ["새 노트.md"]);
    assert_eq!(fs::read(files.join("새 노트.md")).unwrap(), b"");
    let nested =
        markdown::follow(&vault, "source.md", "새 폴더/하위/문서#제목|표시", &dirs).unwrap();
    assert!(nested.created);
    assert_eq!(nested.matches, ["새 폴더/하위/문서.md"]);
    assert_eq!(nested.fragment.as_deref(), Some("제목"));
    let existing = b"\xef\xbb\xbfDo not replace\r\n";
    fs::write(files.join("새 노트.md"), existing).unwrap();
    let followed = markdown::follow(&vault, "source.md", "새 노트", &dirs).unwrap();
    assert!(!followed.created);
    assert_eq!(followed.matches, ["새 노트.md"]);
    assert_eq!(fs::read(files.join("새 노트.md")).unwrap(), existing);
    assert_eq!(fs::read(files.join("source.md")).unwrap(), source);
    let records: Vec<_> = fs::read_dir(dirs.data.join("recovery").join(&vault.id))
        .unwrap()
        .collect();
    assert_eq!(records.len(), 2);
    for record in records {
        let directory = record.unwrap().path();
        let prepared: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("prepared.json")).unwrap()).unwrap();
        assert!(prepared["expected_revision"].is_null());
        assert_eq!(
            prepared["new_revision"],
            blake3::hash(b"").to_hex().as_str()
        );
        assert!(directory.join("completed.json").is_file());
    }
    assert!(!files.join(".herdrmd").exists());
}

#[test]
fn invalid_and_linked_creation_paths_cannot_escape_the_vault() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let files = root.join("vault");
    fs::create_dir(&files).unwrap();
    fs::write(files.join("source.md"), "source").unwrap();
    let vault = Registry::add(&root.join("config"), "demo", &files).unwrap();
    for target in [
        "../outside",
        "/absolute",
        "C:/elsewhere",
        ".obsidian/private",
        "CON",
        "folder/NUL.md",
        "bad?name",
        "trailing.",
    ] {
        assert!(
            markdown::follow(&vault, "source.md", target, &directories(&root)).is_err(),
            "{target}"
        );
    }
    #[cfg(unix)]
    {
        let outside = root.join("outside");
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, files.join("alias")).unwrap();
        assert!(markdown::follow(&vault, "source.md", "alias/new", &directories(&root)).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }
    let mut dirs = directories(&root);
    dirs.data = files.join("state-inside");
    assert!(markdown::follow(&vault, "source.md", "new", &dirs).is_err());
    assert!(!files.join("state-inside").exists());
    assert!(!files.join("new.md").exists());
}

#[cfg(unix)]
#[test]
fn unreadable_directories_never_turn_an_incomplete_search_into_creation() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let files = root.join("vault");
    fs::create_dir(&files).unwrap();
    fs::write(files.join("source.md"), "source").unwrap();
    let hidden = files.join("restricted");
    fs::create_dir(&hidden).unwrap();
    fs::write(hidden.join("new.md"), "Existing elsewhere").unwrap();
    let vault = Registry::add(&root.join("config"), "demo", &files).unwrap();
    fs::set_permissions(&hidden, fs::Permissions::from_mode(0o000)).unwrap();
    let can_read = fs::read_dir(&hidden).is_ok();
    let result = markdown::follow(&vault, "source.md", "new", &directories(&root));
    fs::set_permissions(&hidden, fs::Permissions::from_mode(0o700)).unwrap();
    let result = result.unwrap();
    // Elevated test runners may retain directory access despite mode 000.
    if !can_read {
        assert_eq!(result.status, "incomplete");
    }
    assert!(!result.created);
    assert!(!files.join("new.md").exists());
    assert_eq!(
        fs::read(hidden.join("new.md")).unwrap(),
        b"Existing elsewhere"
    );
}
