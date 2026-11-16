// WebLLM과 같은 URL·캐시를 쓴다. 가중치를 GPU 초기화·토크나이저 해석 뒤까지 미루지 않고
// 먼저 받으며, 조각 하나가 끝나기 전에도 실제로 들어온 바이트를 알린다.
const MB = 1000000;
const IDLE_MS = 45000;

export async function prepareTextModel(
  id,
  report,
  { cacheStorage = globalThis.caches, fetcher = globalThis.fetch, library } = {},
) {
  const controller = new AbortController();
  const base = `https://huggingface.co/mlc-ai/${id}/resolve/main/`;
  const modelCache = await cacheStorage.open('webllm/model');
  const configCache = await cacheStorage.open('webllm/config');
  let received = 0,
    total = 0,
    last = 0,
    reported = 0;
  const progress = (force = false) => {
    const now = performance.now();
    if (!force && reported > 0 && now - last < 100) return;
    last = now;
    reported = received;
    report({
      phase: 'fetch',
      mb: received / MB,
      totalMB: total / MB,
      progress: total ? received / total : 0,
    });
  };
  const file = async (cache, name, { bytes, onBytes } = {}) => {
    const url = new URL(name, base).href;
    const saved = await cache.match(url);
    if (saved) {
      if (onBytes) {
        await saved.body?.cancel();
        onBytes(bytes);
        return;
      }
      return saved;
    }
    let timer;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(Error('timeout: model download stalled')), IDLE_MS);
    };
    touch();
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) throw Error(`Failed to fetch model file: HTTP ${response.status}`);
      const reader = response.body.getReader();
      let loaded = 0;
      const stream = new ReadableStream({
        async pull(destination) {
          try {
            const { done, value } = await reader.read();
            touch();
            if (done) {
              if (bytes !== undefined && loaded !== bytes)
                throw Error('Failed to fetch complete model file');
              destination.close();
            } else {
              loaded += value.byteLength;
              onBytes?.(value.byteLength);
              destination.enqueue(value);
            }
          } catch (error) {
            destination.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      // Cache.put가 스트림을 소비하므로 큰 조각을 별도로 복제하지 않는다.
      await cache.put(url, new Response(stream, { headers: response.headers }));
      return onBytes ? undefined : cache.match(url);
    } finally {
      clearTimeout(timer);
    }
  };
  const add = (n) => {
    received += n;
    progress();
  };
  const jobs = [];
  const watch = (promise) => {
    jobs.push(promise);
    promise.catch((error) => controller.abort(error));
    return promise;
  };
  const discard = (response) => response?.body?.cancel();
  try {
    // 목록과 설정을 함께 받는다. 토크나이저·실행 파일 다운로드가 끝나길 기다리지 않는다.
    const indexJob = watch(file(modelCache, 'tensor-cache.json').then((r) => r.json()));
    const configJob = watch(file(configCache, 'mlc-chat-config.json').then((r) => r.json()));
    if (id.startsWith('gemma-4-'))
      watch(file(configCache, 'mlc-model-manifest.json').then(discard));
    if (library)
      watch(
        Promise.resolve(library)
          .then(async (url) => file(await cacheStorage.open('webllm/wasm'), url))
          .then(discard),
      );
    const index = await indexJob;
    const records = index.records;
    if (
      !Array.isArray(records) ||
      !records.length ||
      records.some(
        (r) =>
          !Number.isSafeInteger(r.nbytes) ||
          r.nbytes <= 0 ||
          typeof r.dataPath !== 'string' ||
          !/^params_shard_\d+\.bin$/.test(r.dataPath),
      )
    )
      throw Error('모델 파일 목록을 읽지 못했어요. 다시 시도해 주세요.');
    total = records.reduce((n, r) => n + r.nbytes, 0);
    const have = new Set((await modelCache.keys()).map((request) => request.url));
    const missing = records.filter((r) => !have.has(new URL(r.dataPath, base).href));
    // 이어받기는 이미 보관한 양을 한 번에 표시한다. 다음 조각의 첫 바이트를 기다리지 않는다.
    received = total - missing.reduce((n, r) => n + r.nbytes, 0);
    progress(true);
    // 고정된 네 구간 대신 빈 작업자가 다음 조각을 받는다. 느린 조각 하나가 나머지를 막지 않는다.
    let next = 0;
    const download = async () => {
      while (next < missing.length) {
        controller.signal.throwIfAborted();
        const record = missing[next++];
        await file(modelCache, record.dataPath, { bytes: record.nbytes, onBytes: add });
      }
    };
    Array.from({ length: Math.min(4, missing.length) }, () => watch(download()));
    watch(
      configJob.then((config) => {
        const name = config.tokenizer_files?.includes('tokenizer.json')
          ? 'tokenizer.json'
          : 'tokenizer.model';
        return file(modelCache, name).then(discard);
      }),
    );
    await Promise.all(jobs);
    progress(true);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled(jobs);
    throw error;
  }
}
