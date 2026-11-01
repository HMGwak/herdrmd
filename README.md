# herdrmd

Herdr 안에서 Obsidian Vault의 Markdown을 읽고 편집하고, 에이전트가 독립적인 CLI로 같은 Vault에 접근하도록 만드는 Rust 프로젝트다. macOS에서 먼저 사용하며 Windows 빌드와 테스트를 함께 유지한다. Herdr 화면 연결에는 얇은 JavaScript mod를 사용한다.

현재는 **00 연결 검증용 HTTP 서비스와 Herdr mod**를 구현하는 단계다. 인증된 GET·한글 POST echo, 분리 실행·재사용·종료와 UI 이벤트 관찰만 제공한다. Vault 접근·파일 저장·일반 에이전트 CLI·초안은 아직 구현하지 않았다.

Windows에서 `no mod folder`가 보이면 [Windows 설치 안내](docs/windows-bridge.md)를 따른다. mod는 각 데스크톱 클라이언트에 설치해야 하며, Mac의 Space·탭에 연결하는 것만으로 Windows에 설치되지는 않는다.

```sh
cargo run -p herdrmd
cargo fmt --check
cargo check --workspace --locked
cargo test --workspace --locked
```

Rust `1.94.0`과 rustfmt가 필요하다. rustup 사용 시 `rust-toolchain.toml`이 버전을 선택한다. 인수 없는 실행은 도움말을 출력하며 개인 Vault를 읽거나 수정하지 않는다. 실제 Herdr 연결 검증 절차와 한계는 [bridge 검증](docs/bridge-verification.md)을 따른다.

현재 파일은 다음과 같다. 기능별 하위 모듈과 통합 파일은 해당 작업을 시작할 때 만든다.

```text
herdrmd/
├── AGENTS.md
├── README.md
├── Cargo.toml / Cargo.lock / rust-toolchain.toml
├── .gitignore / .gitattributes
├── crates/
│   ├── herdrmd-core/     # 공통 Rust 라이브러리
│   └── herdrmd/          # CLI 및 같은 실행 파일의 serve 모드
├── integrations/herdr/mods/herdrmd/ # 연결 검증용 JS mod
├── docs/                # 기술 계약과 개발 안내
└── .github/workflows/ci.yml
```

구성과 최종 폴더 배치는 [architecture](docs/architecture.md), [CLI 계약](docs/cli.md), [서비스 계약](docs/protocol.md), [개발 안내](docs/development.md), [초기 구조 결정](docs/decisions/0001-workspace-layout.md)에 기록한다. 각 문서의 기능 계약은 구현 목표이며 현재 구현 상태와 구분한다.

구현 순서는 연결 검증 → Vault·원문 → 저장·복구 → 검색·링크 → 독립 CLI → 서비스·초안 → Herdr 화면 → 공식 Obsidian CLI·skills → 설치·릴리스다. 상세 TODO와 진행 기록은 개인 Obsidian 프로젝트 허브 `1_Project/herdrmd/herdrmd.md`에서 관리한다. 개인 계획과 실제 Vault 자료는 이 저장소에 복제하지 않는다.
