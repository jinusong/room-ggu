# Third-party notices

## User-supplied prototype

3D 가구 기본 형상과 RoomScene의 초기 구조는 사용자가 제공한 BODY-SCALE 팀원 전달 ZIP을 바탕으로 수정했습니다. 원본 신체 측정 흐름은 상담형 가구 등록 흐름으로 교체했습니다.

## Development skills

- **unslop** — Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), [upstream](https://github.com/heydamir/unslop), **CC BY 4.0**. 원본 크레딧을 스킬과 참조에 유지했습니다. 디자인 방향·간격·색상·아이콘·타이포그래피·레이아웃 검토에 사용합니다.
- **humanizer** — [blader/humanizer](https://github.com/blader/humanizer), **MIT**. 라이선스는 `.agents/skills/humanizer/LICENSE`에 있습니다.
- **answer-me-with-html** — [QingYunA/answer-me-with-html](https://github.com/QingYunA/answer-me-with-html), **MIT**. 원본 고지와 CLI를 공용 스킬에 보존합니다.

정확한 소스 리비전과 설치 경로는 `.agents/skills/skills-lock.json`에 기록합니다. 이 스킬들은 개발 도구이며 브라우저 앱에 포함되지 않습니다.

## Runtime libraries and models

Three.js (MIT), Preact (MIT), Lucide (ISC), Vite (MIT), esbuild (MIT), WebLLM (Apache-2.0), Transformers.js (Apache-2.0)를 사용합니다. 글꼴은 [Pretendard](https://github.com/orioncactus/pretendard)(SIL OFL 1.1, jsDelivr에서 불러옴)와 [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)(SIL OFL 1.1, @fontsource로 번들)입니다. 각 패키지의 저작권과 라이선스는 해당 upstream 및 npm 배포물에 있습니다.

Gemma 모델은 Google Gemma 이용 조건을 따릅니다. [Gemma terms](https://ai.google.dev/gemma/terms). Qwen3 모델은 모델 카드의 라이선스(Apache-2.0)를 따릅니다. 사진 판별의 SigLIP(`google/siglip-base-patch16-224`, Apache-2.0)은 Transformers.js용 ONNX 변환본 [`Xenova/siglip-base-patch16-224`](https://huggingface.co/Xenova/siglip-base-patch16-224)을 씁니다. 모델 가중치는 이 저장소에 포함하지 않으며 사용자 브라우저가 공개 저장소에서 내려받습니다.

사진 평가(`eval/photo/`)는 Openverse·Wikimedia Commons의 CC 라이선스 사진 118장을 씁니다. 사진 파일은 저장소에 넣지 않고, 원본 주소·작성자·라이선스를 `eval/photo/manifest.json`에 남겼습니다. 이전 사진 모델 SmolVLM 256M(Apache-2.0)은 기준선 측정에만 썼습니다. `docs/screenshots/photo.png`·`mobile-photo.png`의 사진은 StockSnap의 CC0 사진(Kristin Hardwick, Ryan Riggins)입니다.
