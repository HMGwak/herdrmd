# 로컬 Vault의 ASK AGENT

문서 상단의 `ASK AGENT`는 현재 문서 pane의 오른쪽에 Codex를 연다. Herdr 앱·Vault·Codex가 같은 컴퓨터에 있어야 한다. `machine`으로 연결한 원격 Vault 또는 원격 Space에서는 버튼을 비활성화하고 로컬 전용 툴팁을 표시한다. 실행 시에도 이를 다시 확인한다.

클릭 순간 native focus의 문서 pane ID와 소속 탭·Space를 고정한다. 비동기 작업 이후 전역 focus를 다시 사용해 분할 대상을 추측하지 않는다. pane이 사라지거나 다른 탭/Space로 이동하면 실행하지 않는다. mod를 임의의 layout block으로 넣는 방식은 지원하지 않으며 실제 `herdrmd` mod pane에서 실행한다.

실행 순서는 다음과 같다.

1. 선택 문서의 읽기·초안 상태를 검사한다. 초안 복구 확인, 읽기 오류, 기존 저장 실패가 있으면 기존 오류를 표시하며 자동으로 재시도하지 않는다.
2. 로컬 제품 CLI의 `vault list`에서 선택한 등록명의 절대 경로를 얻는다. 다른 pane의 cwd나 현재 프로젝트 경로로 대체하지 않는다.
3. `home()/.codex/skills/obsidian-markdown/SKILL.md`를 읽고, 등록 경로를 cwd로 `codex --version`을 실행해 skill·Codex·디렉터리를 확인한다. 다운로드나 설치를 클릭 중에 수행하지 않는다.
4. 현재 문서의 정상적인 미저장 변경을 기존 EditModel로 flush한다. 이후 오류·dirty·loading 상태와 선택 문서·원본 pane을 다시 검사한다.
5. `herdr-app do pane.split`에 명시적 `pane`, `direction: right`, `argv`를 전달한다. `exec` 인수 배열과 JSON으로 전달하므로 셸 문자열을 만들지 않는다. 명령 응답의 새 pane ID를 보관한다.

argv는 `codex --no-daemon -m gpt-6-luna -c 'model_reasoning_effort="max"' -C <등록 Vault 절대 경로> <초기 메시지>`다. 사용자 요청에 따라 이 버튼의 실행에만 Luna/max를 지정한다. 전역 Codex 모델 설정은 수정하지 않으며 권한·인증은 사용자 설정을 따른다. 승인 우회·sandbox 옵션은 넣지 않는다. 초기 메시지는 Vault 절대 경로, 현재 문서의 Vault 상대 경로, skill 파일 경로와 “기존 Vault 지침과 skill을 읽은 뒤 질문을 기다리고 아직 수정하지 말라”는 안내만 포함한다. 본문·다른 대화·원격 접속 설정은 전달하지 않는다.

연속 클릭은 진행 중 잠금으로 합쳐진다. 이 reader가 연결한 pane이 남아 있으면 재실행하지 않고 그 pane으로 이동한다. 에이전트가 종료되어 pane이 없어지면 다음 클릭으로 새로 실행할 수 있다. 문서 선택 변경은 자동으로 재주입하지 않는다. 연결 ID는 reader 인스턴스 수명 동안만 유지되므로 앱 재시작/mod 재로딩 후에는 이전 에이전트를 자동 재연결하지 않는다. 문서나 reader를 닫아도 에이전트는 종료하지 않는다.

## 설치

공식 `kepano/obsidian-skills`의 `skills/obsidian-markdown` 디렉터리 전체(SKILL.md와 references)를 Mac의 `~/.codex/skills/obsidian-markdown`에 원본 그대로 설치한다. 기존 설치가 있으면 보존한다. 공식 Obsidian 명령이나 upstream skill을 대체하지 않는다. 사용자 지정 CODEX_HOME 탐지는 이번 범위에 포함하지 않는다.

제품 mod의 모든 JS 보조 모듈을 함께 배포하고 `herdr-app check`로 확인한다. Mac의 로컬 reader 진입 탭은 로컬 registry의 등록명과 로컬 binary를 props로 전달한다. Windows/NAS launcher와 기존 탭은 변경할 필요가 없다.

## 범위와 검증

후속 검색·읽기·편집은 일반 터미널 에이전트가 수행하며 herdrmd 전용 명령을 요구하지 않는다. 에이전트의 직접 파일 편집은 Rust 저장 코어를 거치지 않는다. 외부 작성자와 동시 저장하는 한계는 기존 저장 계약과 같고, 변경 확인에는 수동 새로고침을 사용한다. 자동 문서 갱신·RAG 인덱스는 제공하지 않는다.

2026-11-01: 합성 한글·공백 경로에서 실제 Mac Herdr의 오른쪽 Codex 실행, 초기 인수, Codex 작업 루트, skill 확인 후 질문 대기(Luna/max 포함), pane 재사용·종료 후 재실행과 원본 reader 종료 후 에이전트 생존을 확인했다. 앱 명령과 스크린샷으로 검증했으며 물리 마우스 클릭 검증은 아니다. 원격 Vault/Space 차단·누락 의존성·읽기/복구/저장 실패·실행 전 원본 종료·문서/탭 이동은 Node 시나리오로 검증한다. GitHub CI는 실행하지 않았다. Windows 실기 검증과 별개다.

최종 로컬 검증: Node 시나리오 100개, Rust workspace 테스트 28개 및 fmt/check/build/test --locked, 소스·Mac 설치본 mod check 통과. 합성 Vault의 파일 집합·원문 보존을 확인하고 검증 탭·에이전트·자료를 정리했다. 설치본은 백업 후 반영하고 소스와 바이트 일치를 확인했다. 검증 중 기존 Windows 연결의 SSH timeout이 별도로 관찰됐으며 이 작업에서 원격 설정은 변경하지 않았다.
