# herdrmd-diagnostics

00 연결 실험을 보존하는 개발 전용 실행 파일이다. 제품 herdrmd의 의존성이 아니며 workspace default-members에서도 제외한다. 일반 제품 빌드와 제품 배포 패키지에 포함되지 않는다.

```sh
cargo build -p herdrmd-diagnostics --locked
cargo test -p herdrmd-diagnostics --locked
target/debug/herdrmd-diagnostics --help
```

serve·service·bridge 명령과 인증/echo/수명 검증은 이 도구에서만 제공한다. 독립 Herdr mod는 `integrations/herdr/diagnostics/herdrmd-probe`다. 제품 reader는 이 코드나 모듈을 import하지 않는다. [연결 검증](../../docs/bridge-verification.md), [Windows 진단 설치](../../docs/windows-bridge.md)를 따른다. 진단 토큰·상태와 합성 입력은 Vault 밖에 둔다.
