# 구성과 물리적 배치

제품은 두 crate의 Vault 등록·목록·원문 코어/CLI와 Herdr reader다. 00 probe는 별도 개발 도구 tools/herdrmd-diagnostics와 diagnostics/herdrmd-probe로 옮겨 기본 빌드·제품 의존성과 배포에서 제외한다. 위키링크 해석과 미존재 대상의 빈 노트 생성도 구현했다. 기존 본문 교체 저장·클라이언트 초안은 구현했으며 검색은 미구현이다. [편집 계약](editing.md)을 따른다. 아래 트리는 이후 기능을 배치할 기준이며, 아직 쓰지 않는 하위 폴더는 생성하지 않는다.

```text
herdrmd/
├── AGENTS.md
├── README.md
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── .gitignore
├── .gitattributes
├── crates/
│   ├── herdrmd-core/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── vault/        # 등록·경로·목록
│   │   │   ├── document/     # 원문·인코딩·revision
│   │   │   ├── markdown/     # 미리보기·링크 해석
│   │   │   ├── search/       # 파일명·본문 검색
│   │   │   ├── storage/      # 저장·잠금·복구·초안
│   │   │   └── platform/     # OS별 파일·사용자 경로 처리
│   │   └── tests/
│   └── herdrmd/
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs
│       │   ├── cli/          # 인수·출력·종료 코드
│       │   ├── service/      # 향후 제품 HTTP·인증·수명 (미구현)
│       │   ├── integrations/ # Herdr·공식 Obsidian CLI
│       │   └── platform/     # 분리 실행·설치
│       └── tests/
├── integrations/
│   └── herdr/
│       ├── mods/herdrmd/
│       │   ├── mod.json
│       │   ├── main.js
│       │   ├── reader-model.js
│       │   └── views/
│       └── keys.json         # 기존 키 설정에 병합할 정의
├── agent-skills/
│   └── ops-herdrmd/          # APM 원본에서 내보낸 배포 패키지
├── tests/
│   ├── fixtures/             # 합성 Markdown·Vault
│   └── scenarios/            # CLI/UI 공통 인수 시나리오
├── docs/
│   ├── architecture.md
│   ├── cli.md
│   ├── protocol.md
│   ├── development.md
│   └── decisions/
└── .github/workflows/ci.yml
```

코어는 CLI·HTTP·Herdr를 의존하지 않는다. 일반 CLI는 Herdr·Obsidian·서비스가 꺼져 있어도 코어를 직접 호출한다. 현재 reader는 짧은 CLI JSON 호출로 같은 호스트의 코어를 사용한다. 제품에는 HTTP serve가 없다. 00 HTTP serve는 독립 진단 실행 파일에서만 제공하며 제품 서비스 API는 후속이다. UI의 렌더링·편집 입력·포커스·단축키만 JavaScript에서 담당한다.

| 종류 | 물리적 위치 | 관리 방식 |
| --- | --- | --- |
| 코드·공용 문서·합성 테스트 | 제품 저장소 | Git 추적 |
| 계획·TODO·진행·결정 이유 | 개인 Obsidian 볼트 | 프로젝트·태스크 허브 |
| 설치된 mod | Herdr 설정 폴더의 `mods/herdrmd` | 제품 소스에서 설치 |
| Vault 등록·개인 설정 | OS 사용자 설정 디렉터리 | Git 제외 |
| 초안·복구 기록 | OS 사용자 데이터 디렉터리 | Vault 밖에 보관 |
| 토큰·서비스 연결·잠금 | OS 사용자 로컬 상태 디렉터리 | 동기화·배포 제외 |
| 검색 캐시·로그 | OS 사용자 캐시 디렉터리 | 재생성 가능 |

다음은 논리적인 상대 경로다. 설정과 데이터의 `herdrmd` 루트는 OS 정책에 따라 서로 다른 물리적 위치일 수 있다. 현재 코어의 platform 모듈이 OS별 위치를 선택하고 등록 시 config 아래 registry.json과 registry.lock만 만든다. 빈 노트 생성은 data/recovery와 state/locks를 사용한다. 클라이언트 초안·중계 요청은 data/client-drafts와 data/client-requests를 사용한다. 제품 서비스는 후속이다. 실제 선택 정책은 [Vault 연결](vault-connection.md)에 기록한다.

```text
<config>/herdrmd/registry.json
<data>/herdrmd/client-drafts/draft-<connection-document-key>.json
<data>/herdrmd/client-drafts/recovered-<id>.json
<data>/herdrmd/client-requests/request-<id>.json
<data>/herdrmd/recovery/<vault-id>/<operation-id>/
<local-state>/herdrmd-runtime/service.json
<local-state>/herdrmd-runtime/locks/
<cache>/herdrmd-cache/index/
<cache>/herdrmd-cache/logs/
```

OS 경로 선택은 코어의 한 모듈에서 관리한다. 잠금·토큰은 Windows에서도 사용자 로컬 위치를 사용하며 동기화되는 Vault에 넣지 않는다. 실제 OS별 절대 경로·권한은 01 태스크에서 정하고 Windows에서 검증한다.

현재 읽기는 UTF-8/BOM·줄바꿈·마지막 개행 메타데이터와 원본 바이트의 BLAKE3 revision을 반환한다. 본문은 UTF-8의 단일 줄바꿈 형식에서 편집·저장할 수 있으며 혼합 줄바꿈과 미지원 인코딩은 읽기 전용이다. 지원하지 않는 인코딩은 text를 null로 반환해 조용한 변환을 피한다. 심볼릭 링크·junction/reparse 경로와 특수 파일 읽기를 거부한다. 저장은 원문을 보존하고 하드링크 쓰기를 거부한다. 감시는 변경 힌트이며 저장 전 실제 파일을 재조회한다.

저장은 Vault별 OS 잠금 → 재조회·revision 비교 → 복구 기록 → 같은 디렉터리의 임시 파일 → 재검사 → 교체 순서로 구현한다. 생성은 기존 파일을 덮어쓰지 않는다. Obsidian 등 외부 작성자는 잠금을 따르지 않으므로 검사와 교체 사이의 경쟁을 완전히 막는다고 보장하지 않는다. 관찰한 원본과 작성본을 보존하고 실패 시 원본 직접 잘라 쓰기로 전환하지 않는다. 초안·복구 자료는 자동 만료시키지 않고 명시적으로 정리한다.

현재 생성 경로는 Vault 잠금 → 링크 재조회 → expected revision 없음(null)과 빈 작성본 revision을 가진 prepared 기록 → 같은 폴더 임시 파일 → 경계 재검사 → no-clobber 공개 → completed 기록이다. 기존 파일 교체는 revision 검사·원본/작성본 복구 기록 후 수행한다. append·일반 복구 관리 명령은 아직 없다. 자세한 제한은 [Vault 연결](vault-connection.md)을 따른다.

진단 분리: workspace default-members는 제품 두 crate만 포함한다. 명시적인 cargo build/test --workspace는 개발 진단 도구도 검증한다. 제품 CLI는 진단 crate를 의존하지 않고 제품 mod는 진단 JS를 import하지 않는다. 제품 패키지 herdrmd-windows/herdrmd-reader-linux-x64에는 진단 파일을 넣지 않으며, include_diagnostics를 켠 수동 CI만 별도 herdrmd-diagnostics-windows artifact를 만든다.
