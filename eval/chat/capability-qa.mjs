// 모델 원시 응답과 앱 보정 뒤 결과를 함께 기록한다. 모델별 우열 점수로 해석하지 않는다.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const results = process.env.MODEL
  ? JSON.parse(readFileSync('eval/chat/results/capabilities-v5.11.json', 'utf8')).results.filter(
      (r) => r.model !== process.env.MODEL,
    )
  : [];
for (const model of process.env.MODEL
  ? [process.env.MODEL]
  : ['large', 'light', 'qwen', 'balanced']) {
  const ctx = await chromium.launchPersistentContext('.cache/capability-profile', {
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu'],
    viewport: { width: 1440, height: 900 },
  });
  await ctx.route('http://127.0.0.1:4187/**', async (route) => {
    const res = await route.fetch({
      url: route.request().url().replace('http://127.0.0.1:4187', 'http://127.0.0.1:4173'),
    });
    await route.fulfill({ response: res });
  });
  await ctx.addInitScript((choice) => {
    localStorage.setItem('room-ggu-model-choice', choice);
    localStorage.removeItem('room-ggu-model');
    localStorage.removeItem('room-ggu-v2');
    localStorage.removeItem('room-ggu-thread-v1');
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', (e) => {
          if (typeof e.data.result === 'string') window.__capRaw = e.data.result;
        });
      }
    };
  }, model);
  const p = ctx.pages()[0] || (await ctx.newPage());
  const record = { model, at: new Date().toISOString(), cases: [], errors: [] };
  results.push(record);
  try {
    await p.goto('http://127.0.0.1:4187/');
    await p.waitForFunction(() => window.__roomggu?.ready());
    for (let i = 0; i < 600; i++) {
      const status = await p.evaluate(() => {
        const a = window.__roomggu.app.ai;
        return {
          status: a.text,
          label: a.label,
          progress: a.progress,
          error: a.error,
          download: a.download,
        };
      });
      if (i % 15 === 0) console.log('loading', model, JSON.stringify(status));
      if (['ready', 'error', 'unsupported', 'off'].includes(status.status)) break;
      if (i === 599) throw Error('모델 준비 10분 초과');
      await p.waitForTimeout(1000);
    }
    record.ai = await p.evaluate(() => ({
      status: window.__roomggu.app.ai.text,
      id: window.__roomggu.app.ai.model,
      error: window.__roomggu.app.ai.error,
    }));
    if (record.ai.status !== 'ready') throw Error(JSON.stringify(record.ai));
    for (const [category, text, check] of [
      [
        '가구',
        '책상 가로 140cm 깊이 70cm 하나 놓아줘',
        (d) =>
          assert.deepEqual(
            d.draft.dims.filter((_, i) => i !== 1),
            [140, 70],
          ),
      ],
      ['새 가구', '화장대 하나 놓아줘', (d) => assert.equal(d.draft.type, 'vanity')],
      [
        '방',
        '거실 가로 5m 세로 4m로 바꿔줘',
        (d) => {
          assert.equal(d.state.room.type, 'living');
          assert.equal(d.state.room.w, 5);
          assert.equal(d.state.room.d, 4);
        },
      ],
      ['복수 요청', '소파랑 식탁이랑 책상 놓고 싶어', (d) => assert.equal(1 + d.queue.length, 3)],
      [
        '분위기',
        '벽은 따뜻한 느낌으로 하고 바닥은 짙은 원목으로',
        (d) => {
          assert.notEqual(d.state.room.wallColor, '#faf9f5');
          assert.equal(d.state.room.floorColor, '#93785c');
        },
      ],
      [
        '집 전체',
        '100평 집 전체를 재팬디로 꾸며줘',
        (d) => {
          assert.ok(d.design);
          assert.equal(d.design.theme, 'japandi');
          assert.equal(d.design.state.otherRooms.length, 11);
        },
      ],
    ]) {
      await p.evaluate(async () => {
        const { freshState } = await import('/src/data.js');
        const { app, store } = window.__roomggu;
        Object.assign(app.state, freshState());
        app.thread = [];
        app.draft = null;
        app.queue = [];
        app.design = null;
        app.history = [];
        app.future = [];
        store.setTarget({ type: 'room' });
        store.emit();
        window.__capRaw = null;
      });
      const start = Date.now();
      await p.locator('#chat-input').fill(text);
      await p.getByRole('button', { name: '설명 보내기' }).click();
      await p.waitForFunction(() => !window.__roomggu.app.busy, null, { timeout: 110000 });
      const d = await p.evaluate(() => {
        const a = window.__roomggu.app;
        return {
          state: a.state,
          draft: a.draft,
          queue: a.queue,
          design: a.design,
          turn: a.thread.filter((t) => t.role === 'assistant').at(-1),
          raw: window.__capRaw,
        };
      });
      const c = {
        category,
        text,
        ms: Date.now() - start,
        engine: d.turn.engine,
        fallback: d.turn.fallback,
        fixes: d.turn.fixes || [],
        raw: d.raw,
        passed: false,
      };
      try {
        assert.ok(['gemma', 'qwen'].includes(c.engine) && !c.fallback, '실제 모델 추론 필요');
        assert.notEqual(d.turn.tone, 'error');
        check(d);
        c.passed = true;
      } catch (e) {
        c.error = e.message;
      }
      record.cases.push(c);
      console.log(model, category, c.passed, c.ms, c.fixes.length);
      mkdirSync('eval/chat/results', { recursive: true });
      writeFileSync(
        'eval/chat/results/capabilities-v5.11.json',
        JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n',
      );
    }
  } catch (e) {
    record.errors.push(e.message);
    console.log(model, e.message);
  } finally {
    await ctx.close();
  }
}
mkdirSync('eval/chat/results', { recursive: true });
writeFileSync(
  'eval/chat/results/capabilities-v5.11.json',
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n',
);
