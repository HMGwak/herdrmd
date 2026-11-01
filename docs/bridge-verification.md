# 00 연결 검증

00은 통신·네이티브 이벤트·프로세스 수명을 확인하는 실험이다. Vault 읽기·쓰기, 일반 CLI, 초안과 제품 설치 명령은 제공하지 않는다. 상태·토큰은 제품 저장소와 Vault 밖의 전용 임시 폴더만 사용한다.

## 명령과 상태

```sh
cargo build --workspace --locked
target/debug/herdrmd service ensure --state-dir /absolute/private/scratch/herdrmd-00
target/debug/herdrmd service status --state-dir /absolute/private/scratch/herdrmd-00
target/debug/herdrmd bridge report --state-dir /absolute/private/scratch/herdrmd-00
target/debug/herdrmd service stop --state-dir /absolute/private/scratch/herdrmd-00
```

`ensure`는 연결 파일 경로·프로토콜·PID·재사용 여부만 JSON으로 출력한다. 토큰은 출력하지 않는다. `serve`는 현재 실행 파일을 다시 실행하고 stdio를 null로 분리한다. Unix는 새 프로세스 그룹, Windows는 detached process 플래그를 사용한다. 인스턴스 File 잠금은 서비스가 유지한다. 10분간 인증된 요청이 없으면 종료한다.

상태 폴더는 실험 전용이어야 한다. Unix에서는 폴더와 상태 파일에 0700/0600을 적용하므로 기존 사용자 폴더 자체를 지정하지 않는다. Windows의 명시적 ACL과 기본 사용자 상태 경로는 후속 작업이다.

## Herdr mod

소스 `integrations/herdr/mods/herdrmd/`의 `main.js`, `api.js`, `mod.json`을 Herdr 설정 폴더의 `mods/herdrmd/`로 복사한다. 기존 동일 이름 mod가 있으면 내용을 확인한 뒤 설치한다. `place: none`이므로 기존 레이아웃·키 설정은 바꾸지 않는다.

```sh
herdr-app check /absolute/path/to/integrations/herdr/mods/herdrmd
herdr-app do tab.new '{"name":"herdrmd · 00 bridge","space":"<existing space ID>","mod":"herdrmd","props":{"binary":"/absolute/path/to/target/debug/herdrmd","state_dir":"/absolute/private/scratch/herdrmd-00"}}'
```

mod가 Herdr의 `exec`로 ensure를 실행한 뒤 연결 파일을 읽고 인증 GET, 무인증 401, 한글 POST echo를 검증한다. 토큰은 화면·명령 인수·일반 로그에 표시하지 않는다. 성공 화면에 PID와 UTF-8 바이트 수를 표시한다.

mod·Rust 실행 파일·임시 상태 폴더는 **같은 Herdr 데스크톱 클라이언트 머신**에 설치해야 한다. 현재 exec에는 원격 대상이 없고 HTTP는 그 클라이언트의 loopback을 사용한다. 다른 컴퓨터의 core/터미널이나 탭 목록에 연결해도 Mac의 mod 파일·실행 파일 경로·loopback 서비스가 Windows로 배포되지는 않는다. Mac의 절대 경로를 props에 넣은 이 실험을 Windows 클라이언트 화면 검증으로 취급하지 않는다. 원격 서비스 연결·터널은 현재 범위에 없다.

Windows 설치는 [Windows bridge 안내](windows-bridge.md)를 따른다. 성공한 push CI는 실행 파일·JS·설치 안내가 포함된 `herdrmd-bridge-windows` artifact를 제공한다. 다른 OS의 절대 경로가 탭 props에 공유되면 mod는 현재 클라이언트의 mod 폴더 안 실행 파일을 선택하고, `bridge location`으로 OS 임시 상태 경로를 조회한다. 사용자 설정·Vault에 토큰을 복사하지 않는다.

실제 입력·링크·탭 검증 순서는 다음과 같다.

1. 편집기에 합성 한글 문장을 입력하고 `native changes` 증가와 왕복 성공을 확인한다. IME 입력도 직접 확인한다.
2. Markdown의 `연결 검증 링크`를 클릭하고 `link clicks` 및 report의 `link_click`을 확인한다.
3. 다른 탭으로 갔다 돌아와 같은 instance·입력·카운터가 유지되는지 확인한다. 전환은 `closed`를 만들지 않아야 한다.
4. 만든 검증 탭만 닫고 report에서 그 instance의 `closed`와 서비스 PID 생존을 확인한다.
5. 만든 서비스만 `service stop`으로 종료한다. 사용자 소유 터미널·앱·다른 서비스는 종료하지 않는다.

