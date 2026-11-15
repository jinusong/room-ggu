// 상담 모델 후보. id는 WebLLM 기본 목록의 이름이고, 크기는 공개 저장소에서 내려받는 파일 합계다(2026-11-14 확인).
// f16은 shader-f16을 지원하는 GPU, f32는 지원하지 않는 GPU에서 쓴다.
export const TEXT_MODELS = {
  light: {
    key: 'light',
    name: 'Gemma 3 1B',
    note: '가벼움 · 기본',
    f16: 'gemma3-1b-it-q4f16_1-MLC',
    f32: 'Qwen3-0.6B-q4f32_1-MLC',
    downloadMB: 600,
    vramMB: 711,
  },
  large: {
    key: 'large',
    name: 'Gemma 4 E2B',
    note: '더 큰 모델 · 직접 고를 때만',
    f16: 'gemma-4-E2B-it-q4f16_1-MLC',
    f32: 'gemma-4-E2B-it-q4f32_1-MLC',
    downloadMB: 2840,
    vramMB: 3387,
  },
};
export const DEFAULT_TEXT_MODEL = 'light';
export const textModel = (key) =>
  Object.hasOwn(TEXT_MODELS, key) ? TEXT_MODELS[key] : TEXT_MODELS[DEFAULT_TEXT_MODEL];
export function modelName(id) {
  const s = String(id || '');
  if (s.startsWith('gemma-4-E2B')) return 'Gemma 4 E2B';
  if (s.startsWith('gemma3-1b')) return 'Gemma 3 1B';
  if (s.startsWith('Qwen3')) return 'Qwen3 0.6B';
  return '상담 모델';
}
// 실제로 받는 파일 기준의 크기(MB). f16을 못 쓰는 GPU에서는 다른 파일을 받는다.
const DOWNLOAD_MB = {
  'gemma3-1b-it-q4f16_1-MLC': 600,
  'Qwen3-0.6B-q4f32_1-MLC': 350,
  'gemma-4-E2B-it-q4f16_1-MLC': 2840,
  'gemma-4-E2B-it-q4f32_1-MLC': 2840,
};
export const downloadSize = (id) => (Object.hasOwn(DOWNLOAD_MB, id) ? DOWNLOAD_MB[id] : 0);
export const sizeText = (mb) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)}GB` : `${Math.round(mb)}MB`;

// 로더가 던지는 영문 오류를 무슨 일이 왜 일어났는지 알 수 있는 말로 바꾼다. 모르는 오류는 원문을 덧붙인다.
export function explainLoadError(message = '') {
  const m = String(message);
  // 앱이 이미 우리말로 적은 안내는 그대로 둔다.
  if (/[가-힣]/.test(m)) return m;
  if (/quota|storage|QuotaExceeded/i.test(m))
    return '브라우저 저장 공간이 부족해 모델 파일을 보관하지 못했어요. 다른 사이트 데이터를 정리한 뒤 다시 시도해 주세요.';
  if (/failed to fetch|network|ERR_|load failed|timeout/i.test(m))
    return '모델 파일을 받는 중에 네트워크 연결이 끊겼어요. 연결을 확인한 뒤 다시 시도하면 받은 데서 이어서 받아요.';
  if (/device.*lost|out of memory|OOM|buffer|allocation|GPU/i.test(m))
    return 'GPU 메모리가 부족하거나 그래픽 장치가 멈췄어요. 다른 탭을 닫거나 더 가벼운 모델을 골라 주세요.';
  if (/WebGPU|shader-f16/i.test(m)) return '이 브라우저나 GPU에서는 이 모델을 실행할 수 없어요.';
  return m
    ? `모델을 준비하다 문제가 생겼어요. (${m.slice(0, 120)})`
    : '모델을 준비하다 문제가 생겼어요.';
}
export const DOWNLOAD_START = 'room-ggu: download start';
// 모델 로더가 보내는 진행 문장에서 단계와 받은 용량을 읽는다.
export function parseProgress(text = '') {
  const fetched = text.match(/(\d+)MB fetched\. (\d+)% completed/),
    loaded = text.match(/(\d+)MB loaded\. (\d+)% completed/);
  if (fetched) return { phase: 'fetch', mb: Number(fetched[1]), percent: Number(fetched[2]) };
  // Worker가 캐시에 가중치가 없다고 확인했을 때만 보내는 시작 신호다. 로더 자체의 "Start to fetch params"는
  // 보관본을 불러올 때도 나오므로 내려받기로 보지 않는다.
  if (text === DOWNLOAD_START) return { phase: 'fetch', mb: 0, percent: 0 };
  if (loaded) return { phase: 'cache', mb: Number(loaded[1]), percent: Number(loaded[2]) };
  if (/shader modules|Finish loading/i.test(text)) return { phase: 'init' };
  return { phase: 'start' };
}
