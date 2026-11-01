# + 메뉴에서 Obsidian 볼트 열기

설치한 사용자 탭 바의 `+`를 누르고 **Obsidian 볼트 열기**를 선택하면 설정한 호스트의 Vault를 새 reader 탭으로 연다. 본문은 읽기 전용이며 없는 위키링크 대상의 빈 문서 생성은 지원한다. 닫은 탭·Space나 에이전트에 의존하지 않고 다시 열 수 있다. 대상이 하나면 바로 열고, 여러 개면 개인·회사 등의 이름을 선택하는 목록을 표시한다. 메뉴와 reader 탭은 Obsidian 아이콘을 쓴다. Terminal·에이전트·New space·worktree 항목은 유지한다.

등록한 대상 목록을 선택하는 간단한 진입점이다. reader 안의 볼트 설정에서 현재 컴퓨터와 실제 폴더 경로를 확인할 수 있다. 직접 경로 선택은 준비 중이며 등록 UI와 NAS 자동 탐지는 아직 없다. NAS는 현재 데스크톱 core에서 직접 연결한 머신으로 사용한다. Mac을 중계 호스트로 요구하지 않는다.

## 설치와 사용자 설정

Herdr가 제공하는 tabs/new-menu는 시작 시 갱신되는 원본이므로 수정하지 않는다. `herdr-app do mod.clone`으로 각각 herdrmd-tabs/herdrmd-new-menu 개인 복사본을 만든 뒤 이 저장소의 해당 JS·manifest를 배포한다. 기존 같은 이름의 사용자 수정이 있으면 먼저 검사·백업하고 충돌을 보존한다. 개인 레이아웃의 tabs 블록만 herdrmd-tabs로 바꾼다. 제공 레이아웃을 쓰고 있다면 layout.clone으로 개인 레이아웃을 먼저 만든다. 구조 변경에는 `layout.set` 명령을 사용하고 `.state` 파일을 직접 덮어쓰지 않는다. 다른 모드·상태바·키 설정은 유지한다.

대상은 **현재 데스크톱 클라이언트**의 appHome 아래 `mods/herdrmd/launcher.json`에 저장한다. launcher.example.json을 참고한다. 실제 사용자 경로·별칭 설정은 Git에서 제외한다.

```json
{
  "targets": [
    {
      "name": "NAS · 개인 Obsidian",
      "machine": "vault-host",
      "binary": "/absolute/path/on/host/herdrmd",
      "vault": "personal"
    },
    {
      "name": "NAS · 회사 Obsidian",
      "machine": "vault-host",
      "binary": "/absolute/path/on/host/herdrmd",
      "vault": "work"
    }
  ]
}
```

machine은 이 클라이언트 core에 등록한 호스트 별칭이다. 생략하면 로컬 호스트에서 실행한다. 메뉴는 현재 Space의 머신을 Vault 호스트로 추측하지 않으며 명시한 설정을 reader의 props로 전달한다. binary는 그 호스트의 절대 실행 경로, vault는 그 호스트의 등록명이다. file은 생략할 수 있다. 설정이 없거나 잘못되면 메뉴에 연결 준비 필요를 표시하고 열기 동작은 실행하지 않는다. 각 메뉴를 열 때 설정을 다시 읽는다. targets에는 이름이 서로 다른 1~20개 대상을 넣는다. 기존 단일 대상 형식도 지원한다. file을 생략하면 해당 볼트의 루트 폴더 목록에서 시작한다. 선택 화면에서 1~9 키로 해당 순서의 볼트를 열 수도 있다.

각 clone을 `herdr-app check`로 검사하고 실제 창에서 메뉴·새 탭을 확인한다. 되돌릴 때는 개인 레이아웃 tabs 블록을 원래 tabs로 바꾼다. 사용자 설정 파일을 배포 패키지로 덮어쓰지 않는다.

## 검증

