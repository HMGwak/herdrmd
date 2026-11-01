# 개인 Vault 읽기 연결

현재 기능은 등록된 Markdown Vault의 폴더 목록과 원문 읽기다. 볼트 안의 위키링크 대상 조회와 문서 이동도 지원한다. 저장·삭제·새 노트·검색은 제공하지 않는다. Obsidian 앱 실행이나 공식 obsidian CLI는 필요하지 않으며 기존 설정도 수정하지 않는다.

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

폭 620px 이상에서는 왼쪽 파일 탐색기와 중앙 문서를 함께 표시한다. 탐색기는 루트 목록을 유지하는 트리다. 폴더를 누르면 해당 가지를 펼치고 다시 누르면 접는다. 처음 펼친 폴더의 자식만 조회하며 전체 Vault를 미리 재귀 탐색하지 않는다. 펼친 가지와 문서 선택은 서로 독립적이다. 좁은 pane에서는 상단 탐색기/문서 버튼으로 한 영역씩 표시한다. 파일명·현재 경로·연결명은 긴 경우 줄이고 툴팁에 전체 값을 표시한다.

Markdown 파일을 고르면 화면 안의 문서 탭에 열고 **읽기 / 원문**을 전환한다. 읽기는 Herdr의 네이티브 Markdown TextView, 원문은 readonly Editor다. 원문 선택·복사는 가능하지만 편집·저장하지 않는다. 원문 Editor에는 읽기 결과의 text를 그대로 전달하며 인코딩·BOM·줄바꿈 메타데이터는 하단에 표시한다. 읽기 화면에서는 파일 첫머리의 닫힌 `---` 프론트매터 구간을 작은 속성 영역으로 분리하고 나머지 본문만 Markdown으로 렌더링한다. 지원하지 않는 인코딩은 변환하지 않고 안내한다. 위키링크 문서 이동 외 Obsidian 전용 임베드·Live Preview는 구현하지 않았으며, 기본 Markdown 렌더러로 표시가 어려운 문법은 원문으로 확인한다. HTTP(S) 링크는 클릭할 때 시스템 브라우저로 열며, 위키링크는 아래 계약으로 내부 문서를 열고, 일반 Markdown 상대 링크와 그 밖의 스킴은 아직 탐색하지 않는다.

한 화면에서 문서를 여러 탭으로 열고 닫을 수 있다. 탭 전환은 이미 읽은 메모리 사본을 사용하고 **새로고침**으로 루트·현재 펼친 폴더들과 선택 문서를 다시 읽는다. 외부 Sync 변경을 자동 감지하지 않으며 탭/스크롤 상태를 디스크에 저장하지 않는다. 로딩·빈 폴더·연결 오류·다시 읽기를 구분한다. 요청 순번과 종료 상태를 검사해 늦은 성공/실패가 최신 문서·폴더 또는 이미 닫은 reader를 덮지 않게 한다.

상단 **설정**은 현재 연결의 컴퓨터와 실제 Markdown 폴더 경로를 같은 호스트의 registry에서 조회한다. 경로 확인 실패는 오류로 표시하며 로컬 폴더를 원격 경로로 추측하지 않는다. **폴더 경로 선택 · 준비 중**은 이후 직접 경로 선택을 연결할 비활성 진입점이다. 현재는 경로를 선택·등록·변경하거나 launcher.json을 쓰지 않는다. 개인/회사 선택은 기존 `+` 메뉴를 사용한다. 설정 화면에서 문서로 돌아오면 열어 둔 문서 상태를 유지한다.

`herdrmd.refresh`, `settings`, `settings-close`, `browse`, `source`, `preview`는 같은 UI 메서드를 호출한다. `open-entry-N`(1부터 시작)과 `read-first-note`는 현재 보이는 트리의 항목/첫 Markdown을 여는 앱 명령 검증에 쓴다. `collapse-all`은 폴더를 모두 접고 `properties`는 현재 문서의 속성 영역을 펼치거나 접는다. 실제 마우스·키 입력 검증과 구분한다.

## 경계와 검증

경로는 `/`로 구분한 Vault 상대 경로다. 절대 경로·`..`·`.`·역슬래시·Windows ADS의 콜론과 제외 경로를 거부한다. `.obsidian`, `.git`, `.trash`, `.herdrmd`, `.herdrmd-*`는 목록과 직접 접근에서 제외한다. 링크·Windows reparse point·특수 파일은 읽지 않는다. 문서는 최대 1 MiB, 폴더 목록은 최대 1,000개이며 더 있으면 truncated를 반환한다. Unicode가 아닌 파일명은 목록에서 제외한다.

