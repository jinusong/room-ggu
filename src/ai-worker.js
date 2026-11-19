// 브라우저 Worker에서 공개 가중치 모델을 실행한다. 대화와 사진은 이 기기 밖으로 보내지 않는다.
// - 상담 모델: Gemma 4 E2B가 기본이며 Gemma 3 1B·Qwen3 0.6B·1.7B도 직접 고른다.
//   어느 모델이든 문장을 해석해 같은 JSON 스키마로 답한다.
// - 사진 모델: Transformers.js의 SigLIP이 사진과 20가지 가구 이름을 비교해 점수를 낸다.
import { TYPES, ROOM_TYPES, WALL_COLORS, FLOOR_COLORS, FURNITURE_COLORS } from './catalog.js';
import { MODEL_ACTIONS, MODEL_UI } from './ui-schema.js';
import { PHOTO_MODEL, PHOTO_LABELS } from './app/photo.js';
import { textModel, modelCached } from './app/models.js';
import { prepareTextModel } from './app/model-download.js';
import { designSchema, designPrompt } from './app/design.js';

let engine = null,
  textId = null,
  textChoice = null,
  classifier = null,
  classifierKey = '';
const emit = (task, detail) => self.postMessage({ event: 'progress', task, ...detail });

async function unloadText() {
  if (!engine) return;
  await engine.unload();
  engine = null;
  textId = null;
  self.postMessage({ event: 'unloaded', task: 'text' });
}
async function unloadClassifier() {
  if (!classifier) return;
  await classifier.dispose?.();
  classifier = null;
  classifierKey = '';
  self.postMessage({ event: 'unloaded', task: 'vision' });
}

async function loadText(choice) {
  if (engine && (!choice || textModel(choice) === textModel(textChoice))) return textId;
  if (engine) await unloadText();
  if (!self.navigator.gpu)
    throw Error('이 브라우저는 WebGPU를 지원하지 않아요. 상담은 규칙으로 계속할 수 있어요.');
  const adapter = await self.navigator.gpu.requestAdapter();
  if (!adapter)
    throw Error('사용할 수 있는 GPU를 찾지 못했어요. 브라우저 하드웨어 가속을 확인해 주세요.');
  const model = textModel(choice),
    preferred = adapter.features.has('shader-f16') ? model.f16 : model.f32;
  const cached = await modelCached(preferred);
  if (!cached) emit('text', { phase: 'connect', model: preferred });
  // 무거운 라이브러리를 읽는 동안에도 설정·가중치를 먼저 받는다. 실행 파일과 토크나이저도
  // 가중치와 함께 받아, WebLLM.reload의 순차 다운로드와 중복 요청을 피한다.
  const sdk = import('@mlc-ai/web-llm');
  const library = sdk.then(({ prebuiltAppConfig }) => {
    const record = prebuiltAppConfig.model_list.find((x) => x.model_id === preferred);
    if (!record) throw Error('이 버전에서 지원하는 모델을 찾지 못했어요.');
    return record.model_lib;
  });
  await prepareTextModel(
    preferred,
    (r) => {
      if (!cached) emit('text', { ...r, model: preferred });
    },
    { library },
  );
  if (!cached) emit('text', { phase: 'init', progress: 1, model: preferred });
  const { MLCEngine } = await sdk;
  engine = new MLCEngine({
    initProgressCallback: (r) =>
      emit('text', { progress: r.progress, text: r.text, model: preferred }),
  });
  try {
    await engine.reload(preferred);
    textId = preferred;
    textChoice = model.key;
    return preferred;
  } catch (e) {
    await unloadText();
    throw e;
  }
}

