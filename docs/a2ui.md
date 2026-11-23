# A2UI 연결 (v5.9)

룸꾸는 A2UI 1.0 공식 코어 `@a2ui/web_core@0.15.0`과 자체 Preact 렌더러를 쓴다. 서버, 비밀키, 원격 추론은 추가하지 않는다.

## 처리 순서

1. 기존 상담 모델이 간결한 의도, 조건, 도구 JSON을 만든다. 앱의 이름, 숫자, 출처 검증을 거친다.
2. `src/a2ui-catalog.js`가 `SURFACE_KINDS`에서 19개 커스텀 컴포넌트의 계약을 만든다. 같은 문서를 `a2ui/catalog.json`으로 배포한다.
3. `ToolSession`이 카드마다 `createSurface`를 보내고 `updateComponents`로 도구와 대상을, `updateDataModel`로 펼침 상태와 요약을 전달한다.
4. 공식 `MessageProcessor`와 `NodeResolver`가 카탈로그와 `@path` 바인딩을 해석한다. `A2uiSurface`는 해석된 컴포넌트만 기존 `NativeTool`로 렌더링한다.
5. 접힌 카드의 다시 열기는 SDK의 action closure를 거쳐 출처, 시간, 도구 ID를 포함한 `action`이 된다. 삭제 시 resolver와 surface를 해제한다.

카드 내부의 치수 입력, 초안 적용, 파일 선택은 기존 네이티브 컴포넌트와 store/ops가 맡는다. 드래그, 충돌, 실행 취소 계산도 그대로다. 대화는 기존 도구 명세를 저장하고, 다시 열 때 A2UI 메시지를 재구성한다.

## 지원 범위

룸꾸 카탈로그에 맞춘 로컬 agent–renderer 연결이다. 범용 Basic Catalog 렌더러, 외부 에이전트 접속, A2A/MCP 전송, 원격 함수 호출, 모델 토큰 단위 UI 스트리밍은 이번 범위에 포함하지 않는다. 준비 중, 빈 상태, 사진 판별, 도구 내부 오류는 기존 카드가 표시한다. 프로토콜 해석 오류는 해당 카드에 복구 버튼을 표시하고 입력과 배치를 보존한다.

코어는 알 수 없는 컴포넌트를 placeholder로 보관할 수 있지만, 룸꾸는 허용 목록과 resolved 상태를 확인하고 화면에 렌더링하지 않는다. 모델 HTML, CSS, JS와 임의의 외부 wire JSON은 받지 않는다.

의존성 점검에서 SDK의 Zod 3 경로에 [대형 배열 검증 메모리 고갈 경고](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)가 남는다. 앱은 SDK 전에 명세를 정리하고 메시지당 컴포넌트 1개, 요약 200자, ID 100자로 제한한다. 외부 메시지 수신을 추가하려면 별도 크기 제한과 SDK 의존성 갱신을 먼저 검토해야 한다. 패키지 경고 자체를 해결했다고 주장하지 않는다.

[공식 클라이언트 연결](https://a2ui.org/guides/client-integration/), [카탈로그](https://a2ui.org/concepts/catalogs/), [모델 생성 형식과 wire 메시지의 분리](https://a2ui.org/concepts/inference-formats/)


v5.10의 `windows`는 사용자가 직접 여는 방 도구다. 기존 모델 UI 선택값에는 추가하지 않는다. 창문 치수는 기존 `ops` 경계에서 검증하고, 도구 복원은 다른 방 도구처럼 `roomId`로 범위를 확인한다.