UTF-8 BOM은 text에서만 분리하고 bom 필드에 기록한다. revision은 BOM을 포함한 원본 전체 바이트로 계산한다. LF·CRLF·CR·혼합·끝 개행 여부를 반환하고 UTF-8이 아니거나 NUL이 있으면 encoding은 unsupported, text는 null이다. 변환하거나 파일을 저장하지 않는다. 경로를 읽기 전후 검사하고 최종 파일의 no-follow 열기를 적용하지만 동일 사용자 권한으로 디렉터리를 악의적으로 동시에 바꾸는 프로세스에 대한 완전한 파일시스템 격리는 제공하지 않는다.

합성 임시 Vault 테스트는 원문·BOM/CRLF·revision·제외 규칙·경계 이탈·크기 제한·등록 충돌/손상 보존·링크 거부를 검증한다. Windows CI에는 실제 mklink /J로 만든 junction 거부 검사가 있다. 별도 CLI 프로세스로 등록·목록·읽기를 실행하고 원본 바이트와 Vault 항목 수가 바뀌지 않았음을 검사한다. 실제 개인 노트는 테스트 자료에 넣지 않는다.

ReaderModel의 합성 응답 테스트는 문서/폴더의 순서가 뒤바뀐 성공·실패, 캐시 탭 전환·새로고침, 닫힌 탭·reader의 늦은 응답을 검사한다. Node 테스트는 `node --test tests/scenarios/launcher.test.mjs tests/scenarios/reader-model.test.mjs tests/scenarios/frontmatter.test.mjs tests/scenarios/wikilinks.test.mjs`로 실행한다. 네이티브 렌더와 좁은 pane은 실제 앱 화면에서 별도로 검증한다.

2026-11-01 Windows 실제 화면에서는 독립 임시 registry와 합성 Vault로 제목·강조·목록·표·코드 블록 미리보기, 원문 Editor, 문서 탭 두 개, 한글·공백 파일명, BOM/CRLF 표시와 좁은 pane의 탐색기/문서·설정 전환을 확인했다. 헤더·목록·본문이 전체 높이를 쓰도록 가로 컨테이너에 items_stretch를 적용했다. 검사 후 QA 탭과 합성 임시 폴더를 정리했다. 기존 NAS 개인 볼트의 실제 폴더 목록과 설정의 실제 경로도 새 화면에서 확인했으며 app status errors는 비어 있었다. 검증은 지원 앱 명령·스크린샷을 사용했고, 직접 키 입력·마우스 클릭 검증은 아니다.

## 트리와 프론트매터 표현

폴더별 로딩·오류·다시 시도와 표시 한도를 해당 가지 아래에 표시한다. 접은 폴더는 캐시를 재사용하고 새로고침은 펼친 가지를 다시 조회한다. 읽기 전용 원문과 별도의 UI 상태다. 트리는 최대 1,500개 표시 행·2,000개 캐시 항목·64개 폴더·32단계로 제한하고 접힌 캐시부터 회수한다. 기본 Rust 폴더당 1,000개 제한과 경계 검사도 그대로 적용한다. 한도는 화면에 알리며 연결된 모든 폴더를 자동으로 조회하지 않는다.