const names = (list) => list.map(([n]) => n);
const REQUIRED = [
  'intent',
  'action',
  'furniture',
  'room_type',
  'space',
  'seats',
  'size',
  'depth',
  'height',
  'color',
  'wall',
  'floor',
  'ui',
  'reply',
];
function interpretSchema(spaces, compact = false) {
  return {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['furniture', 'room', 'action', 'chat'] },
      action: { type: 'string', enum: MODEL_ACTIONS },
      furniture: { type: 'string', enum: [...Object.keys(TYPES), 'none'] },
      room_type: { type: 'string', enum: [...Object.keys(ROOM_TYPES), 'none'] },
      space: { type: 'string', enum: [...new Set(spaces), 'none'] },
      seats: { type: ['integer', 'null'], enum: [1, 2, 3, 4, null] },
      size: { type: 'string', enum: ['unknown', 'compact', 'standard', 'large'] },
      depth: { type: 'string', enum: ['unknown', 'shallow', 'deep'] },
      height: { type: 'string', enum: ['unknown', 'low', 'tall'] },
      color: { type: 'string', enum: [...names(FURNITURE_COLORS), 'none'] },
      wall: { type: 'string', enum: [...names(WALL_COLORS), 'none'] },
      floor: { type: 'string', enum: [...names(FLOOR_COLORS), 'none'] },
      ui: { type: 'string', enum: [...Object.keys(MODEL_UI), 'none'] },
      reply: compact ? { type: 'string', enum: [''] } : { type: 'string' },
    },
    required: REQUIRED,
    additionalProperties: false,
  };
}
const typeList = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${k} ${v.name}`)
    .join(', ');

// 작은 Gemma는 형식 예시의 가구를 답에 옮기기 쉬워 종류가 비어 있는 예시를 쓴다.
const oneLineExample = (neutral) =>
  JSON.stringify({
    intent: 'furniture',
    action: 'none',
    furniture: neutral ? 'none' : 'sofa',
    room_type: 'none',
    space: 'none',
    seats: neutral ? null : 2,
    size: 'unknown',
    depth: 'unknown',
    height: neutral ? 'unknown' : 'low',
    color: 'none',
    wall: 'none',
    floor: 'none',
    ui: neutral ? 'none' : 'furniture_sizes',
    reply: '',
  });

async function interpret(payload) {
  await loadText();
  const compact = textId.startsWith('Qwen3-0.6B');
  const c = payload.context || {};
  const spaces = (c.spaces || []).filter((s) => typeof s === 'string' && s).slice(0, 12);
  const prompt = `룸꾸 상담. 요청을 JSON으로 해석하세요.
intent: furniture 가구, room 방 유형·치수·마감, action 동작, chat 질문·인사.
action: place 초안 놓기, undo 되돌리기, redo 다시 실행, rotate 회전, duplicate 복제, delete 삭제, relocate 겹침 정리, clear 비우기, example 예시, catalog 가구 고르기, spaces 공간 목록, items 놓인 가구 목록, files 저장·불러오기, help 사용법, ai 모델 설정, new_space 공간 추가, switch_space 공간 이동.
furniture: ${typeList(TYPES)}.
room_type: ${typeList(ROOM_TYPES)}. space는 가려는 방 이름. “A 옆에 B 추가”, “A 말고 B”에서 A는 변경 대상이 아닙니다.
seats: 소파 인원. size compact/standard/large, depth shallow/deep, height low/tall.
color 가구: ${names(FURNITURE_COLORS).join(', ')}. wall 벽: ${names(WALL_COLORS).join(', ')}. floor 바닥: ${names(FLOOR_COLORS).join(', ')}.
ui: room_size 치수, room_type 방 유형, finishes 마감, furniture_sizes 규격, furniture_dims 가구 치수, furniture_color 가구 색.
앱이 숫자를 읽습니다. 새 가구나 치수 편집은 action none. place는 떠 있는 초안을 그대로 놓을 때만. 요청에 있는 속성만 고르세요. “두 명이 앉는 낮은 소파” → sofa, seats 2, height low. “따뜻한 벽, 짙은 원목 바닥” → 샌드, 월넛.
reply: ${compact ? '빈 문자열.' : '편집 요청은 빈 문자열. 질문에는 한국어 한 문장.'} 사진을 봤거나 치수를 쟀다고 말하지 마세요.
공간: ${c.room || '방'}. 대상: ${c.target || '방'}.
${c.furniture?.length ? `놓인 종류: ${c.furniture.join(', ')}. ` : ''}${spaces.length ? `다른 방: ${spaces.join(', ')}. ` : ''}${c.photo || ''}
한 줄 예시: ${oneLineExample(textId.startsWith('gemma3-1b-'))}
최근 사용자 요청: ${(payload.history || [])
    .filter((t) => t.role === 'user')
    .slice(-2)
    .map((t) => t.content.slice(0, 160))
    .join(' / ')}