`node --test tests/scenarios/launcher.test.mjs`는 원격/로컬 대상 전달, 현재 Space와 Vault 호스트 분리, 잘못된 설정 거부와 불필요한 필드 배제를 검사한다. macOS·Windows·Linux CI에서도 실행한다. 개인·회사 등록명이 섞이지 않는지와 기존 단일 설정 호환성도 검사한다. 복사본 탭 바의 herdrmd-tabs.new-menu 명령은 + 클릭과 같은 메서드를, herdrmd-new-menu.choose-vault는 선택 목록을 표시하며 herdrmd-new-menu.open-vault-1/2는 해당 대상 행과 같은 열기 메서드를 실행해 물리 입력 자동화 없이 동작을 확인할 수 있다. 직접 마우스 클릭 확인과는 구분한다.

2026-11-01 실제 Windows 클라이언트에서 Obsidian 아이콘·개인/회사 선택 화면과 각 NAS 볼트의 루트 목록을 스크린샷으로 확인했다. 데스크톱→NAS core exec로 양쪽 목록·UTF-8 문서 읽기·읽기 전용·연속 읽기 revision 일치를 검사했다. 실제 문서 내용은 기록하지 않았다. 기존 Headless Sync 컨테이너는 healthy였고 두 볼트의 continuous 프로세스가 모두 실행 중이라 재시작하지 않았다. 메뉴 검증은 위 앱 명령을 사용했으며 직접 마우스 클릭 검증과 구분한다.

## NAS 준비

1. 데스크톱에서 NAS SSH 연결과 호스트 키 검증을 준비한다. `hc machine add <ssh-alias> --name <machine-alias> --install`로 해당 클라이언트 core에 NAS를 연결한다. 기존 연결·SSH 설정은 보존한다.
2. CI의 `herdrmd-reader-linux-x64`는 x86_64 Linux용 정적 musl 실행 파일이다. NAS 사용자 실행 경로에 설치하고 체크섬과 `herdrmd --version`을 확인한다. 다른 CPU용 빌드는 별도로 준비해야 한다.
3. **NAS에서** `herdrmd vault add personal <개인 볼트 절대 경로>`와 `herdrmd vault add work <회사 볼트 절대 경로>`를 실행한다. 등록 정보는 NAS 사용자 설정 디렉터리에 저장하며 실제 볼트 안에는 쓰지 않는다.
4. 데스크톱의 launcher.json에 두 등록명과 NAS 실행 경로·머신 별칭을 넣는다. `machine`은 현재 Space와 무관하게 명시한 NAS를 사용한다. 이 목록은 볼트 접근 권한을 분리하는 보안 경계는 아니다. 접근 권한은 NAS SSH 사용자 권한을 따른다.
5. 기존 Obsidian Headless Sync는 별도로 상태를 확인한다. `ob sync-list-local`, `ob sync-status --path <컨테이너 안 볼트 경로>`와 각 볼트의 `ob sync --continuous` 프로세스를 확인한다. 정상 동작 중이면 그대로 유지한다. herdrmd는 Sync 로그인·설정·동기화 프로세스를 관리하지 않으며, NAS에 내려온 파일을 읽고, 없는 위키 대상의 생성은 같은 NAS의 코어에서 처리한다. reader의 새로고침으로 이후 변경을 다시 조회한다.

위키링크 이동과 없는 대상의 빈 Markdown 생성은 제공한다. 본문 편집·기존 문서 저장·검색은 아직 제공하지 않는다. 생성 위치와 경계는 [Vault 연결](vault-connection.md)을 따른다. 기존 Sync가 파일을 바꿀 수 있으므로 목록과 읽기 시점 사이의 변경은 가능하다. 원문 내용은 설정·패키지·테스트 fixture로 복제하지 않는다.

## 아이콘 출처

`mods/herdrmd/obsidian.svg`는 [Obsidian 공식 로고](https://obsidian.md/images/obsidian-logo-gradient.svg) 원본이다. Obsidian은 해당 소유자의 상표이며 사용 지침은 [공식 브랜드 페이지](https://obsidian.md/brand)를 따른다. 이 통합은 비공식이다.

제품 reader는 항상 Vault 화면을 열고 mode가 없거나 과거 probe 값이어도 진단 서비스를 시작하지 않는다. 00 검증은 별도 herdrmd-probe를 설치해 사용한다. [Windows 제품 설치](windows.md)는 진단 설치와 분리된다.
