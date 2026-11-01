# 개발 시작과 검증

Rust `1.94.0`을 사용한다. rustup 환경에서는 루트의 `rust-toolchain.toml`이 버전과 rustfmt를 선택한다. Homebrew 등의 직접 설치는 파일이 버전을 강제하지 않으므로 `rustc --version`, `cargo --version`으로 같은 버전인지 확인한다.

```sh
cargo run -p herdrmd
cargo fmt --check
cargo check --workspace --locked
cargo build --workspace --locked
cargo test --workspace --locked
```

실행 결과는 골격 상태 안내다. 테스트는 현재 도메인 테스트 0개이며 이후 태스크에서 경로 경계, 원문 바이트 보존, 저장 실패, 프로세스 경합 등 실제 완료 기준에 맞춰 추가한다. 새 의존성을 도입할 때 호환 버전을 검증하고 `Cargo.lock`을 갱신·커밋한다. `pulldown-cmark`, `notify`, `fs4`, BLAKE3는 기능 태스크에서 도입할 예정이며 현재 의존성에 포함하지 않았다.

CI는 macOS·Windows에서 고정한 Rust로 포맷, check, build, test를 수행한다. 초기에는 캐시·설치·릴리스 작업을 추가하지 않는다. CI 결과와 실제 Windows Herdr 화면 검증은 별도로 기록한다.

합성 fixture는 추후 `tests/fixtures/`에 두고 줄바꿈·BOM·지원하지 않는 인코딩 바이트를 그대로 추적한다. `.gitattributes`가 이 경로의 자동 줄바꿈 변환을 제외한다. 실제 개인 Vault를 테스트 자료로 복사하지 않는다. 설치 파일은 `dist/`·`artifacts/`, 머신별 상태는 OS 사용자 경로에 두며 Git에서 제외한다.

기능 구현은 00 Herdr 연결 검증부터 진행한다. HTTP GET/POST, 인증 헤더, 한글 왕복, 분리 실행 생존과 탭 수명을 실제 Herdr에서 확인한 후 코어를 확장한다. 설치된 mod나 개인 Vault에 대한 기능 변경은 초기 workspace 구성 범위에 포함하지 않는다.
