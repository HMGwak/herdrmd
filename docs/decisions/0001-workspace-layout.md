# 0001 — Rust workspace와 저장소 경계

상태: 확정 · 날짜: 2026-11-01

사람은 Herdr 화면에서, 에이전트는 독립 CLI에서 같은 Markdown Vault를 사용한다. 파일 처리와 저장 규칙을 두 곳에서 구현하지 않도록 코어 라이브러리와 실행 파일을 분리한다.

- workspace는 `herdrmd-core`와 `herdrmd` 두 crate다.
- 실행 파일이 일반 CLI와 `serve` 모드를 함께 제공한다. 코어는 CLI·HTTP·Herdr를 의존하지 않는다.
- Herdr JS mod는 화면과 HTTP 연결만 담당한다. 소스는 향후 `integrations/herdr`에 둔다.
- 모듈과 테스트 디렉터리는 해당 작업을 시작할 때 만든다. 빈 폴더와 가짜 mod·skill 파일은 만들지 않는다.
- 실행 파일 프로젝트이므로 `Cargo.lock`을 추적한다. 초기 Rust는 로컬 검증 가능한 `1.94.0`으로 고정한다.
- macOS·Windows CI를 처음부터 유지한다. 실제 UI 검증을 CI 성공으로 대신하지 않는다.
- 확정 기술 계약은 제품 `docs`, 계획·TODO·진행 기록은 개인 Obsidian에 둔다.
- skill의 개인 원본은 기존 APM에서 관리하고 `agent-skills`로 내보낸다. 이중 편집을 허용하지 않는다.
- 사용자 설정·초안·복구·토큰·잠금·캐시는 Vault와 제품 저장소 밖의 OS별 디렉터리로 분리한다.

이 결정은 배치와 의존 방향을 고정한다. 도메인 기능, OS별 절대 경로, API 세부 스키마와 Herdr 연결 동작은 이후 태스크에서 구현·검증한다.
