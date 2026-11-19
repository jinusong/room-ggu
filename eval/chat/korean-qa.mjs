// 같은 Chrome 프로필의 모델 캐시를 재사용한다. 앱 동작은 UI로 실행하고 Worker 메시지는 관찰한다.
// MODEL=large|light|qwen|balanced|off SET=tuning|holdout|all PROFILE=... FORWARD_ORIGIN=...
// BASELINE/AFTER 각각: node eval/chat/korean-qa.mjs http://127.0.0.1:4187/ /tmp/result.json
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { equal, deepEqual, ok } from 'node:assert/strict';
import { spaces } from '../../src/data.js';
import { cases, seed } from './korean-cases.mjs';

const [base = 'http://127.0.0.1:4187/', out = '/tmp/room-ggu-korean-eval.json'] =
  process.argv.slice(2);
const model = process.env.MODEL || 'large';
const set = process.env.SET || 'all';
const all = [...cases.tuning, ...cases.holdout];
const selected =
  set === 'all'
    ? all
    : set === 'placement'
      ? all.filter((c) => c.turns.some((t) => t.place))
      : cases[set];
const report = {
  model,
  set,
  build: process.env.BUILD,
  at: new Date().toISOString(),
  cases: [],
  pageErrors: [],
};
const ctx = await chromium.launchPersistentContext(
  process.env.PROFILE || '.cache/photo-eval-profile',
  {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ['--enable-unsafe-webgpu'],
  },
);
if (process.env.FORWARD_ORIGIN) {
  const origin = new URL(base).origin;
  await ctx.route(`${origin}/**`, async (route) => {
    await route.fulfill({
      response: await route.fetch({
        url: route.request().url().replace(origin, process.env.FORWARD_ORIGIN),
      }),
    });
  });
}
await ctx.addInitScript((choice) => {
  localStorage.setItem('room-ggu-model-choice', choice);
  if (choice !== 'off') localStorage.removeItem('room-ggu-model');
  localStorage.removeItem('room-ggu-v2');
  localStorage.removeItem('room-ggu-thread-v1');
  const NativeWorker = window.Worker;
  window.__qaWorker = [];
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => {
        if (data.qa || data.id) window.__qaWorker.push(data);
      });
    }
    postMessage(data, ...args) {
      if (data.task === 'interpret') {
        data.payload.qa = true;
        window.__qaWorker.push({
          request: data.task,
          id: data.id,
          historyChars: JSON.stringify(data.payload.history).length,
        });
      }
      return super.postMessage(data, ...args);
    }
  };
}, model);
const page = ctx.pages()[0] || (await ctx.newPage());
page.on('pageerror', (e) => report.pageErrors.push(e.message));
const save = () => writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
const roomSize = (r) => [r.w, r.d, r.h];
const layout = (state) =>
  spaces(state)
    .map(({ roomId, room, items }) => ({ roomId, room, items }))
    .sort((a, b) => a.roomId.localeCompare(b.roomId));
const furniture = (s, id) =>
  spaces(s)
    .flatMap((r) => r.items)
    .find((i) => i.id === id);
