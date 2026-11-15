---
name: open-design
description: OpenDesign(nexu-io/open-design)의 설계 규칙집을 앱·데몬 없이 쓰는 휴대용 묶음. 웹·앱 화면, 대시보드, 랜딩, 슬라이드, HTML 아티팩트를 만들거나 디자인을 리뷰할 때 craft 규칙(타이포그래피, 색, 상태 5종, 접근성, 모션, 폼 검증, UX 법칙, AI 티)과 DESIGN.md 작성법을 적용한다. "디자인 리뷰", "design review", "DESIGN.md", "디자인 시스템 문서", "빈 화면·오류 상태 점검", "접근성 점검", "모션 점검" 요청에 사용한다. 방향 잡기와 AI 티 제거는 unslop과 함께 쓴다.
license: Apache-2.0
metadata:
  source: https://github.com/nexu-io/open-design
  source-commit: 59e4f2ae85de7e7318a5e6bdcf3a34584c4b7582
  scope: craft rulebooks and DESIGN.md authoring guide only
---

# OpenDesign craft (휴대용 묶음)

OpenDesign은 디자인 에이전트 작업 공간이다. 이 스킬은 그중에서 **데몬 없이도 그대로 쓸 수 있는 부분**만 담았다.

- 담은 것: `craft/`의 규칙집 11개(원문 그대로)와 `references/design-systems.md`(DESIGN.md·tokens.css 작성 규칙).
- 담지 않은 것: OpenDesign 앱과 `od` 데몬·MCP 서버, 151개 브랜드 디자인 시스템, 디자인 템플릿, 171개 스킬. 필요하면 원 저장소의 `QUICKSTART.md`대로 따로 설치한다.

## 언제 무엇을 읽나

작업에 맞는 파일만 읽는다. 전부 읽지 않는다.

| 작업 | 읽을 파일 |
| --- | --- |
| 글자가 있는 화면 전부 | `craft/typography.md` |
| 제목·본문 위계를 손봐야 할 때 | `craft/typography-hierarchy.md` |
| 문서·블로그처럼 오래 읽는 화면 | 위 둘 + `craft/typography-hierarchy-editorial.md` |
| 색을 정하거나 고칠 때 | `craft/color.md` |
| 목록·표·폼·패널처럼 상태가 있는 화면 | `craft/state-coverage.md` |
| 버튼·입력·키보드 조작이 있는 화면 | `craft/accessibility-baseline.md` |
| 움직임이 있는 화면 | `craft/animation-discipline.md` |
| 입력 폼 | `craft/form-validation.md` |
| 선택지·대시보드·온보딩의 구성 | `craft/laws-of-ux.md` |
| 랜딩·소개 페이지·발표 자료 | `craft/anti-ai-slop.md` |
| 아랍어·히브리어 등 RTL | `craft/rtl-and-bidi.md` |

## 쓰는 순서

1. **기준 문서를 먼저 읽는다.** 프로젝트에 `DESIGN.md`나 디자인 방향 문서가 있으면 그것이 색·글꼴·간격의 기준이다. craft 규칙은 그 위에 얹는 보편 규칙이다. 둘이 부딪치면 프로젝트 문서를 따르고 차이를 보고한다.
2. **상태부터 센다.** 데이터를 받거나 입력을 받는 화면마다 준비 중·비어 있음·오류·채워짐·극단값 다섯 상태가 있는지 본다(`state-coverage.md`). 가장 흔한 누락이다.
3. **접근성 바닥을 확인한다.** 대비, 포커스 표시, 이름 있는 컨트롤, 키보드 경로, 44px 터치 영역(`accessibility-baseline.md`).
4. **나머지 규칙을 적용한다.** 위 표에서 고른 파일의 규칙을 실제 화면에 대조한다. 코드만 읽고 판단하지 말고 화면을 띄워 확인한다.
5. **결과를 등급으로 적는다.** P0(반드시 고침), P1(고치는 편이 좋음), P2(다듬기). 항목마다 근거 파일과 고친 내용 또는 남긴 이유를 쓴다.

## DESIGN.md를 새로 쓸 때

`references/design-systems.md`의 3장을 따른다. 아홉 구획으로 쓴다: 시각 분위기, 색과 역할, 타이포그래피, 구성요소 스타일, 레이아웃, 깊이와 높이, 할 것과 하지 말 것, 반응형, 에이전트 안내. 색은 토큰 이름과 역할로 적고, 실제 값은 한곳(`tokens.css`나 `:root`)에만 둔다.

## 건너뛰는 항목

규칙집에는 OpenDesign 실행 환경 전용 항목이 섞여 있다. 다음은 적용하지 않는다.

- `data-od-id`, `.ph-img`, `od.craft.requires`, `lint-artifact` 같은 데몬·린터 전용 표기
- "linter가 막는다"는 자동 검사 문구(여기서는 사람이 대조한다)
- `var(--accent)`를 전제로 한 수치는 프로젝트의 강조색 토큰으로 바꿔 읽는다

## unslop과의 분담

- **unslop:** 제품에서 방향을 찾고 간격·색·아이콘·문구·글꼴·레이아웃 순서로 AI 티를 걷어낸다.
- **open-design craft:** 상태·접근성·모션·폼처럼 빠뜨리기 쉬운 항목을 규칙으로 대조한다.

둘 다 쓸 때는 craft로 누락을 먼저 채우고 unslop으로 마무리한다.

## 출처

규칙집은 OpenDesign(Apache-2.0, © nexu-io)에서 가져왔고 내용을 바꾸지 않았다. OpenDesign은 craft 내용이 refero_skill(MIT, © Refero Design)을 바탕으로 한다고 밝힌다. 자세한 내용은 `NOTICE.md`.
