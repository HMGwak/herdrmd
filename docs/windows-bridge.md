# Windows에서 00 검증 화면 열기

이 패키지는 연결 실험용이며 Vault·문서 편집 기능은 제공하지 않는다. Windows x64용 실행 파일과 Herdr mod가 들어 있다. CI에서 포맷·빌드·프로세스 테스트를 통과한 수동 실행의 artifact로 제공한다. 당분간 push마다 CI를 자동 실행하지 않는다.

## 설치

GitHub Actions의 성공한 CI 실행에서 `herdrmd-bridge-windows` artifact를 내려받아 압축을 푼다. 다음 명령은 **Windows 로컬 PowerShell**에서, 압축을 푼 폴더를 현재 폴더로 두고 실행한다. Mac에 SSH로 연결된 터미널에서 실행하지 않는다.

```powershell
$mod = Join-Path $env:USERPROFILE '.config\herdr-app\mods\herdrmd'
New-Item -ItemType Directory -Force $mod | Out-Null
Copy-Item .\mods\herdrmd\* $mod -Recurse -Force
& (Join-Path $mod 'herdrmd.exe') --version
herdr-app check $mod
```

`HERDR_APP_HOME`을 별도로 설정했다면 그 경로 아래 `mods\herdrmd`에 복사한다. 기존 `herdrmd`가 자신이 수정한 다른 mod라면 먼저 별도 위치에 보관한다. 이 복사는 전용 `herdrmd` 폴더의 파일만 갱신하며 레이아웃·단축키·다른 mod는 수정하지 않는다.

정상적으로 파일이 복사되면 Herdr가 다시 로드한다. 기존 `herdrmd 00 bridge` 탭으로 돌아간다. 탭이 Mac 경로의 props를 공유하더라도 Windows에서는 로컬 mod 폴더의 `herdrmd.exe`와 OS 임시 상태 경로를 사용한다. 네트워크로 Mac 서비스에 접근하거나 토큰을 복사하지 않는다.

## Space 선택

현재 탭은 연결 실험이므로 Windows에 mod를 설치하면 기존 Space에서도 볼 수 있다. Space를 바꾸는 것만으로 누락된 mod가 설치되지는 않는다.

향후 Windows 로컬 Vault로 작업할 때는 Windows 로컬 컴퓨터를 대상으로 별도 `herdrmd-windows` Space를 두는 것이 관리하기 쉽다. Mac/SSH 터미널과 로컬 PowerShell을 구분한다. 새 검증 탭은 Windows 로컬 CLI에서 다음처럼 만들 수 있다.

```powershell
herdr-app do tab.new --name 'herdrmd Windows 00 bridge' --mod herdrmd
```

현재 선택한 Space에 탭을 추가하며, 실행 파일과 상태 경로는 이 Windows 클라이언트에서 선택한다. 제품 Vault 탐색은 아직 없다.

## 서비스 실행 방식

Windows Herdr의 `exec`는 명령 종료 시 자식을 정리하는 Job Object를 사용한다. 따라서 mod는 로컬 herdr-core 0.1.16에서 `hc run --bg --no-parent --no-notify --rm -- <binary> serve --state-dir <state>`로 서비스를 관리하고 `service wait`로 준비를 확인한다. 이 과정은 새 사용자 탭을 만들지 않으며 서비스 종료 시 내부 실행 항목도 제거한다. 기존 서비스는 재사용하고, 서비스는 인증된 요청이 10분간 없으면 종료한다. 제한된 `exec` 안에서 직접 `service ensure`를 실행한 성공만으로 종료 후 생존을 판단하지 않는다.

## 확인과 종료

화면에 `PASS · GET + POST + auth`가 나타나면 합성 한글을 직접 입력하고 `연결 검증 링크`를 클릭한다. `native changes`와 `link clicks`가 증가하는지 확인한다. 탭을 전환했다 돌아와 입력이 유지되는지도 확인한다.

검증 report와 종료는 같은 Windows PowerShell에서 실행한다.

```powershell
$binary = Join-Path $mod 'herdrmd.exe'
$state = (& $binary bridge location | ConvertFrom-Json).state_dir
& $binary bridge report --state-dir $state
& $binary service stop --state-dir $state
```

다른 사용자 서비스나 터미널은 종료하지 않는다. 사용자 임시 상태 폴더의 토큰·잠금 파일을 Git이나 동기화 Vault에 복사하지 않는다. Windows 실제 화면의 성공은 CI 결과와 별도로 확인해야 한다.
