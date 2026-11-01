# + 메뉴에서 개인 볼트 열기

설치한 사용자 탭 바의 `+`를 누르고 **Obsidian 볼트 열기**를 선택하면 설정한 호스트의 Vault를 새 읽기 전용 탭으로 연다. 닫은 탭·Space나 에이전트에 의존하지 않고 다시 열 수 있다. 메뉴의 작은 설명에는 실제로 여는 대상 이름을 표시한다. Terminal·에이전트·New space·worktree 항목은 유지한다.

현재는 한 대상을 여는 간단한 진입점이다. 컴퓨터·볼트 선택 대화상자, 폴더 등록 UI와 NAS 자동 탐지는 아직 없다. NAS를 정식 호스트로 연결할 때는 기존 core의 해당 머신 연결과 그 호스트의 Rust 바이너리·Vault 등록을 준비한 뒤 대상 설정을 교체한다. NAS의 준비가 끝나기 전에 연결 완료로 표시하지 않는다.

## 설치와 사용자 설정

Herdr가 제공하는 tabs/new-menu는 시작 시 갱신되는 원본이므로 수정하지 않는다. `herdr-app do mod.clone`으로 각각 herdrmd-tabs/herdrmd-new-menu 개인 복사본을 만든 뒤 이 저장소의 해당 JS·manifest를 배포한다. 기존 같은 이름의 사용자 수정이 있으면 먼저 검사·백업하고 충돌을 보존한다. 개인 레이아웃의 tabs 블록만 herdrmd-tabs로 바꾼다. 제공 레이아웃을 쓰고 있다면 layout.clone으로 개인 레이아웃을 먼저 만든다. 구조 변경에는 `layout.set` 명령을 사용하고 `.state` 파일을 직접 덮어쓰지 않는다. 다른 모드·상태바·키 설정은 유지한다.

대상은 **현재 데스크톱 클라이언트**의 appHome 아래 `mods/herdrmd/launcher.json`에 저장한다. launcher.example.json을 참고한다. 실제 사용자 경로·별칭 설정은 Git에서 제외한다.

```json
{
  "name": "개인 Obsidian",
  "machine": "vault-host",
  "binary": "/absolute/path/on/host/herdrmd",
  "vault": "personal",
  "file": "folder/note.md"
}
```

machine은 이 클라이언트 core에 등록한 호스트 별칭이다. 생략하면 로컬 호스트에서 실행한다. 메뉴는 현재 Space의 머신을 Vault 호스트로 추측하지 않으며 명시한 설정을 reader의 props로 전달한다. binary는 그 호스트의 절대 실행 경로, vault는 그 호스트의 등록명이다. file은 생략할 수 있다. 설정이 없거나 잘못되면 메뉴에 연결 준비 필요를 표시하고 열기 동작은 실행하지 않는다. 각 메뉴를 열 때 설정을 다시 읽는다.

각 clone을 `herdr-app check`로 검사하고 실제 창에서 메뉴·새 탭을 확인한다. 되돌릴 때는 개인 레이아웃 tabs 블록을 원래 tabs로 바꾼다. 사용자 설정 파일을 배포 패키지로 덮어쓰지 않는다.

## 검증

`node --test tests/scenarios/launcher.test.mjs`는 원격/로컬 대상 전달, 현재 Space와 Vault 호스트 분리, 잘못된 설정 거부와 불필요한 필드 배제를 검사한다. macOS·Windows CI에서도 실행한다. 복사본 탭 바의 herdrmd-tabs.new-menu 명령은 + 클릭과 같은 메서드를, herdrmd-new-menu.open-vault는 해당 메뉴 항목과 같은 메서드를 실행해 물리 입력 자동화 없이 동작을 확인할 수 있다. 직접 마우스 클릭 확인과는 구분한다.
