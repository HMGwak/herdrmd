use herdrmd_core::{markdown, vault::Registry};
use std::fs;
use unicode_normalization::UnicodeNormalization;

#[test]
fn resolves_names_paths_aliases_and_fragments_without_writes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let files = root.join("vault");
    for folder in ["folder", "other", "folder/sub", ".obsidian"] {
        fs::create_dir_all(files.join(folder)).unwrap();
    }
    for file in [
        "source.md",
        "folder/source.md",
        "folder/노트.md",
        "other/dup.md",
        "folder/dup.md",
        "folder/sub/Deep.MD",
        ".obsidian/hidden.md",
    ] {
        fs::write(files.join(file), format!("# {file}\r\n")).unwrap();
    }
    let decomposed = format!("folder/{}.md", "정규화".nfd().collect::<String>());
    fs::write(files.join(&decomposed), "# NFD\n").unwrap();
    let vault = Registry::add(&root.join("config"), "test", &files).unwrap();
    let before = fs::read(files.join("folder/노트.md")).unwrap();
    for target in ["노트", "노트.md", "folder/노트", "노트#절|표시 이름"] {
        let result = markdown::resolve(&vault, "source.md", target).unwrap();
        assert_eq!(result.status, "found", "{target}");
        assert_eq!(result.matches, ["folder/노트.md"]);
    }
    let dup = markdown::resolve(&vault, "source.md", "dup").unwrap();
    assert_eq!(dup.status, "ambiguous");
    assert_eq!(dup.matches, ["folder/dup.md", "other/dup.md"]);
    assert_eq!(
        markdown::resolve(&vault, "source.md", "folder/dup")
            .unwrap()
            .matches,
        ["folder/dup.md"]
    );
    assert_eq!(
        markdown::resolve(&vault, "source.md", "deep.md")
            .unwrap()
            .matches,
        ["folder/sub/Deep.MD"]
    );
    assert_eq!(
        markdown::resolve(&vault, "source.md", "정규화")
            .unwrap()
            .matches,
        [decomposed]
    );
    let anchor = markdown::resolve(&vault, "source.md", "#^block").unwrap();
    assert_eq!(anchor.matches, ["source.md"]);
    assert_eq!(anchor.fragment.as_deref(), Some("^block"));
    assert_eq!(
        markdown::resolve(&vault, "source.md", "missing")
            .unwrap()
            .status,
        "not_found"
    );
    assert_eq!(fs::read(files.join("folder/노트.md")).unwrap(), before);
}

#[test]
fn excluded_and_outside_paths_and_links_are_never_targets() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let files = root.join("vault");
    fs::create_dir(&files).unwrap();
    fs::write(files.join("source.md"), "source").unwrap();
    fs::create_dir(files.join(".obsidian")).unwrap();
    fs::write(files.join(".obsidian/hidden.md"), "hidden").unwrap();
    let vault = Registry::add(&root.join("config"), "test", &files).unwrap();
    for target in [
        "../outside",
        "/absolute",
        "C:/outside",
        "a\\b",
        ".obsidian/hidden",
        "https://example.invalid",
        "a/../b",
        "",
    ] {
        assert!(
            markdown::resolve(&vault, "source.md", target).is_err(),
            "{target}"
        );
    }
    assert_eq!(
        markdown::resolve(&vault, "source.md", "hidden")
            .unwrap()
            .status,
        "not_found"
    );
    assert!(markdown::resolve(&vault, "../outside.md", "source").is_err());
    #[cfg(unix)]
    {
        fs::write(root.join("outside.md"), "outside").unwrap();
        std::os::unix::fs::symlink(root.join("outside.md"), files.join("alias.md")).unwrap();
        assert_eq!(
            markdown::resolve(&vault, "source.md", "alias")
                .unwrap()
                .status,
            "not_found"
        );
    }
}
