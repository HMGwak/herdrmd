use serde_json::Value;
use std::{fs, path::Path, process::Command};

fn run(config: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(args)
        .arg("--config-dir")
        .arg(config)
        .output()
        .unwrap()
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
