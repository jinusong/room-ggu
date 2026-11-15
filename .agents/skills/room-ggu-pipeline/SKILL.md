---
name: room-ggu-pipeline
description: 룸꾸 가구배치 웹앱의 기획·구현·디자인 개선에 사용한다. 공용 스킬 다섯 개로 기획 설명, 설계 규칙 대조, UI 점검, 한글·영문 문구 점검을 연결하고 기능 검증 후 GitHub Pages에 배포한다.
---

# 룸꾸 기획·구현 파이프라인

프로젝트 루트의 `AGENTS.md`를 먼저 읽는다. 기존 기능과 사용자의 최신 지시를 유지한다. 전역 `maker-pipeline`이 설치돼 있어도 이 프로젝트에서는 아래 절차가 우선이다.

1. **기획:** 변경의 입력·결과·완료 조건을 정한다. 구조나 흐름 설명이 필요하면 `../answer-me-with-html/SKILL.md`를 읽고 동봉 CLI로 `docs/`의 기획 원고를 HTML로 만든다. 단순 수정에는 기획 페이지를 추가하지 않는다.
2. **구현:** 검증 가능한 한 덩어리씩 구현한다. 문장 해석의 기본은 모델(`src/app/interpret.js`가 검증), 대체 경로는 규칙(`src/app/planner.js`), 상태 변경은 `src/app/ops.js`에 둔다. 방·치수·충돌·저장 계산은 AI와 분리한다. 설명, 추정값, 직접 설정값의 출처를 유지한다.
3. **설계 규칙:** 화면을 바꿨으면 `../open-design/SKILL.md`의 표에서 해당하는 규칙집만 읽고 실제 화면에 대조한다. 최소한 상태 다섯 가지(`craft/state-coverage.md`: 준비 중·비어 있음·오류·채워짐·극단값)와 접근성 바닥(`craft/accessibility-baseline.md`: 대비, 포커스, 이름 있는 컨트롤, 키보드 경로, 터치 영역)을 본다. 움직임을 넣었으면 `craft/animation-discipline.md`를 더한다. 색과 글꼴의 기준은 `docs/design-direction.md`이고 규칙집과 부딪치면 이 문서를 따른다.
4. **디자인:** `../unslop/SKILL.md`와 관련 참조만 읽는다. `docs/design-direction.md`의 방향(종이 위 실내 모형과 줄자, 먹 중립색, 줄자 노랑은 직접 정한 치수와 선택 표시에만)에 맞춰 간격, 색, Lucide 아이콘, 문구, 글꼴, 레이아웃, 3D 표현, 상호작용을 점검한다. 시각적 중심은 화면 전체의 편집 가능한 방이고, 대화 시트와 입력창이 사용 방식의 중심이다. 값을 정하는 도구는 탭이나 메뉴가 아니라 `src/ui/surfaces.jsx` 컴포넌트와 `SURFACE_KINDS` 항목으로 추가하고, 보기 상태와 고른 대상의 동작은 방 위의 컨트롤에 둔다.
5. **문구:** 한글 UI·오류·안내 문구와 문서는 `../humanize-korean/references/quick-rules.md`로 대조한다(번역투, 이중 피동, "~할 수 있다" 반복, 기계적 병렬, 접속사 남발). 긴 문서를 새로 썼으면 `../humanize-korean/SKILL.md`의 경로를 따른다. 영문은 `../humanizer/SKILL.md`를 쓴다. 한국어로 짧고 구체적으로 쓰며, AI 기능이나 추정 정확도를 과장하지 않는다. 상태 메시지에 개발 프레임워크 이름을 불필요하게 넣지 않는다. 윤문으로 수치·고유명사·주장의 강도를 바꾸지 않는다.
6. **검증:** `npm run verify`를 실행한다. UI·상태 동작 변경에는 `npm run test:e2e`로 브라우저 회귀 테스트도 실행하고, 데스크톱과 모바일에서 실제로 조작한 화면을 확인한다(입력창이 가려지지 않는지 포함). AI 경로를 바꿨다면 실제 모델 로딩·추론 또는 그 검증 한계를 기록한다. 결과는 `docs/verification.md`에 남긴다.
7. **반영:** 검증한 변경만 커밋·푸시한다. GitHub Actions 완료를 확인하고, 공개 주소의 `version.json` 커밋이 최신인지와 핵심 흐름이 동작하는지 확인한다. 미완료 검증을 통과했다고 적지 않는다.

Codex는 `$room-ggu-pipeline`, Claude Code는 `/room-ggu-pipeline`으로 이 절차를 호출한다. 자동 스케줄러나 무한 반복 프로세스를 만들지는 않는다.
