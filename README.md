# 룸꾸 · room ggu

**사진 또는 대화로 내 가구를 등록하고, 2D·3D 방에 놓아보는 웹사이트.**

[사이트 열기](https://jinusong.github.io/room-ggu/) · [기획 원고](docs/product-plan.md) · [디자인 방향](docs/design-direction.md) · [검증 기록](docs/verification.md)

![룸꾸 데스크톱 편집기](docs/screenshots/desktop.png)

## 사용하기

1. **방 설정**에서 방 이름과 가로·세로·천장 높이를 입력합니다.
2. 사진을 올리거나 “두 명이 넉넉히 앉는 소파야”처럼 설명합니다. 아는 치수는 직접 입력할 수 있습니다.
3. 치수 카드에서 가로·깊이·전체 높이를 확인하고 **내 방에 놓아보기**를 누릅니다.
4. 가구를 드래그하고 회전합니다. 2D와 3D는 같은 데이터를 사용합니다.
5. **배치 저장**은 JSON, **이미지 저장**은 현재 화면 PNG를 내려받습니다. JSON으로 다른 기기에서 배치를 불러올 수 있습니다.

자동 저장은 현재 브라우저에만 적용됩니다. 사진과 대화 기록은 배치 파일에 포함하지 않습니다.

## 공개 모델과 개인정보

- **기본 상담:** 규칙 기반. 모델 다운로드 없이 유형·인원수·명시한 숫자로 치수 초안을 만듭니다.
- **Gemma 상담:** AI 설정에서 모델을 준비하면 `gemma3-1b-it-q4f16_1-MLC`를 WebLLM으로 실행합니다. f16 미지원 GPU에서는 지원되는 Qwen3 변형을 선택합니다.
- **사진 이해:** SmolVLM 256M의 q4 ONNX 모델을 Transformers.js로 실행합니다. 사진의 종류·형태를 파악하고 유형별 치수 초안을 만듭니다. 기본 GPU 방식과 CPU 호환 모드를 제공합니다.
- 최초 사용 시 공개 모델 파일을 내려받습니다. 모델은 브라우저 캐시에 보관될 수 있습니다. 사진·대화는 추론 서버로 보내지 않으며, 추론은 웹워커에서 실행합니다.
- 사진 모델과 텍스트 모델은 메모리를 아끼도록 번갈아 로드합니다. 최신 데스크톱 Chrome/Edge와 하드웨어 가속을 권장합니다. GPU·메모리가 부족해도 직접 입력과 2D 편집은 사용할 수 있습니다.

AI는 크기의 단서를 정리합니다. 앱이 유형·인원수·크기 단서를 편집 가능한 시작값에 반영하고, 사용자 설정을 보존합니다. 치수는 실측 결과가 아니므로 구매·설치 전 직접 확인해야 합니다. 3D 가구는 치수를 반영하는 기본 형상이며 사진에서 정교한 3D 모델을 복원하지 않습니다.

## 기능

가구 7종, 자유 회전, 복제·삭제, 5cm 이동 스냅, 벽 경계 제한, 회전 직사각형 SAT 충돌 검사, 벽까지 거리, 치수선, 실행 취소·다시 실행, JSON 검증·이전 프로토타입 파일 변환, PNG 내보내기, 모바일 편집 패널을 제공합니다.

## 실행

Node.js 22 이상에서:

```sh
npm ci
npm run dev
npm run verify
npm run test:e2e
npm run preview
```

로컬 브라우저 테스트는 설치된 Chrome을 사용합니다. CI에서는 Playwright Chromium을 설치해 실행합니다. `npm run test:e2e`는 상담·배치·2D 복원 후 3D 드래그·모바일·파일 검증을 확인합니다.

`npm run verify`는 공용 스킬 연결, JavaScript 구문, 핵심 계산 테스트, 정적 빌드를 검사합니다. `dist/`는 서버 없이 배포되는 정적 결과물입니다. 모델 가중치는 저장소에 포함하지 않습니다.

## Codex · Claude Code 공용 파이프라인

이 저장소를 두 도구의 작업 폴더로 열면 `AGENTS.md`와 `CLAUDE.md`가 같은 제품 규칙을 연결합니다.

| 스킬 | 역할 |
| --- | --- |
| `room-ggu-pipeline` | 기획 → 구현 → 디자인 → 문구 → 검증 → 배포 |
| `answer-me-with-html` | 기능 흐름·구조·기획을 한 페이지로 설명 |
| `unslop` | 간격·아이콘·레이아웃·색·타이포그래피·렌더링 검토 |
| `humanizer` | UI·오류·설명 문구를 자연스럽고 구체적으로 수정 |

Codex: `$room-ggu-pipeline`, Claude Code: `/room-ggu-pipeline`. 원본은 `.agents/skills/`, Claude 경로는 `.claude/skills/`의 상대 심볼릭 링크입니다. 새 채팅에서 프로젝트 스킬이 발견됩니다. 스킬은 저장소에 포함되어 있고, 정확한 버전은 `skills-lock.json`에 고정했습니다.

기획 페이지 다시 만들기:

```sh
node .agents/skills/answer-me-with-html/scripts/am.mjs render docs/product-plan.md -o docs/product-plan.html --no-open
```

디자인 검토에 사용한 **unslop by Damir Sokolovsky (@heydamir), CC BY 4.0**를 비롯한 출처는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.

## 배포

`main`에 푸시하면 GitHub Actions가 검증하고 GitHub Pages에 배포합니다. `base: './'`로 `/room-ggu/` 하위 경로를 지원합니다. 비밀키·백엔드·회원가입은 필요하지 않습니다.