속성은 기본적으로 작은 한 줄 요약으로 표시하며 클릭하면 키·값을 펼친다. [Obsidian의 문서 상단 속성 표시](https://obsidian.md/help/properties)를 참고한 읽기 전용 표현으로, 속성 타입 편집·검증을 구현한 것은 아니다. 파일 시작의 `---`와 닫는 `---`만 구분하며 본문의 구분선이나 닫히지 않은 블록은 제거하지 않는다. 문자열·일반 목록은 읽기 좋은 라벨로 표시하고, 생소한 YAML 문법은 작은 raw 속성 영역에서 확인한다. 완전한 YAML 평가기나 serializer를 실행하지 않는다. 펼친 속성은 처음 100개, raw 영역은 16,000자까지 표시하고 더 있으면 원문 안내를 표시한다. 원문 보기에는 프론트매터를 포함한 전체 text가 남고 원본 bytes·BOM·줄바꿈·revision은 변하지 않는다.

트리·속성 후속 검증(2026-11-01): Windows 실제 화면에서 합성 중첩 폴더의 들여쓰기·루트 유지와 프론트매터 한 줄 요약/펼친 키·값/전체 YAML 원문을 확인했다. 좁은 pane에서도 속성·본문을 함께 표시했다. 펼친 속성의 scroll 영역에는 명시적인 높이를 부여해 내용이 0 높이로 줄지 않게 했다. 실제 NAS 개인 볼트의 프로젝트 가지도 루트와 함께 표시됐다. QA 문서·독립 registry 등 8개 파일의 검증 전후 SHA256과 파일 집합이 같았고, QA 탭·폴더는 정리했다. Node launcher 4개·reader/tree 18개·frontmatter 5개와 Rust 통합 테스트 10개, 기본 Rust 검사와 소스/Windows mod check를 통과했다. 지원 앱 명령·스크린샷 검증이며 실제 사용자 물리 입력 검증과 구분한다.

## 위키링크 문서 이동

[Obsidian 위키링크 문법](https://obsidian.md/help/links)의 `[[노트]]`, `[[노트.md]]`, `[[폴더/노트]]`, `[[노트|표시 이름]]`, `[[노트#제목|표시 이름]]`을 읽기 화면에서 클릭할 수 있게 표시한다. 원문·코드 블록·인라인 코드·이스케이프와 `![[임베드]]`는 원래 문법을 유지한다. 링크 표시는 미리보기에만 적용한다.

클릭하면 같은 호스트의 Rust `resolve --vault <등록명> --from <현재 문서> --target <대상>`을 호출한다. 파일명은 `.md` 유무를 허용하고 NFC 기준 동일 문자를 우선 비교하며, 일치가 없으면 소문자 비교로 다시 찾는다. 경로가 명시되면 실제 Vault 전체 경로를 우선하고 이후 현재 문서 폴더의 경로·일치하는 경로 접미사를 찾는다. bare 파일명은 볼트 전체에서 조회한다. 같은 이름의 문서가 여럿이면 실제 경로를 선택하며 임의로 하나를 열지 않는다. 프론트매터 aliases 기반 조회는 아직 없다.

대상을 찾으면 기존 문서 탭·폴더 reveal로 열고, 없으면 안내한다. 제목·블록 fragment는 대상 문서까지만 열고 위치 점프 미지원 안내를 표시한다. `[[#제목]]`은 현재 문서를 대상으로 한다. 노트 생성·저장·외부 프로그램 실행으로 전환하지 않는다. 늦은 조회 결과는 문서 전환·새로고침·종료 후 무시한다.

Rust 조회는 실제 노트 내용이나 토큰을 읽지 않고 파일 메타데이터를 검사한다. `.obsidian` 등 제외 경로·symlink/reparse·경계 밖 경로는 기존 코어 규칙을 따른다. 스캔은 50,000항목·5,000폴더·64단계·5초와 200개 후보로 제한한다. 읽기 오류나 한도로 완전한 검색을 보장하지 못하면 incomplete/truncated로 반환해 단일 후보도 자동 선택하지 않는다. 검색이 불완전하더라도 이미 찾은 후보는 경로를 확인해 명시적으로 선택할 수 있다. 결과는 found/ambiguous/not_found/incomplete, matches 경로 배열, fragment, truncated JSON이다. 파일을 열 때도 기존 read 경계 검사를 다시 수행한다.

위키링크 후속 검증(2026-11-01): 로컬 Rust 기본 검사와 13개 Rust 테스트, 46개 Node 테스트·소스/Windows mod 검사를 통과했다. GitHub CI는 실행하지 않았고 이후 수동 실행으로 바꿨다. NAS의 실제 환경용 reader는 NAS 로컬 Docker 빌드로 배포했으며 기존 binary 백업을 유지했다. Windows→NAS 실제 CLI로 한글·중복·없는 대상과 Linux의 대소문자 경로 우선순위를 확인했다. Windows 앱 명령·스크린샷으로 단일 문서 이동·중복 경로 선택·없는 대상 안내·대상 문서 탭과 폴더 reveal을 확인했다. 실제 NAS의 권한 부족 폴더로 조회가 불완전해질 수 있음을 확인했고, 권한을 바꾸지 않고 후보를 명시적으로 선택하도록 처리했다. 물리적 마우스·키 입력 검증은 아니다.

생성 규칙(사용자 요청): 이후 새 문서·위키링크 생성 기능에서는 이름만으로 대상을 구분할 수 없을 때 `[[폴더/문서]]` 형식의 Vault 상대 경로를 넣는다. 경로가 명시된 링크는 해당 대상을 바로 열고 후보 선택을 정상 흐름으로 만들지 않는다. 현재 생성/저장 기능은 미구현이며 기존 노트의 링크를 자동으로 재작성하지 않는다.

위키링크 QA 종료 시 독립 임시 registry·wrapper·합성 문서 등 11개 파일의 SHA256과 파일 집합이 처음과 동일함을 확인하고 QA 탭·폴더를 정리했다. 실제 NAS 개인 탭과 기존 registry/Sync는 유지했다. fragment 안내는 첫 로딩 notify 이전에 설정하고 읽기 완료 후에도 유지하도록 회귀 테스트로 확인했다.
