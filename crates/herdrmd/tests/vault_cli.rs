use serde_json::Value;
use std::{fs, path::Path, process::Command};

#[test]
fn product_entry_has_no_diagnostic_commands() {
    let binary = env!("CARGO_BIN_EXE_herdrmd");
    let help = Command::new(binary).arg("--help").output().unwrap();
    assert!(help.status.success());
    let help = String::from_utf8(help.stdout).unwrap();
    assert!(!help.contains("probe") && !help.contains("service") && !help.contains("serve"));
    for command in ["serve", "service", "bridge"] {
        let output = Command::new(binary).arg(command).output().unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("unknown command"));
    }
}

fn run(config: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(args)
        .arg("--config-dir")
        .arg(config)
        .output()
        .unwrap()
}

#[test]
fn cli_follow_creates_a_missing_note_using_isolated_user_state() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let vault = root.join("vault");
    fs::create_dir(&vault).unwrap();
    fs::write(vault.join("source.md"), "[[folder/new]]").unwrap();
    let config = root.join("config");
    let registration = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(["vault", "add", "demo"])
        .arg(&vault)
        .arg("--config-dir")
        .arg(&config)
        .output()
        .unwrap();
    assert!(registration.status.success());
    for (operation, expected) in [("follow-read", true), ("follow", false)] {
        let output = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
            .args([
                operation,
                "--vault",
                "demo",
                "--from",
                "source.md",
                "--target",
                "folder/new#title",
            ])
            .arg("--config-dir")
            .arg(&config)
            .env("HOME", &root)
            .env("APPDATA", root.join("roaming"))
            .env("LOCALAPPDATA", root.join("local"))
            .env("XDG_DATA_HOME", root.join("data"))
            .env("XDG_STATE_HOME", root.join("state"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        let resolution = if operation == "follow-read" {
            assert_eq!(response["document"]["path"], "folder/new.md");
            assert_eq!(response["document"]["text"], "");
            let read = run(
                &config,
                &["read", "--vault", "demo", "--path", "folder/new.md"],
            );
            assert!(read.status.success());
            let read: Value = serde_json::from_slice(&read.stdout).unwrap();
            assert_eq!(response["document"], read);
            &response["resolution"]
        } else {
            &response
        };
        assert_eq!(resolution["created"], expected);
        assert_eq!(resolution["matches"][0], "folder/new.md");
        assert_eq!(resolution["fragment"], "title");
    }
    assert_eq!(fs::read(vault.join("folder/new.md")).unwrap(), b"");
    assert_eq!(
        fs::read(vault.join("source.md")).unwrap(),
        b"[[folder/new]]"
    );
}

#[test]
fn cli_registration_listing_and_read_do_not_need_service() {
    let temp = tempfile::tempdir().unwrap();
    let directory = temp.path().canonicalize().unwrap();
    let vault = directory.join("한글 Vault");
    let config = directory.join("config");
    fs::create_dir(&vault).unwrap();
    let content = "\u{feff}개인 합성 노트 🌿\r\n마지막 줄\r\n";
    fs::write(vault.join("노트.md"), content).unwrap();
    let registration = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(["vault", "add", "personal"])
        .arg(&vault)
        .arg("--config-dir")
        .arg(&config)
        .output()
        .unwrap();
    assert!(
        registration.status.success(),
        "{}",
        String::from_utf8_lossy(&registration.stderr)
    );
    for args in [
        vec!["vault", "list"],
        vec!["files", "--vault", "personal", "--path", ""],
        vec!["read", "--vault", "personal", "--path", "노트.md"],
    ] {
        let output = run(&config, &args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        if args[0] == "read" {
            assert_eq!(value["text"], content.trim_start_matches('\u{feff}'));
            assert_eq!(value["bom"], true);
            assert_eq!(value["read_only"], true);
        }
    }
    let resolved = run(
        &config,
        &[
            "resolve",
            "--vault",
            "personal",
            "--from",
            "노트.md",
            "--target",
            "노트#절|별칭",
        ],
    );
    assert!(
        resolved.status.success(),
        "{}",
        String::from_utf8_lossy(&resolved.stderr)
    );
    let resolved: Value = serde_json::from_slice(&resolved.stdout).unwrap();
    assert_eq!(resolved["status"], "found");
    assert_eq!(resolved["matches"][0], "노트.md");
    assert_eq!(resolved["fragment"], "절");
    assert!(
        !run(
            &config,
            &["read", "--vault", "personal", "--path", "../outside.md"]
        )
        .status
        .success()
    );
    assert_eq!(fs::read(vault.join("노트.md")).unwrap(), content.as_bytes());
    assert_eq!(fs::read_dir(&vault).unwrap().count(), 1);
}
