# 개인 Vault 읽기 연결

현재 기능은 등록된 Markdown Vault의 폴더 목록과 원문 읽기다. 저장·삭제·새 노트·검색·위키링크 해석은 제공하지 않는다. Obsidian 앱 실행이나 공식 obsidian CLI는 필요하지 않으며 기존 설정도 수정하지 않는다.

## 호스트에서 등록

Vault가 실제로 있는 호스트에서 실행한다. 이름은 영숫자·하이픈·밑줄을 허용한다. 같은 실제 경로를 다시 등록하면 기존 항목을 반환하고, 다른 경로에 이미 사용한 이름은 거부한다. 식별자는 정규화한 경로의 BLAKE3 값으로 경로를 바꾸지 않는 동안 유지한다. rename/move 추적은 아직 없다.

```sh
cargo build --workspace --locked
target/debug/herdrmd vault add personal /absolute/path/to/personal-vault
target/debug/herdrmd vault list
target/debug/herdrmd files --vault personal --path ''
target/debug/herdrmd read --vault personal --path 'folder/note.md'
target/debug/herdrmd paths
```

항상 JSON을 출력하며 오류는 stderr와 비정상 종료 코드로 전달한다. `--config-dir <절대 경로>`를 마지막에 지정하면 테스트용 registry 위치를 분리할 수 있다. config는 Vault 밖이어야 한다. 서비스 없이 코어를 직접 사용한다.

## OS 사용자 경로

| OS | config | data | state | cache |
| --- | --- | --- | --- | --- |
| macOS | `~/Library/Application Support/herdrmd/config` | 같은 루트의 `data` | 같은 루트의 `runtime` | `~/Library/Caches/herdrmd` |
| Windows | `%APPDATA%/herdrmd` | `%LOCALAPPDATA%/herdrmd/data` | 같은 루트의 `runtime` | 같은 루트의 `cache` |
| Linux | `$XDG_CONFIG_HOME/herdrmd` | `$XDG_DATA_HOME/herdrmd` | `$XDG_STATE_HOME/herdrmd` | `$XDG_CACHE_HOME/herdrmd` |

Linux에서 XDG 변수가 없으면 사용자 홈의 `.config`, `.local/share`, `.local/state`, `.cache`를 쓴다. 경로 선택은 코어 platform 한 곳에서 담당한다. 등록은 config만 만들고 registry 잠금 아래 임시 파일을 같은 폴더에 쓴 뒤 교체한다. Unix config는 0700, 새 registry/lock은 0600이다. Windows는 사용자 설정 폴더의 상속 ACL을 사용하며 명시적인 ACL 강화는 후속이다. 00 HTTP probe의 임시 상태 경로는 이 제품 경로와 별개다.

## Herdr에서 보기

설치한 `+` 메뉴의 **Obsidian 볼트 열기**로 다시 여는 방법은 [메뉴 진입점](open-menu.md)을 따른다. 등록한 대상이 여러 개면 개인·회사 등의 이름으로 선택한다. NAS 직접 연결도 같은 설정을 사용한다. 볼트 설정 화면은 현재 컴퓨터·폴더 경로를 확인하는 진입점이며, 폴더 변경·등록 UI와 자동 탐지는 후속이다.

설치된 mod에는 main.js, api.js, vault-view.js와 그 보조 JS 모듈, obsidian.svg, mod.json이 필요하다. 기존 mod를 확인·백업하고 전용 폴더만 갱신한다. `herdr-app check <mod folder>`를 실행한다.

Mac 로컬 탭의 props 예시는 다음과 같다. binary는 해당 호스트의 절대 경로로 지정한다.

```json
{"mode":"vault","vault":"personal","binary":"/absolute/path/to/herdrmd","file":"folder/note.md"}
```

Windows에서 **Mac에 있는 같은 Vault**를 볼 때는 기존 herdr-core 머신 연결의 별칭을 명시한다.

```json
{"mode":"vault","vault":"personal","machine":"mac-alias","binary":"/absolute/path/on/mac/herdrmd","file":"folder/note.md"}
```

reader는 `exec(binary, args, {on: machine})`로 그 호스트의 Rust CLI를 호출한다. 따라서 볼트·registry는 Mac에 남고 Windows에 복제하지 않는다. SSH 연결 인증은 기존 core가 담당하며 HTTP 토큰을 복사하거나 새 포트를 공개하지 않는다. `machine` 생략은 데스크톱 클라이언트 로컬 실행이며 Space 선택만으로 대상을 추측하지 않는다. 이 읽기 전용 초기 연결은 짧은 CLI JSON 응답을 사용한다. 00의 HTTP probe는 별도 모드이며 후속 서비스·초안 API 계약을 대체하지 않는다.

## 읽기 화면과 설정

폭 620px 이상에서는 왼쪽 파일 탐색기와 중앙 문서를 함께 표시한다. 탐색기는 현재 폴더의 자식만 조회하고 루트·상위 폴더로 이동한다. 전체 Vault를 미리 재귀 탐색하는 트리는 아니다. 좁은 pane에서는 상단 탐색기/문서 버튼으로 한 영역씩 표시한다. 파일명·현재 경로·연결명은 긴 경우 줄이고 툴팁에 전체 값을 표시한다.

