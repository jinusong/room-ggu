// 상담 모델 후보. ID·GPU 메모리는 설치된 WebLLM 목록과 대조하고, 다운로드는 공개 파일 합계의 대략값이다.
// f16은 shader-f16을 지원하는 GPU, f32는 지원하지 않는 GPU에서 쓴다.
export const TEXT_MODELS = {
  large: {
    key: 'large',
    name: 'Gemma 4 E2B',
    note: '기본 · 복잡한 상담부터',
    f16: 'gemma-4-E2B-it-q4f16_1-MLC',
    f32: 'gemma-4-E2B-it-q4f32_1-MLC',
    downloadMB: 2840,
    vramMB: 3387,
    vramF32MB: 3863,
  },
  qwen: {
    key: 'qwen',
    name: 'Qwen3 0.6B',
    note: '가장 작은 다운로드',
    f16: 'Qwen3-0.6B-q4f16_1-MLC',
    f32: 'Qwen3-0.6B-q4f32_1-MLC',
    downloadMB: 350,
    vramMB: 1403,
    vramF32MB: 1925,
  },
  light: {
    key: 'light',
    name: 'Gemma 3 1B',
    note: '적은 GPU 메모리',
    f16: 'gemma3-1b-it-q4f16_1-MLC',
    f32: 'Qwen3-0.6B-q4f32_1-MLC',
    downloadMB: 600,
    vramMB: 711,
    vramF32MB: 1925,
    f32Note: 'f16 미지원 기기에서는 Qwen3 0.6B 실행',
  },
  balanced: {
    key: 'balanced',
    name: 'Qwen3 1.7B',
    note: '중간 크기 · 비교해 보기',
    f16: 'Qwen3-1.7B-q4f16_1-MLC',
    f32: 'Qwen3-1.7B-q4f32_1-MLC',
    downloadMB: 1100,
    vramMB: 2037,
    vramF32MB: 2636,
  },
};
export const DEFAULT_TEXT_MODEL = 'large';
export const textModel = (key) =>
  Object.hasOwn(TEXT_MODELS, key) ? TEXT_MODELS[key] : TEXT_MODELS[DEFAULT_TEXT_MODEL];
export function modelName(id) {
  const s = String(id || '');
  if (s.startsWith('gemma-4-E2B')) return 'Gemma 4 E2B';
  if (s.startsWith('gemma3-1b')) return 'Gemma 3 1B';
  if (s.startsWith('Qwen3-1.7B')) return 'Qwen3 1.7B';
  if (s.startsWith('Qwen3-0.6B')) return 'Qwen3 0.6B';
  return '상담 모델';
}
// 실제로 받는 파일 기준의 크기(MB). f16을 못 쓰는 GPU에서는 다른 파일을 받는다.
const DOWNLOAD_MB = {
  'gemma3-1b-it-q4f16_1-MLC': 600,
  'Qwen3-0.6B-q4f32_1-MLC': 350,
  'Qwen3-0.6B-q4f16_1-MLC': 350,
  'Qwen3-1.7B-q4f16_1-MLC': 1100,
  'Qwen3-1.7B-q4f32_1-MLC': 1100,
  'gemma-4-E2B-it-q4f16_1-MLC': 2840,
  'gemma-4-E2B-it-q4f32_1-MLC': 2840,
};
export const downloadSize = (id) => (Object.hasOwn(DOWNLOAD_MB, id) ? DOWNLOAD_MB[id] : 0);
// 이 모델의 가중치 가운데 아직 받지 않은 양을 본다. 로더가 쓰는 캐시(webllm/model)에서 조각 목록을 읽어
// 빠진 조각의 크기를 더한다. 받다 만 모델을 다 받은 것으로 착각하지 않으려는 것이다.
// cached: 모두 보관됨. missingMB: 남은 양(MB). 조각 목록조차 없으면 얼마나 남았는지 알 수 없어 null이다.
export async function modelMissing(id) {
  try {
    const cache = await caches.open('webllm/model'),
      mine = (await cache.keys()).filter((r) => r.url.includes(`/${id}/`)),
      // 조각 목록의 파일 이름은 모델을 만든 시기에 따라 둘 중 하나다.
      index = mine.find((r) => /\/(tensor|ndarray)-cache\.json$/.test(r.url));
    if (!index) return { cached: false, missingMB: null };
    const records = (await (await cache.match(index)).json()).records || [],
      have = new Set(mine.map((r) => r.url.split('/').pop())),
      missing = records.filter((r) => !have.has(r.dataPath));
    if (!records.length) return { cached: false, missingMB: null };
    const bytes = missing.reduce((n, r) => n + (Number.isFinite(r.nbytes) ? r.nbytes : NaN), 0);
    return {
      cached: missing.length === 0,
      missingMB: Number.isFinite(bytes) ? Math.ceil(bytes / 1000000) : null,
    };
  } catch {
    return { cached: false, missingMB: null };
  }
}
export const modelCached = async (id) => (await modelMissing(id)).cached;
// 휴대 기기인지. 휴대 기기에서는 큰 모델 파일을 묻지 않고 받지 않는다.
export function handheld(nav = globalThis.navigator) {
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent || '';
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) ||
    nav.connection?.type === 'cellular'
  );
}
export const sizeText = (mb) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)}GB` : mb > 0 && mb < 1 ? '<1MB' : `${Math.round(mb)}MB`;

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
