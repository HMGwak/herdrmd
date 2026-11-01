use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};

fn cli(home: &Path) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_herdrmd"));
    cmd.env("HOME", home)
        .env("APPDATA", home.join("roaming"))
        .env("LOCALAPPDATA", home.join("local"))
        .env("XDG_CONFIG_HOME", home.join("config"))
        .env("XDG_DATA_HOME", home.join("data"))
        .env("XDG_STATE_HOME", home.join("state"));
    cmd
}
fn json_output(home: &Path, args: &[&str]) -> Value {
    let result = cli(home).args(args).output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    serde_json::from_slice(&result.stdout).unwrap()
}

#[test]
fn relay_saves_stdin_and_keeps_conflicted_request() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().canonicalize().unwrap();
    let vault = home.join("vault");
    fs::create_dir(&vault).unwrap();
    fs::write(vault.join("한글.md"), "before\n").unwrap();
    json_output(
        &home,
        &["vault", "add", "synthetic", vault.to_str().unwrap()],
    );
    let read = json_output(
        &home,
        &["read", "--vault", "synthetic", "--path", "한글.md"],
    );
    let prepared = json_output(&home, &["relay-prepare"]);
    assert!(Path::new(prepared["drafts"].as_str().unwrap()).is_dir());
    let path = Path::new(prepared["directory"].as_str().unwrap()).join("request.json");
    let body = "한글 `$(echo secret)` \"quoted\"\n- [x] task\n";
    let request = json!({"binary": env!("CARGO_BIN_EXE_herdrmd"), "vault": "synthetic", "path": "한글.md", "expected_revision": read["revision"], "text": body});
    fs::write(&path, serde_json::to_vec(&request).unwrap()).unwrap();
    let result = json_output(&home, &["relay", "--request", path.to_str().unwrap()]);
    assert_eq!(result["text"], body);
    assert_eq!(fs::read_to_string(vault.join("한글.md")).unwrap(), body);
    assert!(!path.exists());
    fs::write(&path, serde_json::to_vec(&request).unwrap()).unwrap();
    let failed = cli(&home)
        .args(["relay", "--request"])
        .arg(&path)
        .output()
        .unwrap();
    assert!(!failed.status.success());
    assert!(path.exists());
    assert_eq!(fs::read_to_string(vault.join("한글.md")).unwrap(), body);
}

#[test]
fn relay_rejects_bad_types_oversized_and_external_requests() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().canonicalize().unwrap();
    let prepared = json_output(&home, &["relay-prepare"]);
    let path = Path::new(prepared["directory"].as_str().unwrap()).join("request.json");
    for value in [
        json!({"binary": 5}),
        json!({"binary":"missing", "vault":"v", "path":"p", "expected_revision":"r", "text": "a".repeat(1024*1024+1)}),
        json!({"binary":"missing", "vault":"v", "path":"p", "expected_revision":"r", "text":"", "machine":null}),
    ] {
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            !cli(&home)
                .args(["relay", "--request"])
                .arg(&path)
                .output()
                .unwrap()
                .status
                .success()
        );
        assert!(path.exists());
    }
    let external = home.join("external.json");
    fs::write(&external, b"{}").unwrap();
    assert!(
        !cli(&home)
            .args(["relay", "--request"])
            .arg(&external)
            .output()
            .unwrap()
            .status
            .success()
    );
    #[cfg(unix)]
    {
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(&external, &path).unwrap();
        assert!(
            !cli(&home)
                .args(["relay", "--request"])
                .arg(&path)
                .output()
                .unwrap()
                .status
                .success()
        );
        assert_eq!(fs::read(&external).unwrap(), b"{}");
    }
}

#[test]
fn prepared_paths_support_javascript_forward_slash_suffixes() {
    let temp = tempfile::tempdir().unwrap();
    // Do not canonicalize: Windows canonicalization introduces the verbatim
    // prefix that relay-prepare must not add to ordinary environment paths.
    let home = temp.path();
    let prepared = json_output(home, &["relay-prepare"]);
    for key in ["directory", "drafts"] {
        let directory = prepared[key].as_str().unwrap();
        #[cfg(windows)]
        assert!(!directory.starts_with(r"\\?\"));
        let file = format!("{directory}/javascript-created.json");
        fs::write(&file, b"{}").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"{}");
        if key == "directory" {
            let result = cli(home)
                .args(["relay", "--request", &file])
                .output()
                .unwrap();
            // Parsing reaches the request payload, proving the canonical
            // directory comparison also accepts a mixed-separator client path.
            assert!(String::from_utf8_lossy(&result.stderr).contains("request binary"));
        }
    }
}