Markdown 파일을 고르면 화면 안의 문서 탭에 열고 **읽기 / 원문**을 전환한다. 읽기는 Herdr의 네이티브 Markdown TextView, 원문은 readonly Editor다. 원문 선택·복사는 가능하지만 편집·저장하지 않는다. 읽기 결과의 text를 그대로 전달하며 인코딩·BOM·줄바꿈 메타데이터는 하단에 표시한다. 지원하지 않는 인코딩은 변환하지 않고 안내한다. Obsidian 전용 위키링크·임베드·Live Preview를 구현한 것은 아니며, 기본 Markdown 렌더러로 표시가 어려운 문법은 원문으로 확인한다. HTTP(S) 링크는 클릭할 때 시스템 브라우저로 열며, 내부 링크와 다른 스킴은 탐색 준비 중 안내를 표시한다.

한 화면에서 문서를 여러 탭으로 열고 닫을 수 있다. 탭 전환은 이미 읽은 메모리 사본을 사용하고 **새로고침**으로 현재 폴더와 선택 문서를 다시 읽는다. 외부 Sync 변경을 자동 감지하지 않으며 탭/스크롤 상태를 디스크에 저장하지 않는다. 로딩·빈 폴더·연결 오류·다시 읽기를 구분한다. 요청 순번과 종료 상태를 검사해 늦은 성공/실패가 최신 문서·폴더 또는 이미 닫은 reader를 덮지 않게 한다.

상단 **설정**은 현재 연결의 컴퓨터와 실제 Markdown 폴더 경로를 같은 호스트의 registry에서 조회한다. 경로 확인 실패는 오류로 표시하며 로컬 폴더를 원격 경로로 추측하지 않는다. **폴더 경로 선택 · 준비 중**은 이후 직접 경로 선택을 연결할 비활성 진입점이다. 현재는 경로를 선택·등록·변경하거나 launcher.json을 쓰지 않는다. 개인/회사 선택은 기존 `+` 메뉴를 사용한다. 설정 화면에서 문서로 돌아오면 열어 둔 문서 상태를 유지한다.

`herdrmd.refresh`, `settings`, `settings-close`, `browse`, `source`, `preview`는 같은 UI 메서드를 호출한다. `open-entry-N`(1부터 시작)과 `read-first-note`는 현재 목록의 항목/첫 Markdown을 여는 앱 명령 검증에 쓴다. 실제 마우스·키 입력 검증과 구분한다.

## 경계와 검증

경로는 `/`로 구분한 Vault 상대 경로다. 절대 경로·`..`·`.`·역슬래시·Windows ADS의 콜론과 제외 경로를 거부한다. `.obsidian`, `.git`, `.trash`, `.herdrmd`, `.herdrmd-*`는 목록과 직접 접근에서 제외한다. 링크·Windows reparse point·특수 파일은 읽지 않는다. 문서는 최대 1 MiB, 폴더 목록은 최대 1,000개이며 더 있으면 truncated를 반환한다. Unicode가 아닌 파일명은 목록에서 제외한다.

UTF-8 BOM은 text에서만 분리하고 bom 필드에 기록한다. revision은 BOM을 포함한 원본 전체 바이트로 계산한다. LF·CRLF·CR·혼합·끝 개행 여부를 반환하고 UTF-8이 아니거나 NUL이 있으면 encoding은 unsupported, text는 null이다. 변환하거나 파일을 저장하지 않는다. 경로를 읽기 전후 검사하고 최종 파일의 no-follow 열기를 적용하지만 동일 사용자 권한으로 디렉터리를 악의적으로 동시에 바꾸는 프로세스에 대한 완전한 파일시스템 격리는 제공하지 않는다.

합성 임시 Vault 테스트는 원문·BOM/CRLF·revision·제외 규칙·경계 이탈·크기 제한·등록 충돌/손상 보존·링크 거부를 검증한다. Windows CI에는 실제 mklink /J로 만든 junction 거부 검사가 있다. 별도 CLI 프로세스로 등록·목록·읽기를 실행하고 원본 바이트와 Vault 항목 수가 바뀌지 않았음을 검사한다. 실제 개인 노트는 테스트 자료에 넣지 않는다.

ReaderModel의 합성 응답 테스트는 문서/폴더의 순서가 뒤바뀐 성공·실패, 캐시 탭 전환·새로고침, 닫힌 탭·reader의 늦은 응답을 검사한다. Node 테스트는 `node --test tests/scenarios/launcher.test.mjs tests/scenarios/reader-model.test.mjs`로 실행한다. 네이티브 렌더와 좁은 pane은 실제 앱 화면에서 별도로 검증한다.

2026-11-01 Windows 실제 화면에서는 독립 임시 registry와 합성 Vault로 제목·강조·목록·표·코드 블록 미리보기, 원문 Editor, 문서 탭 두 개, 한글·공백 파일명, BOM/CRLF 표시와 좁은 pane의 탐색기/문서·설정 전환을 확인했다. 헤더·목록·본문이 전체 높이를 쓰도록 가로 컨테이너에 items_stretch를 적용했다. 검사 후 QA 탭과 합성 임시 폴더를 정리했다. 기존 NAS 개인 볼트의 실제 폴더 목록과 설정의 실제 경로도 새 화면에서 확인했으며 app status errors는 비어 있었다. 검증은 지원 앱 명령·스크린샷을 사용했고, 직접 키 입력·마우스 클릭 검증은 아니다.
