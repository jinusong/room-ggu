import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOWNLOAD_START,
  TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  textModel,
  modelName,
  sizeText,
  parseProgress,
  explainLoadError,
  handheld,
  modelCached,
  modelMissing,
} from './models.js';

test('기본 상담 모델은 Gemma 4 E2B이고 모르는 선택은 기본으로 돌아간다', () => {
  assert.equal(DEFAULT_TEXT_MODEL, 'large');
  assert.equal(TEXT_MODELS[DEFAULT_TEXT_MODEL].f16, 'gemma-4-E2B-it-q4f16_1-MLC');
  assert.equal(TEXT_MODELS[DEFAULT_TEXT_MODEL].f32, 'gemma-4-E2B-it-q4f32_1-MLC');
  assert.equal(textModel('large').name, 'Gemma 4 E2B');
  for (const bad of [undefined, null, '', 'huge', '__proto__', 'constructor'])
    assert.equal(textModel(bad).key, DEFAULT_TEXT_MODEL);
  assert.equal(modelName('gemma-4-E2B-it-q4f16_1-MLC'), 'Gemma 4 E2B');
  assert.equal(modelName('gemma3-1b-it-q4f16_1-MLC'), 'Gemma 3 1B');
  assert.equal(modelName('Qwen3-0.6B-q4f32_1-MLC'), 'Qwen3 0.6B');
  assert.equal(sizeText(600), '600MB');
  assert.equal(sizeText(0.02), '<1MB');
  assert.equal(sizeText(0), '0MB');
  assert.equal(sizeText(2840), '2.8GB');
});
test('로더의 진행 문장에서 내려받기와 보관본 불러오기를 구별한다', () => {
  assert.deepEqual(
    parseProgress(
      'Fetching param cache[12/38]: 247MB fetched. 43% completed, 12 secs elapsed. It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.',
    ),
    { phase: 'fetch', mb: 247, percent: 43 },
  );
  assert.deepEqual(parseProgress(DOWNLOAD_START), { phase: 'fetch', mb: 0, percent: 0 });
  // 로더의 시작 문장은 보관본을 불러올 때도 나오므로 내려받기로 보지 않는다.
  assert.equal(parseProgress('Start to fetch params').phase, 'start');
  // 이미 받아 둔 모델은 다이얼로그를 띄우지 않는 단계로 읽는다.
  assert.equal(
    parseProgress('Loading model from cache[3/38]: 60MB loaded. 10% completed, 1 secs elapsed.')
      .phase,
    'cache',
  );
  assert.equal(
    parseProgress('Loading GPU shader modules[4/20]: 20% completed, 1 secs elapsed.').phase,
    'init',
  );
  assert.equal(parseProgress('Finish loading on WebGPU - apple').phase, 'init');
  assert.equal(parseProgress('').phase, 'start');
});
test('준비 실패 이유를 무슨 일이 왜 일어났는지 알 수 있는 말로 바꾼다', () => {
  assert.match(explainLoadError('TypeError: Failed to fetch'), /네트워크 연결이 끊겼어요/);
  assert.match(explainLoadError('QuotaExceededError: storage full'), /저장 공간이 부족/);
  assert.match(explainLoadError('GPUDevice lost: out of memory'), /GPU 메모리가 부족/);
  // 앱이 우리말로 적은 안내는 그대로 두고, 모르는 오류는 원문을 남긴다.
  assert.equal(
    explainLoadError('사용할 수 있는 GPU를 찾지 못했어요.'),
    '사용할 수 있는 GPU를 찾지 못했어요.',
  );
  assert.match(explainLoadError('unexpected token'), /문제가 생겼어요\. \(unexpected token\)/);
});

