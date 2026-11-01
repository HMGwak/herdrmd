use crate::platform;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Notify;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const PROTOCOL: u32 = 1;
const IDLE: Duration = Duration::from_secs(600);

#[derive(Serialize, Deserialize)]
struct Connection {
    protocol_version: u32,
    pid: u32,
    port: u16,
    token: String,
}

#[derive(Default, Serialize)]
struct Probe {
    echoes: u64,
    events: VecDeque<Event>,
}

#[derive(Deserialize, Serialize)]
struct Event {
    kind: String,
    instance: String,
}

#[derive(Deserialize, Serialize)]
struct Echo {
    text: String,
}

#[derive(Clone)]
struct App {
    token: String,
    host: String,
    probe: Arc<Mutex<Probe>>,
    last_request: Arc<Mutex<Instant>>,
    stop: Arc<Notify>,
}

fn client() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_millis(500)))
        .max_redirects(0)
        .proxy(None)
        .build()
        .into()
}

fn read_connection(directory: &Path) -> Result<Connection> {
    let path = directory.join("service.json");
    if fs::symlink_metadata(&path)?.len() > 8192 {
        return Err("invalid connection file".into());
    }
    let connection: Connection = serde_json::from_slice(&fs::read(path)?)
        .map_err(|_| "invalid connection file (details suppressed)")?;
    if connection.protocol_version != PROTOCOL
        || connection.port == 0
        || connection.token.len() != 64
        || !connection.token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("incompatible connection file".into());
    }
    Ok(connection)
}

pub fn request(directory: &Path, path: &str, post: bool) -> Result<Value> {
    let connection = read_connection(directory)?;
    let url = format!("http://127.0.0.1:{}{path}", connection.port);
    let auth = format!("Bearer {}", connection.token);
    let mut response = if post {
        client()
            .post(&url)
            .header("Authorization", &auth)
            .send_empty()?
    } else {
        client().get(&url).header("Authorization", &auth).call()?
    };
    Ok(response.body_mut().read_json()?)
}

fn ready(directory: &Path, reused: bool) -> Result<Value> {
    let health = request(directory, "/v1/health", false)?;
    if health["protocol_version"] != PROTOCOL || health["mode"] != "bridge-probe" {
        return Err("unexpected service identity".into());
    }
    Ok(json!({
        "protocol_version": PROTOCOL,
        "connection_file": directory.join("service.json"),
        "pid": health["pid"], "reused": reused
    }))
}

// Readiness only: a host such as Herdr may own the long-lived process itself.
// In particular, a Windows exec Job Object may forbid detached child survival.
pub fn wait(directory: &Path) -> Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(path) = directory.canonicalize() {
            if let Ok(info) = ready(&path, true) {
                return Ok(info);
            }
        }
        if Instant::now() >= deadline {
            return Err("service not ready within 5 seconds".into());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}

pub fn ensure(directory: &Path) -> Result<Value> {
    platform::prepare_directory(directory)?;
    let directory = directory.canonicalize()?;
    if let Ok(info) = ready(&directory, true) {
        return Ok(info);
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut child = platform::spawn_service(&directory)?;
    loop {
        if let Ok(info) = ready(&directory, false) {
            // A concurrent ensure may have won. Reap our losing launcher if it exited.
            let _ = child.try_wait();
            return Ok(info);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("service not ready within 5 seconds".into());
        }
        // A losing child can exit because another instance owns the lock; keep checking it.
        let _ = child.try_wait();
        std::thread::sleep(Duration::from_millis(40));
    }
}

pub fn serve(directory: &Path) -> Result<()> {
    platform::close_inherited_descriptors()?;
    platform::prepare_directory(directory)?;
    let instance = platform::private_file(&directory.join("instance.lock"), false)?;
    instance
        .try_lock()
        .map_err(|_| "service instance already locked")?;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(run(directory))
}

async fn run(directory: &Path) -> Result<()> {
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|_| "OS randomness unavailable")?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let state = App {
        token: token.clone(),
        host: format!("127.0.0.1:{port}"),
        probe: Arc::default(),
        last_request: Arc::new(Mutex::new(Instant::now())),
        stop: Arc::default(),
    };
    let app = Router::new()
        .route("/v1/health", get(health))
        .route("/v1/echo", post(echo))
        .route("/v1/events", post(event))
        .route("/v1/probe", get(probe))
        .route("/v1/stop", post(stop))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), authenticate))
        .with_state(state.clone());
    platform::publish_connection(
        directory,
        &serde_json::to_vec(&Connection {
            protocol_version: PROTOCOL,
            pid: std::process::id(),
            port,
            token,
        })?,
    )?;
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            loop {
                tokio::select! {
                    _ = state.stop.notified() => break,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {
                        if state.last_request.lock().unwrap().elapsed() >= IDLE { break; }
                    }
                }
            }
        })
        .await;
    let _ = fs::remove_file(directory.join("service.json"));
    Ok(result?)
}

async fn authenticate(State(state): State<App>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    if headers.get(header::HOST).and_then(|v| v.to_str().ok()) != Some(&state.host)
        || headers.contains_key(header::ORIGIN)
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "FORBIDDEN_ORIGIN"})),
        )
            .into_response();
    }
    let expected = format!("Bearer {}", state.token);
    if headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        != Some(&expected)
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "UNAUTHORIZED"})),
        )
            .into_response();
    }
    *state.last_request.lock().unwrap() = Instant::now();
    match tokio::time::timeout(Duration::from_secs(2), next.run(request)).await {
        Ok(response) => response,
        Err(_) => (
            StatusCode::REQUEST_TIMEOUT,
            Json(json!({"error": "REQUEST_TIMEOUT"})),
        )
            .into_response(),
    }
}

async fn health() -> Json<Value> {
    Json(json!({"protocol_version": PROTOCOL, "mode": "bridge-probe",
        "version": env!("CARGO_PKG_VERSION"), "pid": std::process::id(),
        "message": "한글 연결 검증"}))
}

async fn echo(State(state): State<App>, Json(body): Json<Echo>) -> Json<Value> {
    state.probe.lock().unwrap().echoes += 1;
    Json(json!({"protocol_version": PROTOCOL, "utf8_bytes": body.text.len(), "text": body.text}))
}

async fn event(State(state): State<App>, Json(body): Json<Event>) -> Response {
    if body.kind.len() > 64 || body.instance.len() > 128 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut probe = state.probe.lock().unwrap();
    if probe.events.len() == 128 {
        probe.events.pop_front();
    }
    probe.events.push_back(body);
    Json(json!({"ok": true})).into_response()
}

async fn probe(State(state): State<App>) -> Json<Value> {
    Json(
        json!({"protocol_version": PROTOCOL, "pid": std::process::id(),
        "probe": &*state.probe.lock().unwrap()}),
    )
}

async fn stop(State(state): State<App>) -> Json<Value> {
    state.stop.notify_one();
    Json(json!({"stopping": true}))
}