`herdr-app do herdrmd.probe`는 프로그램으로 `EditorState.set_value`를 호출하는 별도 탐침이다. `programmatic_set`과 native `editor_change` 발생 여부를 report로 확인할 수 있지만 실제 키 입력·한글 IME·링크 클릭의 증거로 사용하지 않는다. `<mod>.<command>`는 화면에 표시된 복사본에만 전달된다.

## 자동 검증과 한계

`cargo test --workspace --locked`는 별도 프로세스로 ensure를 실행해 반환 후 생존, 재사용, 인증 거부, Origin/Host 거부, 한글·emoji·CRLF/LF·끝 개행 보존, 본문 상한, 동시 ensure, stale 연결 복구, 두 번째 serve 거부와 종료를 검사한다. Unix에서는 의도적으로 상속 가능한 FD를 전달해 서버가 불필요한 출력 핸들을 유지하지 않는 회귀 검사도 수행한다. 테스트는 합성 데이터와 OS 임시 폴더만 사용한다.

macOS 동시 실행 검증 중 stdio 외의 상속 파이프가 서버에 남아 다른 launcher의 EOF를 막는 현상을 관찰했다. 따라서 단독 `serve` 프로세스가 상태 파일·잠금·런타임을 열기 전에 Unix의 상속 FD 3 이상을 닫는다. `pre_exec`에서 Rust 내부 exec 오류 전달 파이프를 닫는 방법은 사용하지 않는다. 이 진입점은 외부 FD 인수를 지원하지 않는다.

`herdr-app check`는 초기 로딩 검사다. 실제 비동기 fetch나 사용자 입력까지 검증하지 않으므로 실행 중 화면과 보고서를 함께 확인한다. `close`는 Herdr의 250ms best-effort 콜백이며 강제 종료·크래시 복구를 보장하지 않는다. 10분 idle 종료는 실제 대기 검증 여부를 별도로 기록한다. 서비스 전체의 시작 전 헤더 타임아웃·제품 수준 자원 한도·재연결은 05 태스크에서 다룬다.

## 검증 결과

검증 환경: Rust 1.94.0, macOS의 Herdr 0.1.10 / herdr-core 0.1.15. 실행은 사용자가 열어둔 Terra 6.1 medium 세션에 의뢰하고 기존 AGY 세션에서 읽기 전용 검토를 받았다.

| 항목 | 결과 |
| --- | --- |
| 로컬 fmt·check·build·test | Terra 재검증 통과. 통합 테스트 3개, 0.49초 |
| 소스·설치 mod 초기 검사 | herdr-app check 통과 |
| 실제 Herdr exec → GET·POST·Authorization | 성공 화면과 Rust의 initialized·auth_rejection_observed·echo를 확인 |
| Herdr exec 반환 뒤 서비스 생존 | 후속 CLI 조회에서 동일 PID 생존 확인 |
| 프로그램으로 EditorState.set_value | 화면·왕복은 갱신되지만 change 이벤트는 발생하지 않음. 실제 타이핑 증거로 간주하지 않음 |
| 탭 전환·복귀 | 같은 입력·카운터 유지, closed 이벤트 없음 |
| 검증 탭 종료 콜백 | Terra가 만든 별도 탭의 initialized → closed 확인. 기존 탭은 closed 없이 유지되고 동일 서비스 PID 생존 |
| 직접 한글 입력·IME와 실제 링크 클릭 | 사용자 확인 대기 |
| macOS·Windows CI | [81e74d7의 실행](https://github.com/HMGwak/herdrmd/actions/runs/41281827654)에서 양쪽 성공. 각각 프로세스 테스트 3개 통과 |
| 실제 Windows Herdr UI·10분 idle 종료 | 미검증 |

실행 중인 mod에서는 init의 첫 인수로 props를 받지 못하는 현상을 확인해 `herdr.props()`로 읽는다. 초기 check 성공만으로 비동기 초기화 성공을 판단하지 않는다. 이 실험에서 사용한 UI와 콜백은 제품 편집기나 복구 보장이 아니다.

초기 Windows CI에서는 프로세스 테스트가 2분 제한에 걸렸다. Windows launcher를 `CreateProcessW`의 `bInheritHandles=FALSE`로 바꾸고 프로세스·스레드 HANDLE의 소유권을 관리한다. 상속 가능한 출력 HANDLE을 전달하는 Windows 회귀 검사와 한글·공백 상태 경로 검증을 포함해 재검증했다. 단순 빌드 성공을 Windows 실행 검증으로 보고하지 않는다.