test('휴대 기기와 이동통신 연결에서는 큰 모델을 묻고 받는다', () => {
  const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    android =
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  assert.equal(handheld({ userAgent: mac, maxTouchPoints: 0 }), false);
  assert.equal(handheld({ userAgent: iphone, maxTouchPoints: 5 }), true);
  assert.equal(handheld({ userAgent: android, maxTouchPoints: 5 }), true);
  // iPadOS는 Mac으로 소개하지만 터치 점이 여러 개다.
  assert.equal(handheld({ userAgent: mac, maxTouchPoints: 5 }), true);
  assert.equal(handheld({ userAgent: mac, userAgentData: { mobile: true } }), true);
  assert.equal(handheld({ userAgent: mac, connection: { type: 'cellular' } }), true);
  assert.equal(handheld({ userAgent: mac, connection: { type: 'wifi' } }), false);
  assert.equal(handheld(null), false);
});

test('모델 조각이 모두 보관돼 있을 때만 받아 둔 모델로 본다', async () => {
  const id = 'gemma3-1b-it-q4f16_1-MLC',
    base = `https://huggingface.co/mlc-ai/${id}/resolve/main/`,
    records = [
      { dataPath: 'params_shard_0.bin', nbytes: 30 * 1000000 },
      { dataPath: 'params_shard_1.bin', nbytes: 12.2 * 1000000 },
    ];
  const fake = (files) => {
    const urls = files.map((f) => base + f);
    globalThis.caches = {
      open: async () => ({
        keys: async () => urls.map((url) => ({ url })),
        match: async () => ({ json: async () => ({ records }) }),
      }),
    };
  };
  const before = globalThis.caches;
  try {
    fake(['ndarray-cache.json', 'params_shard_0.bin', 'params_shard_1.bin']);
    assert.equal(await modelCached(id), true);
    // 새 모델은 조각 목록 이름이 tensor-cache.json이다(실제 Gemma 3 1B 캐시에서 확인).
    fake(['tokenizer.json', 'tensor-cache.json', 'params_shard_1.bin', 'params_shard_0.bin']);
    assert.equal(await modelCached(id), true);
    fake(['tensor-cache.json', 'params_shard_1.bin']);
    assert.equal(await modelCached(id), false);
    // 남은 양은 빠진 조각의 크기를 더한 값이다. 조각 목록이 없으면 알 수 없다.
    assert.deepEqual(await modelMissing(id), { cached: false, missingMB: 30 });
    fake(['tensor-cache.json', 'params_shard_0.bin']);
    assert.deepEqual(await modelMissing(id), { cached: false, missingMB: 13 });
    fake(['tensor-cache.json', 'params_shard_0.bin', 'params_shard_1.bin']);
    assert.deepEqual(await modelMissing(id), { cached: true, missingMB: 0 });
    fake(['tokenizer.json']);
    assert.deepEqual(await modelMissing(id), { cached: false, missingMB: null });
    // 받다 만 모델은 아직 받을 것이 남았다.
    fake(['ndarray-cache.json', 'params_shard_0.bin']);
    assert.equal(await modelCached(id), false);
    fake(['params_shard_0.bin', 'params_shard_1.bin']);
    assert.equal(await modelCached(id), false);
    // 다른 모델의 조각은 세지 않는다.
    fake(['ndarray-cache.json', 'params_shard_0.bin', 'params_shard_1.bin']);
    assert.equal(await modelCached('Qwen3-0.6B-q4f32_1-MLC'), false);
    // 캐시를 쓸 수 없는 브라우저에서는 없다고 본다.
    globalThis.caches = {
      open: async () => {
        throw Error('blocked');
      },
    };
    assert.equal(await modelCached(id), false);
    delete globalThis.caches;
    assert.equal(await modelCached(id), false);
  } finally {
    if (before) globalThis.caches = before;
    else delete globalThis.caches;
  }
});

test('선택한 Qwen 크기와 실제 실행 이름을 구분하고 모든 후보가 설치 SDK에서 실행 가능한 ID다', async () => {
  const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  assert.equal(textModel('qwen').name, 'Qwen3 0.6B');
  assert.equal(textModel('balanced').name, 'Qwen3 1.7B');
  assert.equal(modelName(TEXT_MODELS.balanced.f16), 'Qwen3 1.7B');
  for (const m of Object.values(TEXT_MODELS))
    for (const id of [m.f16, m.f32])
      assert.ok(
        prebuiltAppConfig.model_list.some((r) => r.model_id === id),
        id,
      );
});
