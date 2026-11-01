use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

fn command(directory: &Path, words: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(words)
        .arg("--state-dir")
        .arg(directory)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

struct Running(tempfile::TempDir);

impl Drop for Running {
    fn drop(&mut self) {
        let _ = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
            .args(["service", "stop", "--state-dir"])
            .arg(self.0.path())
            .output();
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.0.path().join("service.json").exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(3)))
        .proxy(None)
        .build()
        .into()
}

#[test]
fn detached_round_trip_authentication_and_shutdown() {
    let running = Running(tempfile::tempdir().unwrap());
    let directory = running.0.path().to_path_buf();
    let ensured = command(&directory, &["service", "ensure"]);
    let raw = fs::read(directory.join("service.json")).unwrap();
    let connection: Value = serde_json::from_slice(&raw).unwrap();
    let token = connection["token"].as_str().unwrap();
    assert!(
        !ensured.to_string().contains(token),
        "launcher must not print token"
    );
    let again = command(&directory, &["service", "ensure"]);
    assert_eq!(ensured["pid"], again["pid"]);
    assert_eq!(again["reused"], true);
    let base = format!("http://127.0.0.1:{}", connection["port"]);
    let auth = format!("Bearer {token}");
    assert_eq!(
        agent()
            .get(format!("{base}/v1/health"))
            .call()
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        agent()
            .get(format!("{base}/v1/health"))
            .header("Authorization", "Bearer wrong")
            .call()
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        agent()
            .get(format!("{base}/v1/health"))
            .header("Authorization", &auth)
            .header("Origin", "http://example.com")
            .call()
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        agent()
            .get(format!("{base}/v1/health"))
            .header("Authorization", &auth)
            .header("Host", "example.com")
            .call()
            .unwrap()
            .status(),
        403
    );
    let sample = "한글 🌿\r\n둘째 줄\n마지막 개행 없음";
    let mut response = agent()
        .post(format!("{base}/v1/echo"))
        .header("Authorization", &auth)
        .send_json(json!({"text": sample}))
        .unwrap();
    assert_eq!(response.status(), 200);
    let echoed: Value = response.body_mut().read_json().unwrap();
    assert_eq!(echoed["text"], sample);
    assert_eq!(echoed["utf8_bytes"], sample.len());
    assert_eq!(
        agent()
            .post(format!("{base}/v1/echo"))
            .header("Authorization", &auth)
            .send_json(json!({"text": "x".repeat(70_000)}))
            .unwrap()
            .status(),
        413
    );
    assert_eq!(
        agent()
            .post(format!("{base}/v1/events"))
            .header("Authorization", &auth)
            .send_json(json!({"kind": "test", "instance": "integration"}))
            .unwrap()
            .status(),
        200
    );
    let report = command(&directory, &["bridge", "report"]);
    assert_eq!(report["probe"]["echoes"], 1);
    assert_eq!(report["probe"]["events"][0]["kind"], "test");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(directory.join("service.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    drop(running);
    // Running's Drop stopped and waited for the child, including on assertion failure.
    let stopped = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(["service", "status", "--state-dir"])
        .arg(&directory)
        .output();
    // directory was removed with the temporary state; no service can be discovered there.
    assert!(!stopped.unwrap().status.success());
}

#[test]
fn concurrent_ensure_and_stale_connection_recovery() {
    let running = Running(tempfile::tempdir().unwrap());
    let directory = running.0.path().to_path_buf();
    fs::write(
        directory.join("service.json"),
        b"stale incomplete connection",
    )
    .unwrap();
    let workers: Vec<_> = (0..3)
        .map(|_| {
            let directory = directory.clone();
            std::thread::spawn(move || command(&directory, &["service", "ensure"]))
        })
        .collect();
    let results: Vec<_> = workers
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert!(
        results
            .iter()
            .all(|value| value["pid"] == results[0]["pid"])
    );
    assert_eq!(
        command(&directory, &["service", "status"])["mode"],
        "bridge-probe"
    );
    let duplicate = Command::new(env!("CARGO_BIN_EXE_herdrmd"))
        .args(["serve", "--state-dir"])
        .arg(&directory)
        .output()
        .unwrap();
    assert!(
        !duplicate.status.success(),
        "second server must not replace connection"
    );
    assert_eq!(
        command(&directory, &["service", "status"])["pid"],
        results[0]["pid"]
    );
}

#[cfg(unix)]
#[test]
fn detached_service_does_not_hold_inherited_output_descriptors() {
    use std::io::Read;
    use std::os::{fd::AsRawFd, unix::net::UnixStream};

    let running = Running(tempfile::tempdir().unwrap());
    let (mut reader, writer) = UnixStream::pair().unwrap();
    // Deliberately model a launcher carrying an unrelated inheritable output FD.
    // SAFETY: writer owns a valid FD for this entire call; no memory is accessed.
    assert_ne!(
        unsafe { libc::fcntl(writer.as_raw_fd(), libc::F_SETFD, 0) },
        -1
    );
    reader
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    command(running.0.path(), &["service", "ensure"]);
    drop(writer);
    let mut byte = [0];
    assert_eq!(
        reader.read(&mut byte).unwrap(),
        0,
        "service must not retain the launcher's unrelated output FD"
    );
}
