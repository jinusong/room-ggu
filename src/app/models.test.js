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
} from './models.js';

test('기본 상담 모델은 가장 가벼운 후보이고 모르는 선택은 기본으로 돌아간다', () => {
  const sizes = Object.values(TEXT_MODELS).map((m) => m.downloadMB);
  assert.equal(TEXT_MODELS[DEFAULT_TEXT_MODEL].downloadMB, Math.min(...sizes));
  assert.equal(textModel('large').name, 'Gemma 4 E2B');
  for (const bad of [undefined, null, '', 'huge', '__proto__', 'constructor'])
    assert.equal(textModel(bad).key, DEFAULT_TEXT_MODEL);
  assert.equal(modelName('gemma-4-E2B-it-q4f16_1-MLC'), 'Gemma 4 E2B');
  assert.equal(modelName('gemma3-1b-it-q4f16_1-MLC'), 'Gemma 3 1B');
  assert.equal(modelName('Qwen3-0.6B-q4f32_1-MLC'), 'Qwen3 0.6B');
  assert.equal(sizeText(600), '600MB');
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