요청: ${String(payload.text || '').slice(0, 1500)}
JSON(한 줄):`;
  const r = await engine.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 384,
    temperature: 0.1,
    response_format: {
      type: 'json_object',
      schema: JSON.stringify(interpretSchema(spaces, compact)),
    },
    ...(textId.startsWith('Qwen3') ? { enable_thinking: false } : {}),
  });
  if (import.meta.env.MODE === 'benchmark' && payload.qa) {
    self.postMessage({
      qa: {
        contract: 'one-line',
        promptChars: prompt.length,
        ...r.usage,
        finish: r.choices[0]?.finish_reason,
      },
    });
  }
  if (r.choices[0]?.finish_reason === 'length') throw Error('모델 답이 길어져 중단했어요.');
  return r.choices[0]?.message?.content || '';
}

async function design(payload) {
  await loadText();
  const r = await engine.chat.completions.create({
    messages: [
      {
        role: 'user',
        content:
          designPrompt(payload.request) +
          (payload.correction
            ? `\nPrevious proposal failed validation: ${payload.correction}. Rewrite the COMPLETE JSON including all required rooms and furniture.`
            : ''),
      },
    ],
    max_tokens: 1800,
    temperature: 0.1,
    response_format: { type: 'json_object', schema: JSON.stringify(designSchema(payload.request)) },
    ...(textId.startsWith('Qwen3') ? { enable_thinking: false } : {}),
  });
  if (r.choices[0]?.finish_reason === 'length')
    throw Error('집 전체 초안이 길어져 중단했어요. 공간 수를 나눠 요청해 주세요.');
  return r.choices[0]?.message?.content || '';
}

// 사진 분류. f16을 지원하는 GPU는 4비트 가중치(약 150MB), 아니면 CPU용 8비트(약 210MB)를 쓴다.
async function classify(payload) {
  let device = payload.device === 'wasm' ? 'wasm' : 'webgpu',
    dtype = 'q8';
  if (device === 'webgpu') {
    const adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter() : null;
    if (adapter?.features.has('shader-f16')) dtype = 'q4f16';
    else device = 'wasm';
  }
  const key = `${device}|${dtype}`;
  if (classifierKey !== key) {
    await unloadClassifier();
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    classifier = await pipeline('zero-shot-image-classification', PHOTO_MODEL, {
      device,
      dtype,
      progress_callback: (r) =>
        emit('vision', {
          status: r.status,
          progress: typeof r.progress === 'number' ? r.progress / 100 : undefined,
          file: r.file,
          loaded: r.loaded,
          total: r.total,
        }),
    });
    classifierKey = key;
  }
  const out = await classifier(
    payload.image,
    PHOTO_LABELS.map(([, label]) => label),
    { hypothesis_template: 'a photo of {}' },
  );
  return {
    device,
    scores: out.map((r) => ({
      type: PHOTO_LABELS.find(([, label]) => label === r.label)?.[0],
      score: r.score,
    })),
  };
}

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  // 진행 중인 답 생성을 멈추는 요청은 줄을 서지 않고 바로 처리한다.
  if (data.task === 'interrupt') {
    engine?.interruptGenerate();
    return;
  }
  queue = queue.then(async () => {
    try {
      let result;
      switch (data.task) {
        case 'load-text':
          result = await loadText(data.payload?.choice);
          break;
        case 'interpret':
          result = await interpret(data.payload);
          break;
        case 'design':
          result = await design(data.payload);
          break;
        case 'classify':
          result = await classify(data.payload);
          break;
        case 'unload':
          await unloadText();
          await unloadClassifier();
          result = true;
          break;
        default:
          throw Error('알 수 없는 AI 요청');
      }
      self.postMessage({ id: data.id, result });
    } catch (e) {
      self.postMessage({ id: data.id, error: e.message || String(e) });
    }
  });
};
