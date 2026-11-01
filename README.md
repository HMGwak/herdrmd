# herdrmd

Herdr 안에서 Obsidian Vault의 Markdown을 읽고 편집하고, 에이전트가 독립적인 CLI로 같은 Vault에 접근하도록 만드는 Rust 프로젝트다. macOS에서 먼저 사용하며 Windows 빌드와 테스트를 함께 유지한다. Herdr 화면 연결에는 얇은 JavaScript mod를 사용한다.

현재는 **Vault 읽기·원문 편집·자동 저장·체크박스 토글·위키링크 이동과 빈 노트 생성**을 제공한다. Vault 등록·폴더 목록·Markdown 원문 읽기와 BOM·줄바꿈·BLAKE3 revision 조회를 구현했다. Herdr에서 폴더 트리·문서 탭·프론트매터 속성·읽기/편집 전환으로 문서를 읽을 수 있다. 볼트 설정에는 현재 폴더 경로와 향후 경로 선택 진입점을 둔다. 위키링크를 누르면 볼트 안의 Markdown 파일명을 찾아 열고, 대상이 없으면 빈 `.md`를 생성해 연다. 경로가 없는 새 링크는 볼트 루트에 생성하며 폴더 경로가 있으면 그 경로에 생성한다. 중복·불완전 조회는 임의 생성하지 않는다. 원문은 1초 자동 저장과 즉시 저장을 지원하며 클라이언트 초안을 보관한다. [저장 계약](docs/editing.md)에 충돌·복구·지원 형식을 기록한다. 검색·append·복구 관리 명령과 완성된 에이전트 CLI는 후속 범위다.

Mac·NAS 볼트를 Windows Herdr에서 보는 절차와 읽기 범위는 [Vault 연결](docs/vault-connection.md)을 따른다. 문서는 원래 호스트에 두고 기존 core 머신 연결을 통해 읽는다. 설치한 `+ → Obsidian 볼트 열기`에서 NAS 개인·회사 등 설정한 볼트를 선택한다. [메뉴·NAS 설치 안내](docs/open-menu.md)에 사용자 설정과 준비 절차를 기록했다.

Windows에서 `no mod folder`가 보이면 [Windows 설치 안내](docs/windows.md)를 따른다. mod는 각 데스크톱 클라이언트에 설치해야 하며, Mac의 Space·탭에 연결하는 것만으로 Windows에 설치되지는 않는다.

```sh
cargo run -p herdrmd
cargo fmt --check
cargo check --workspace --locked
cargo test --workspace --locked
```

Rust `1.94.0`과 rustfmt가 필요하다. rustup 사용 시 `rust-toolchain.toml`이 버전을 선택한다. 인수 없는 실행은 도움말을 출력하며 개인 Vault를 읽거나 수정하지 않는다. 00 검증은 별도 개발 도구 [herdrmd-diagnostics](tools/herdrmd-diagnostics/README.md)를 사용한다. 일반 빌드·실행의 default-members는 코어와 제품 CLI만 선택한다.

현재 파일은 다음과 같다. 기능별 하위 모듈과 통합 파일은 해당 작업을 시작할 때 만든다.

```text
herdrmd/
├── AGENTS.md
├── README.md
├── Cargo.toml / Cargo.lock / rust-toolchain.toml
├── .gitignore / .gitattributes
├── crates/
│   ├── herdrmd-core/     # 공통 Rust 라이브러리
│   └── herdrmd/          # 제품 CLI
├── tools/herdrmd-diagnostics/ # 기본 빌드·제품 배포에서 제외
├── integrations/herdr/mods/herdrmd/ # 제품 reader
├── integrations/herdr/diagnostics/herdrmd-probe/ # 독립 진단 mod
├── docs/                # 기술 계약과 개발 안내
└── .github/workflows/ci.yml
```

구성과 최종 폴더 배치는 [architecture](docs/architecture.md), [CLI 계약](docs/cli.md), [서비스 계약](docs/protocol.md), [개발 안내](docs/development.md), [초기 구조 결정](docs/decisions/0001-workspace-layout.md)에 기록한다. 각 문서의 기능 계약은 구현 목표이며 현재 구현 상태와 구분한다.

구현 순서는 연결 검증 → Vault·원문 → 저장·복구 → 검색·링크 → 독립 CLI → 서비스·초안 → Herdr 화면 → 공식 Obsidian CLI·skills → 설치·릴리스다. 상세 TODO와 진행 기록은 개인 Obsidian 프로젝트 허브 `1_Project/herdrmd/herdrmd.md`에서 관리한다. 개인 계획과 실제 Vault 자료는 이 저장소에 복제하지 않는다.

로컬 문서에서 Codex를 여는 [ASK AGENT 연결](docs/ask-agent.md)을 제공한다. 원격 Vault/Space에서는 비활성화된다.
