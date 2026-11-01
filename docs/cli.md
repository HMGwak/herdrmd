# CLI 계약

읽기 전용 `vault add <name> <absolute path>`, `vault list`, `files/read --vault <name> --path <relative path>`, `paths`도 구현했다. 현재는 JSON이 기본 출력이고 명시적인 등록명과 경로를 요구한다. [Vault 연결](vault-connection.md)에 정확한 사용법과 제한을 기록한다. `follow`는 없는 위키 대상의 빈 노트 생성도 수행한다. 아래 일반 CLI 목표의 자동 Vault 선택·검색·안정적인 세부 오류 코드는 아직 제공하지 않는다.

제품에는 serve/service/bridge 진단 명령이 없다. 00 검증은 별도 herdrmd-diagnostics 실행 파일에서만 제공하며 [검증 절차](bridge-verification.md)를 따른다. 아래의 제품 serve/service는 향후 목표이고 현재 진단 도구의 별칭으로 연결하지 않는다.

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

## 읽기 전용 위키 대상 조회

현재 구현한 명령은 `herdrmd resolve --vault <등록명> --from <현재 상대경로.md> --target <위키 대상>`이다. JSON status는 found/ambiguous/not_found/incomplete이며 matches는 실제 Vault 상대경로 배열, fragment는 제목/블록 문자열 또는 null, truncated는 완전 조회 여부다. `--config-dir`은 다른 Vault 명령과 같이 마지막에 지정한다. 조회 경계·이름 비교·후보 선택은 [Vault 연결](vault-connection.md)의 위키링크 계약을 따른다. 생성·수정이나 프론트매터 aliases 조회는 수행하지 않는다.

## 위키링크 열기와 빈 노트 생성

`herdrmd follow --vault <등록명> --from <현재 상대경로.md> --target <위키 대상>`은 UI 링크 클릭에 사용한다. 기존 대상을 조회하고 완전한 not_found일 때만 빈 UTF-8 `.md`를 생성해 found로 반환한다. resolve와 같은 응답에 created boolean을 포함하며 실제 생성했을 때만 true다. resolve는 계속 조회만 수행하고 created는 false다. `--config-dir`은 registry 위치만 바꾸며 잠금/기록은 실행 호스트의 기본 OS 사용자 state/data 경로를 사용한다. 테스트에서는 해당 프로세스의 사용자 경로 환경 변수를 임시 위치로 분리한다.

## 링크 조회와 본문을 한 번에 받기

`follow-read --vault <등록명> --from <현재.md> --target <대상>`은 `{resolution, document}`를 반환한다. resolution은 follow와 같고 complete found 한 개일 때만 같은 호출에서 코어 read의 document를 포함한다. 그 외 document는 null이다. UI는 일치하는 경로의 원문 스냅샷을 바로 표시해 별도 read 왕복을 생략한다. read 실패는 stderr·비정상 종료로 반환하며 생성 뒤 읽기 실패 시 파일이 이미 만들어졌을 수 있다. 기존 resolve/follow/read 계약은 유지한다.

## 기존 본문 저장과 클라이언트 중계

`write --vault <등록명> --path <상대경로.md> --expected-rev <revision> --stdin`은 UTF-8 본문을 stdin으로 받고 새 Document JSON을 반환한다. 원문 BOM과 단일 줄바꿈 형식을 유지한다. revision 불일치·미지원 인코딩·혼합 줄바꿈·경계 이탈·권한 오류는 실패이며 원본을 직접 잘라 쓰지 않는다. `--config-dir`은 마지막에 지정한다. 오류는 stderr와 종료 코드 1이다.

`relay-prepare`는 클라이언트 OS data 아래 요청·초안 디렉터리를 만들고 `{directory,drafts}`를 반환한다. `relay --request <절대 JSON 경로>`는 그 요청 디렉터리의 로컬 파일을 읽는다. 요청은 `{binary,machine?,vault,path,expected_revision,text}`다. 로컬은 제품 write를 직접 실행하고 원격은 `hc exec --stdin --on <machine> -- <binary> write ...`의 stdin으로 본문을 전달한다. 본문을 argv에 넣지 않는다. 성공 시 Document를 반환하고 요청 파일을 제거하며 실패 시 요청을 보존한다. 이는 HTTP service/bridge가 아닌 제품 CLI의 로컬 중계다. 자세한 저장·초안 수명은 [편집 계약](editing.md)을 따른다.
