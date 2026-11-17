# Third-party notices

## User-supplied prototype

3D 가구 기본 형상과 RoomScene의 초기 구조는 사용자가 제공한 BODY-SCALE 팀원 전달 ZIP을 바탕으로 수정했습니다. 원본 신체 측정 흐름은 상담형 가구 등록 흐름으로 교체했습니다.

## Development skills

- **unslop** — Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), [upstream](https://github.com/heydamir/unslop), **CC BY 4.0**. 원본 크레딧을 스킬과 참조에 유지했습니다. 디자인 방향·간격·색상·아이콘·타이포그래피·레이아웃 검토에 사용합니다.
- **humanizer** — [blader/humanizer](https://github.com/blader/humanizer), **MIT**. 라이선스는 `.agents/skills/humanizer/LICENSE`에 있습니다.
- **answer-me-with-html** — [QingYunA/answer-me-with-html](https://github.com/QingYunA/answer-me-with-html), **MIT**. 원본 고지와 CLI를 공용 스킬에 보존합니다.
- **humanize-korean** — [epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai) v2.4.4, **MIT**. 한글 문구와 문서의 번역투·AI 티 점검에 사용합니다. 라이선스는 `.agents/skills/humanize-korean/LICENSE`에 있습니다.
- **open-design** — [nexu-io/open-design](https://github.com/nexu-io/open-design), **Apache-2.0**. `craft/` 규칙집과 DESIGN.md 작성 안내만 원문 그대로 가져왔습니다(`.agents/skills/open-design/NOTICE.md`). 규칙집은 OpenDesign이 [refero_skill](https://github.com/referodesign/refero_skill)(MIT, © Refero Design)을 바탕으로 만든 것입니다. OpenDesign 앱·데몬은 쓰지 않습니다.

정확한 소스 리비전과 설치 경로는 `.agents/skills/skills-lock.json`에 기록합니다. 이 스킬들은 개발 도구이며 브라우저 앱에 포함되지 않습니다.

## Runtime libraries and models

A2UI Core `@a2ui/web_core@0.15.0` (Apache-2.0, Google LLC, [upstream](https://github.com/a2ui-project/a2ui/tree/main/typescript/core/web_core))의 공식 MessageProcessor·NodeResolver·Catalog를 사용합니다. 원본을 수정하지 않았으며 라이선스 사본은 `public/licenses/a2ui-LICENSE.txt`로 함께 배포합니다. 룸꾸의 커스텀 카탈로그와 Preact 연결 코드는 이 저장소에 있습니다.

Three.js (MIT), Preact (MIT), Lucide (ISC), Vite (MIT), esbuild (MIT), WebLLM (Apache-2.0), Transformers.js (Apache-2.0)를 사용합니다. 글꼴은 [Pretendard](https://github.com/orioncactus/pretendard)(SIL OFL 1.1, jsDelivr에서 불러옴)와 [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)(SIL OFL 1.1, @fontsource로 번들)입니다. 각 패키지의 저작권과 라이선스는 해당 upstream 및 npm 배포물에 있습니다.

Gemma 3 모델은 Google Gemma 이용 조건을 따릅니다. [Gemma terms](https://ai.google.dev/gemma/terms). 사용자가 고를 때만 쓰는 Gemma 4 E2B는 모델 카드에 Apache-2.0으로 표시되어 있고, WebLLM용 변환본 [`mlc-ai/gemma-4-E2B-it-q4f16_1-MLC`](https://huggingface.co/mlc-ai/gemma-4-E2B-it-q4f16_1-MLC)을 씁니다. Qwen3 모델은 모델 카드의 라이선스(Apache-2.0)를 따릅니다. 사진 판별의 SigLIP(`google/siglip-base-patch16-224`, Apache-2.0)은 Transformers.js용 ONNX 변환본 [`Xenova/siglip-base-patch16-224`](https://huggingface.co/Xenova/siglip-base-patch16-224)을 씁니다. 모델 가중치는 이 저장소에 포함하지 않으며 사용자 브라우저가 공개 저장소에서 내려받습니다.

사진 평가(`eval/photo/`)는 Openverse·Wikimedia Commons의 CC 라이선스 사진 118장을 씁니다. 사진 파일은 저장소에 넣지 않고, 원본 주소·작성자·라이선스를 `eval/photo/manifest.json`에 남겼습니다. 이전 사진 모델 SmolVLM 256M(Apache-2.0)은 기준선 측정에만 썼습니다. `docs/screenshots/photo.png`·`mobile-photo.png`의 사진은 StockSnap의 CC0 사진(Kristin Hardwick, Ryan Riggins)입니다.

## v5.12 실제 사진 UI 검증

`docs/screenshots/photo-real-*.png`의 앱 검증에 사용한 사진은 nenadstojkovicart의 [침실 사진](https://www.flickr.com/photos/202846129@N03/54584134746)이며 [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)이다. 앱 표시용으로 축소·재인코딩했다. 사진 원본은 저장소와 배포물에 포함하지 않는다. 평가용 나머지 사진의 작성자·라이선스는 `eval/photo/manifest.json`에 보관한다.
