# CLI 계약

현재 구현한 명령은 `serve`, `service ensure/wait/status/stop`, `bridge report`이며 모두 명시적인 `--state-dir <절대 임시 경로>`를 요구하는 00 연결 검증용이다. `bridge location`은 상태를 만들지 않고 이 클라이언트의 기본 OS 임시 경로를 JSON으로 반환한다. 인수 없는 실행은 도움말을 출력한다. [검증 절차](bridge-verification.md)를 참고한다. 나머지 아래 명령·JSON·종료 코드 계약은 구현 목표다.

`service wait`는 외부 호스트가 시작한 서비스의 준비만 최대 5초 확인하며 프로세스를 만들지 않는다. 연결 파일 경로·프로토콜·PID를 반환하고 `reused: true`는 이미 실행 중인 서비스에 연결했다는 뜻이다. Windows Herdr는 이 명령으로 core가 관리하는 `serve`의 준비를 확인한다.

```text
herdrmd vault add/list
herdrmd files/read/search
herdrmd create/write/append
herdrmd resolve
herdrmd doctor
herdrmd recovery list/export/prune
herdrmd service ensure/status/stop
herdrmd serve
herdrmd obsidian -- <공식 CLI 인수>
```

- 파일 작업은 서비스 없이 코어를 직접 호출한다.
- Vault는 `--vault <경로 또는 등록명>`이 우선이다. 생략 시 현재 디렉터리를 포함하는 등록 Vault를 선택하고 불명확하면 실패한다.
- `--path`는 Vault 상대 경로이며 `--file`은 위키링크 방식의 이름 해석이다. 중복 후보를 임의로 선택하지 않는다.
- 쓰기 본문은 `--stdin` 또는 `--content-file`로 받는다.
- `--json` 읽기 결과는 경로·본문·원본 revision과 프로토콜 버전을 포함한다. 진단은 stderr로 출력한다.
- 기존 문서 전체 교체는 `--expected-rev`를 요구한다. 충돌 시 재조회하게 한다. `append`는 잠금 안에서 최신 내용을 읽고 덧붙이며 expected revision을 받으면 함께 검사한다.
- 사용 오류, 없음, 중복 후보, 저장 충돌, 접근 거부, 서비스 연결 실패를 안정적인 오류·종료 코드로 구분한다. 실제 숫자와 JSON 필드 스키마는 04 태스크에서 고정한다.
- 파일명·경로·본문 검색은 우선 스캔 방식으로 구현한다. 결과 상한에 도달하면 `truncated`를 표시한다.
- `doctor`는 자체 필수 상태와 선택적인 공식 Obsidian CLI 상태를 구분한다.
- 공식 CLI는 별도 도구다. 등록된 공식 Vault 이름/ID를 명시적으로 전달하고 stdout/stderr·종료 코드를 전달한다. 실행 파일이 없으면 명확히 진단하며 자체 명령으로 자동 대체하지 않는다.

에이전트 기본 경로는 검색 → 읽기 → stdin 또는 파일로 수정 → revision 검사 저장 → 재조회다. MCP는 후속 범위다. 기존 `obsidian` 실행 파일이나 upstream skills를 덮어쓰는 shim을 설치하지 않는다.
