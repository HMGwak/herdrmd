# 개발 시작과 검증

Rust `1.94.0`을 사용한다. rustup 환경에서는 루트의 `rust-toolchain.toml`이 버전과 rustfmt를 선택한다. Homebrew 등의 직접 설치는 파일이 버전을 강제하지 않으므로 `rustc --version`, `cargo --version`으로 같은 버전인지 확인한다.

```sh
cargo run -p herdrmd
cargo fmt --check
cargo check --workspace --locked
cargo build --workspace --locked
cargo test --workspace --locked
```

인수 없는 실행은 도움말이다. 통합 테스트는 임시 상태 폴더에서 인증·한글 echo·분리 실행·동시 ensure·종료를 검증한다. 읽기 코어·CLI 테스트는 합성 Vault에서 원문·revision·경계·제외 규칙과 symlink/Windows junction 거부를 검사한다. 저장 실패와 복구는 후속이다. 새 의존성을 도입할 때 호환 버전을 검증하고 `Cargo.lock`을 갱신·커밋한다. 원문 revision에는 BLAKE3를 도입했으며 `pulldown-cmark`, `notify`는 후속이다. 인스턴스와 registry 잠금은 고정 Rust 버전의 표준 File 잠금을 사용한다.

CI는 macOS·Windows에서 고정한 Rust로 포맷, check, build, test를 수행한다. 성공한 push는 Windows 연결 검증용 EXE·mod·안내 artifact도 제공한다. 제품 설치·릴리스 작업은 후속 범위다. CI 결과와 실제 Windows Herdr 화면 검증은 별도로 기록한다.

합성 fixture는 추후 `tests/fixtures/`에 두고 줄바꿈·BOM·지원하지 않는 인코딩 바이트를 그대로 추적한다. `.gitattributes`가 이 경로의 자동 줄바꿈 변환을 제외한다. 실제 개인 Vault를 테스트 자료로 복사하지 않는다. 설치 파일은 `dist/`·`artifacts/`, 머신별 상태는 OS 사용자 경로에 두며 Git에서 제외한다.

00 Herdr 연결 검증은 [bridge-verification.md](bridge-verification.md)를 따른다. HTTP GET/POST, 인증 헤더, 한글 왕복, 분리 실행 생존과 탭 수명을 실제 Herdr에서 확인한 후 코어를 확장한다. 개발 검증용 mod만 설치하며 개인 Vault에는 접근하지 않는다.
