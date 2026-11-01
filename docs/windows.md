# Windows 제품 설치

수동 CI의 `herdrmd-windows` artifact는 제품 실행 파일·reader·탭 메뉴만 포함한다. 00 진단 화면과 HTTP probe는 포함하지 않는다. 이전 `herdrmd-bridge-windows` artifact는 분리 전 패키지이므로 새 제품 설치에 사용하지 않는다.

기존 mod의 변경 파일을 확인·백업한 뒤 전용 파일을 갱신하고 `mods/herdrmd/launcher.json`은 보존한다. 패키지의 `mods/herdrmd`에는 제품 `herdrmd.exe`, 모든 제품 JS, mod.json, obsidian.svg가 있다. `herdrmd-tabs`/`herdrmd-new-menu` 배치와 사용자 레이아웃은 [메뉴 안내](open-menu.md)를 따른다. `HERDR_APP_HOME`을 설정했다면 그 appHome을 사용한다.

`herdr-app check <appHome>/mods/herdrmd`와 `<appHome>/mods/herdrmd/herdrmd.exe --version`을 확인한다. 탭은 항상 VaultReader를 연다. binary·vault·machine은 선택한 호스트의 실제 값으로 명시하며 기존 개인/회사 launcher 설정을 보존한다. Windows 로컬은 로컬 경로, NAS는 NAS 실행 파일과 등록명을 사용한다. 사용자가 지정한 머신에서 제품 CLI를 호출하며 진단 서비스를 시작하거나 HTTP 토큰을 요구하지 않는다.

제품에서 `serve`, `service`, `bridge` 명령은 제거됐다. 00 검증이 필요하면 별도 `herdrmd-diagnostics-windows`와 `herdrmd-probe`를 사용한다. [진단 설치](https://github.com/HMGwak/herdrmd/blob/main/docs/windows-bridge.md)는 제품 설치와 분리되어 있다. 두 패키지의 실행 파일을 서로 대신 쓰지 않는다.
