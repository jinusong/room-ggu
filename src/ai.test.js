import test from 'node:test';
import assert from 'node:assert/strict';
import { runAI, stopAI, interruptAI, onAIStatus } from './ai.js';

test('상담을 받는 동안 사진을 실행하고 한쪽 취소·오류가 다른 쪽을 멈추지 않는다', async () => {
  const before = globalThis.Worker,
    instances = [],
    events = [];
  globalThis.Worker = class {
    constructor() {
      this.messages = [];
      instances.push(this);
    }
    postMessage(data) {
      this.messages.push(data);
    }
    terminate() {
      this.terminated = true;
    }
    respond(data) {
      this.onmessage({ data });
    }
  };
  onAIStatus((data) => events.push(data));
  try {
    const text = runAI('load-text');
    const vision = runAI('classify');
    assert.equal(instances.length, 2);
    const [a, b] = instances;
    b.respond({ id: b.messages[0].id, result: { scores: [{ type: 'bed', score: 0.98 }] } });
    assert.equal((await vision).scores[0].type, 'bed');
    assert.equal(a.terminated, undefined);
    const cancelled = runAI('classify');
    const rejected = assert.rejects(cancelled, /사진 취소/);
    stopAI('사진 취소', 'vision');
    await rejected;
    assert.equal(a.terminated, undefined);
    const count = events.length;
    b.respond({ event: 'progress', task: 'vision', progress: 1 });
    assert.equal(events.length, count); // 종료한 Worker의 늦은 결과는 무시한다.
    interruptAI();
    assert.equal(a.messages.at(-1).task, 'interrupt');
    a.respond({ id: a.messages[0].id, result: 'Gemma ready' });
    assert.equal(await text, 'Gemma ready');
    const nextPhoto = runAI('classify');
    const textFailure = runAI('interpret');
    const failed = assert.rejects(textFailure, /AI 작업/);
    a.onerror();
    await failed;
    const c = instances[2];
    b.onerror(); // 종료한 사진 Worker의 늦은 오류도 새 Worker를 끄면 안 된다.
    assert.equal(c.terminated, undefined);
    c.respond({ id: c.messages[0].id, result: 'photo ready' });
    assert.equal(await nextPhoto, 'photo ready');
  } finally {
    stopAI();
    onAIStatus(() => {});
    if (before) globalThis.Worker = before;
    else delete globalThis.Worker;
  }
});
