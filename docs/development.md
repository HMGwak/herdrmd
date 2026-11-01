# 개발 시작과 검증

Rust `1.94.0`을 사용한다. rustup 환경에서는 루트의 `rust-toolchain.toml`이 버전과 rustfmt를 선택한다. Homebrew 등의 직접 설치는 파일이 버전을 강제하지 않으므로 `rustc --version`, `cargo --version`으로 같은 버전인지 확인한다.

```sh
cargo run -p herdrmd
cargo fmt --check
cargo check --workspace --locked
cargo build --workspace --locked
cargo test --workspace --locked
node --test tests/scenarios/launcher.test.mjs tests/scenarios/reader-model.test.mjs tests/scenarios/frontmatter.test.mjs tests/scenarios/wikilinks.test.mjs tests/scenarios/product-entry.test.mjs
```

인수 없는 실행은 도움말이다. 개발 진단 도구의 통합 테스트는 임시 상태 폴더에서 인증·한글 echo·분리 실행·동시 ensure·종료를 검증한다. 읽기 코어·CLI 테스트는 합성 Vault에서 원문·revision·경계·제외 규칙과 symlink/Windows junction 거부를 검사한다. 위키링크 생성 테스트는 빈 파일·중첩 폴더·기존 원문 보존·생성 경합·권한 부족의 생성 차단과 Vault 밖 기록을 검사한다. 기존 본문 저장·일반 복구는 후속이다. 새 의존성을 도입할 때 호환 버전을 검증하고 `Cargo.lock`을 갱신·커밋한다. 원문 revision에는 BLAKE3를 도입했으며 `pulldown-cmark`, `notify`는 후속이다. 인스턴스와 registry 잠금은 고정 Rust 버전의 표준 File 잠금을 사용한다.

CI는 당분간 workflow_dispatch 수동 실행만 사용한다. push/PR마다 전체 빌드하지 않는다. 필요할 때 macOS·Windows·Linux에서 고정한 Rust로 포맷, check, build, test와 Node UI 계약 테스트를 수행하고 Windows EXE·mod 패키지와 x86_64 Linux 정적 musl reader artifact를 생성한다. UI 변경은 로컬 Node/mod 검사와 실제 화면을 우선 확인하며 Rust 변경 시 필요한 로컬 workspace 검사를 수행한다. 제품 설치·릴리스 작업은 후속 범위다. CI 결과와 실제 Windows Herdr 화면 검증은 별도로 기록한다.

합성 fixture는 추후 `tests/fixtures/`에 두고 줄바꿈·BOM·지원하지 않는 인코딩 바이트를 그대로 추적한다. `.gitattributes`가 이 경로의 자동 줄바꿈 변환을 제외한다. 실제 개인 Vault를 테스트 자료로 복사하지 않는다. 설치 파일은 `dist/`·`artifacts/`, 머신별 상태는 OS 사용자 경로에 두며 Git에서 제외한다.

00 Herdr 연결 검증은 [bridge-verification.md](bridge-verification.md)를 따른다. HTTP GET/POST, 인증 헤더, 한글 왕복, 분리 실행 생존과 탭 수명을 실제 Herdr에서 확인한 후 코어를 확장한다. 00 probe 검증에는 합성 입력·전용 임시 상태만 사용한다. 제품 reader의 Vault 연결은 별도 기능이며, 쓰기 검증은 합성 임시 Vault에서 수행한다.

일반 cargo build/test는 default-members(코어·제품 CLI)만 선택한다. 명시적인 --workspace 검사는 tools/herdrmd-diagnostics의 기존 연결·프로세스 회귀도 실행한다. 개발 도구만 빌드하려면 cargo build -p herdrmd-diagnostics --locked를 쓴다. 독립 진단 UI는 integrations/herdr/diagnostics/herdrmd-probe다. Windows 제품 artifact는 herdrmd-windows이며 include_diagnostics가 켜진 수동 CI만 진단 artifact를 별도로 만든다.

2026-11-01 진단 분리 검증: macOS fmt/check/build/test --workspace --locked(19개), Windows 같은 검사(18개), Node 시나리오 57개와 제품/진단 mod check를 통과했다. NAS 제품 바이너리와 macOS·Windows 제품 mod를 갱신했고 Windows 실제 화면에서 별도 mode 없이 NAS 개인 볼트 목록을 확인했다. QA 탭을 닫고 앱 오류가 없음을 확인했다. 실제 IME·링크 클릭 검증의 재수행이나 GitHub CI 실행은 하지 않았다. 제품 실행 파일의 serve/service/bridge 거부와 제품 import 그래프의 진단 코드 부재를 별도로 검사한다.
