# herdrmd 작업 지침

## 범위와 구현 상태

현재는 Vault 읽기·위키링크 이동·미존재 링크의 빈 노트 생성과 00 연결 probe 단계다. 기존 본문 편집·저장·교체·추가는 아직 없다. 요청된 태스크 범위만 구현하고, 예정 기능을 이미 지원하는 것처럼 문서화하지 않는다. Rust 버전은 `rust-toolchain.toml`, 실행 파일 의존성은 추적하는 `Cargo.lock`을 기준으로 한다.

## 책임과 배치

- `crates/herdrmd-core`: Vault·경로·원문·검색·링크·저장·복구·초안. CLI, HTTP, Herdr에 의존하지 않는다.
- `crates/herdrmd`: 코어를 사용하는 CLI, `serve` 모드, 공식 Obsidian CLI 연결과 플랫폼별 실행·설치. 별도 서비스 crate를 만들지 않는다.
- `integrations/herdr`: JS mod·서비스 클라이언트·화면과 향후 병합용 키 설정. 파일 처리 규칙은 Rust 코어에 둔다.
- `agent-skills`: 향후 배포 패키지. 개인 skill 원본은 기존 APM 저장소에서 관리하고 내보낸다. 양쪽을 별도로 편집하지 않는다.
- `tests/fixtures`, `tests/scenarios`: 향후 합성 자료와 공통 인수 시나리오. 단위 테스트는 해당 Rust 모듈, crate 통합 테스트는 각 `tests/`에 둔다.
- `docs`: 제품 기술 계약과 결정. 개인 계획·진행 기록은 Obsidian에 둔다.

최종 트리와 사용자 데이터 경계는 `docs/architecture.md`를 따른다. 모듈은 해당 태스크를 시작할 때 만들며 빈 폴더용 `.gitkeep`은 추가하지 않는다.

## 파일과 플랫폼 원칙

- 실제 Vault 문서, 개인 설정, 토큰, 초안, 복구 자료를 제품 저장소나 fixture에 넣지 않는다. 쓰기 검증은 합성 임시 Vault에서 수행한다.
- 사용자 설정·데이터·로컬 상태·캐시는 OS별 경로 선택 모듈 하나에서 결정한다. Windows 경로를 macOS 문자열 치환으로 만들지 않는다.
- Rust 경로·파일 API를 사용한다. 제품 동작을 `sh`, `find`, `awk` 같은 셸 명령에 의존시키지 않는다.
- 저장은 공통 코어에 둔다. revision 비교와 복구 기록을 유지하며 실패 시 원본 잘라 쓰기로 전환하지 않는다. 외부 작성자가 herdrmd 잠금을 따르지 않는 한계를 명시한다.
- 원문과 미리보기 변환 결과를 분리한다. 지원하지 않는 문법과 원문 바이트를 조용히 바꾸지 않는다.
- 공식 `obsidian` 명령과 기존 upstream skills를 덮어쓰거나 호환되지 않는 명령으로 자동 대체하지 않는다.

## 검증과 기록

변경에 맞는 검증 후 다음 기본 검사를 실행한다.

```sh
cargo fmt --check
cargo check --workspace --locked
cargo build --workspace --locked
cargo test --workspace --locked
```

macOS·Windows CI를 유지한다. CI 성공과 실제 Herdr 화면 검증을 구분해 기록한다. 연결·Vault 읽기·위키링크·빈 문서 생성에는 단위/통합 테스트가 있으며 기존 본문 저장·복구 테스트는 후속 기능에 맞게 추가한다. 줄바꿈 fixture는 `.gitattributes`에서 변환을 제외한다.

작업 완료 시 기술 계약은 저장소 문서에 반영한다. Obsidian 기록 작업이 요청된 경우 해당 태스크의 결과·검증·커밋과 프로젝트 허브의 현재 단계·다음 행동을 갱신한다. 추가 AGY CLI 호출은 사용자가 요청한 경우에만 수행한다.
