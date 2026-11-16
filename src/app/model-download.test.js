import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTextModel } from './model-download.js';

const id = 'gemma-4-E2B-it-q4f16_1-MLC';
const base = `https://huggingface.co/mlc-ai/${id}/resolve/main/`;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(count = 6) {
  const stores = new Map(),
    requests = [];
  const cacheStorage = {
    open: async (scope) => {
      if (!stores.has(scope)) stores.set(scope, new Map());
      const data = stores.get(scope);
      return {
        keys: async () => [...data.keys()].map((url) => ({ url })),
        match: async (url) => (data.has(url) ? new Response(data.get(url)) : undefined),
        put: async (url, response) => data.set(url, await response.arrayBuffer()),
      };
    },
  };
  const records = Array.from({ length: count }, (_, n) => ({
    dataPath: `params_shard_${n}.bin`,
    nbytes: 4,
  }));
  const fetcher = async (url) => {
    requests.push(url);
    if (url.endsWith('tensor-cache.json')) return Response.json({ records });
    if (url.endsWith('mlc-chat-config.json'))
      return Response.json({ tokenizer_files: ['tokenizer.json'] });
    return new Response(new Uint8Array(4));
  };
  return { cacheStorage, stores, requests, fetcher, records };
}

test(
  '느린 실행 파일·토크나이저와 별개로 가중치를 받고, 조각이 끝나기 전 받은 양을 알린다',
  { timeout: 5000 },
  async (t) => {
    const f = fixture(),
      gate = deferred(),
      first = deferred(),
      updates = [];
    t.after(() => gate.resolve());
    const pending = prepareTextModel(
      id,
      (r) => {
        updates.push(r);
        if (r.mb > 0) first.resolve();
      },
      {
        ...f,
        library: 'https://example.test/model.wasm',
        fetcher: async (url) => {
          if (/wasm$|tokenizer.json$/.test(url)) await gate.promise;
          if (/params_shard_/.test(url)) {
            f.requests.push(url);
            let sent = false;
            return new Response(
              new ReadableStream({
                async pull(c) {
                  if (!sent) {
                    sent = true;
                    c.enqueue(new Uint8Array(2));
                  } else {
                    await gate.promise;
                    c.enqueue(new Uint8Array(2));
                    c.close();
                  }
                },
              }),
            );
          }
          return f.fetcher(url);
        },
      },
    );
    await first.promise;
    assert.equal(f.requests.filter((u) => /params_shard_/.test(u)).length, 4);
    assert.equal(f.stores.get('webllm/model').has(base + 'params_shard_0.bin'), false);
    assert.ok(updates.some((r) => r.progress > 0 && r.progress < 1));
    gate.resolve();
    await pending;
    assert.equal(updates.at(-1).progress, 1);
    assert.equal(updates.at(-1).mb, 24 / 1000000);
    // 엔진과 같은 namespace/URL을 쓰므로 다음 방문에는 네트워크를 쓰지 않는다.
    const before = f.requests.length;
    await prepareTextModel(id, () => {}, { ...f, library: 'https://example.test/model.wasm' });
    assert.equal(f.requests.length, before);
  },
);

test('실패한 조각은 보관하지 않고 완료된 조각은 다시 받지 않는다', async () => {
  const f = fixture(2);
  const updates = [];
  const cache = await f.cacheStorage.open('webllm/model');
  await cache.put(base + f.records[0].dataPath, new Response(new Uint8Array(4)));
  await assert.rejects(
    prepareTextModel(id, (r) => updates.push(r), {
      ...f,
      fetcher: async (url) =>
        url.endsWith('params_shard_1.bin') ? new Response(new Uint8Array(2)) : f.fetcher(url),
    }),
    /complete model file/,
  );
  assert.equal(f.stores.get('webllm/model').has(base + f.records[1].dataPath), false);
  assert.equal(updates[0].progress, 0.5);
  await prepareTextModel(id, () => {}, f);
  assert.equal(f.requests.filter((url) => url.endsWith('params_shard_0.bin')).length, 0);
  assert.equal(f.requests.filter((url) => url.endsWith('params_shard_1.bin')).length, 1);
});

test('설정 요청이 실패하면 다른 전송을 중단하고 오류를 돌려준다', async () => {
  const f = fixture(1),
    aborted = deferred();
  await assert.rejects(
    prepareTextModel(id, () => {}, {
      ...f,
      fetcher: async (url, { signal }) => {
        if (url.endsWith('mlc-chat-config.json')) return new Response('', { status: 503 });
        return new Promise((_, reject) => {
          const stop = () => {
            aborted.resolve();
            reject(signal.reason);
          };
          if (signal.aborted) stop();
          else signal.addEventListener('abort', stop, { once: true });
        });
      },
    }),
    /HTTP 503/,
  );
  await aborted.promise;
});