function check(expect, prior, next) {
  const { state, draft, queue, turn } = next;
  if (expect.unchanged) {
    deepEqual(layout(state), layout(prior.state), '방/가구 배치 유지');
    deepEqual(draft, prior.draft, '초안 유지');
    deepEqual(queue, prior.queue, '대기열 유지');
  }
  if (expect.active) equal(state.roomId, expect.active, '활성 방');
  if (expect.room) deepEqual(roomSize(state.room), expect.room, '방 치수');
  if (expect.floor) equal(state.room.floorColor, expect.floor, '바닥 색');
  if (expect.area)
    ok(Math.abs((state.room.w * state.room.d) / expect.area - 1) < 0.02, '면적 오차 2% 이내');
  if (expect.bed)
    deepEqual(furniture(state, expect.bed[0])?.dims, expect.bed.slice(1), '지정한 침대 치수');
  for (const id of expect.kept || [])
    deepEqual(furniture(state, id), furniture(prior.state, id), `${id} 유지`);
  if (expect.draft) {
    equal(draft?.type, expect.draft[0], '초안 가구 종류');
    expect.draft.slice(1).forEach((n, i) => {
      if (n !== null) equal(draft.dims[i], n, `가구 치수 축 ${i}`);
    });
  }
  if (expect.queue)
    deepEqual(
      queue.map((i) => i.type),
      expect.queue,
      '대기 가구',
    );
  if (expect.ask) ok(new RegExp(expect.ask).test(turn.text), '범위를 좁혀 되묻기');
}
async function read() {
  return page.evaluate(() => {
    const a = window.__roomggu.app;
    return {
      state: a.state,
      draft: a.draft,
      queue: a.queue,
      turn: a.thread.findLast((t) => t.role === 'assistant'),
    };
  });
}
try {
  const started = Date.now();
  await page.goto(model === 'off' ? new URL('?model=off', base).href : base);
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.waitForFunction(
    () => ['ready', 'error', 'unsupported', 'off'].includes(window.__roomggu.app.ai.text),
    null,
    { timeout: 240000 },
  );
  report.prepareMs = Date.now() - started;
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const a = window.__roomggu.app.ai;
    return {
      ai: a.text,
      id: a.model,
      error: a.error,
      ua: navigator.userAgent,
      gpu: adapter?.info?.description || adapter?.info?.vendor,
      f16: adapter?.features.has('shader-f16'),
    };
  });
  console.log('model', JSON.stringify(report.environment), report.prepareMs);
  if (model !== 'off' && report.environment.ai !== 'ready') throw Error('실제 모델 준비 실패');
  for (const scenario of selected) {
    await page.evaluate((s) => {
      const { app, store } = window.__roomggu;
      Object.assign(app, {
        state: s,
        thread: [],
        draft: null,
        queue: [],
        design: null,
        selected: null,
        history: [],
        future: [],
      });
      store.setTarget({ type: 'room' });
      store.emit();
    }, seed(scenario.seed));
    for (const t of scenario.turns) {
      const prior = await read();
      const chat = page.locator('#chat-input');
      await chat.fill(t.text);
      await page.evaluate(() => {
        window.__qaWorker.length = 0;
        const m = { start: performance.now(), frames: [], longTasks: [], running: true };
        window.__qaTiming = m;
        let prev = m.start;
        const frame = (now) => {
          if (!m.running) return;
          m.frames.push(now - prev);
          prev = now;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        m.observer = new PerformanceObserver((list) =>
          m.longTasks.push(...list.getEntries().map((e) => e.duration)),
        );
        m.observer.observe({ type: 'longtask' });
      });
      await chat.press('Enter');
      let gridMs = null;
      if (model !== 'off' && (await page.evaluate(() => !!window.__roomggu.app.busy))) {
        const grid = page.locator('#grid');
        const before = await grid.getAttribute('aria-pressed');
        const startedClick = performance.now();
        await grid.click({ force: true });
        await page.waitForFunction(
          (prior) => document.getElementById('grid')?.getAttribute('aria-pressed') !== prior,
          before,
        );
        gridMs = Math.round(performance.now() - startedClick);
      }
      await page.waitForFunction(
        (text) => {
          const a = window.__roomggu.app;
          const i = a.thread.findLastIndex((turn) => turn.role === 'user' && turn.text === text);
          return !a.busy && i >= 0 && a.thread[i + 1]?.status === 'done';
        },
        t.text,
        { timeout: 35000 },
      );
      const observed = await page.evaluate(() => {
        const m = window.__qaTiming;
        m.running = false;
        m.observer.disconnect();
        return {
          ms: performance.now() - m.start,
          frameMs: m.frames,
          longTasks: m.longTasks,
          worker: window.__qaWorker,
        };
      });
      const next = await read();
      const { turn, state, draft, queue } = next;
      const calls = observed.worker.filter((e) => e.request === 'interpret');
      const raw = observed.worker.findLast((e) => typeof e.result === 'string')?.result;
      const usage = observed.worker.findLast((e) => e.qa)?.qa;
      let rawPlan;
      try {
        rawPlan = JSON.parse(raw?.replace(/^\s*<think>[\s\S]*?<\/think>\s*/u, ''));
      } catch {}
      const r = {
        id: scenario.id,
        text: t.text,
        expected: t.expect,
        ms: Math.round(observed.ms),
        gridMs,
        frameMs: observed.frameMs.map(Math.round),
        longTasks: observed.longTasks,
        usage,
        calls,
        retries: Math.max(0, calls.length - 1),
        raw,
        modelMatch:
          t.model &&
          Object.fromEntries(Object.entries(t.model).map(([k, v]) => [k, rawPlan?.[k] === v])),
        engine: turn.engine,
        fallback: turn.fallback,
        fixes: turn.fixes || [],
        reply: turn.text,
        state: layout(state),
        active: state.roomId,
        draft: draft && { type: draft.type, dims: draft.dims, sources: draft.sources },
        queue: queue.map((i) => i.type),
        passed: false,
      };
      try {
        check(t.expect, prior, next);
        r.passed = true;
      } catch (e) {
        r.failure = e.message;
      }
      if (t.place) {
        try {
          await page
            .getByRole('button', { name: '모두 놓기', exact: true })
            .click({ timeout: 2500 });
          const placed = await read();
          if (t.place.unchanged) {
            deepEqual(layout(placed.state), layout(state));
            deepEqual(placed.draft, draft);
            deepEqual(placed.queue, queue);
            ok(placed.turn.text.includes('빈자리가 없어요'));
          } else {
            for (const [type, count] of Object.entries(t.place.count))
              equal(placed.state.items.filter((i) => i.type === type).length, count);
            equal(placed.draft, null, '배치 뒤 초안 정리');
            deepEqual(placed.queue, [], '배치 뒤 대기열 정리');
            ok(placed.turn.text.includes('방에 놓았어요') && placed.turn.tone !== 'error');
          }
          if (t.place.undo) {
            await page.evaluate(() => window.__roomggu.store.undo());
            deepEqual(layout((await read()).state), layout(state));
          }
          r.placement = true;
        } catch (e) {
          r.placement = false;
          r.placementFailure = e.message;
        }
      }
      report.cases.push(r);
      save();
      console.log(scenario.id, t.text, r.passed, r.ms, r.engine, r.fallback || '', r.failure || '');
    }
  }
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
  console.error(e.message);
} finally {
  save();
  await ctx.close();
}
