// 실제 설치 모델 전용 평가. 응답을 흉내 내거나 규칙 대체를 모델 성공으로 세지 않는다.
// npm run build && npm run preview 후 실행. MODEL=large|light|qwen|balanced F16=off 선택 가능.
// PROFILE은 평가 전용 Chrome 프로필. 기존 캐시의 origin을 쓸 때만 FORWARD_ORIGIN으로 로컬 빌드를 연결한다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { TYPES } from '../../src/catalog.js';
import { THEMES } from '../../src/app/design.js';
import { validateState, spaces, layoutWarnings } from '../../src/data.js';
import { floorplanWarnings } from '../../src/floorplan.js';
import { TOOL_COMPONENTS } from '../../src/a2ui-catalog.js';
const model = process.env.MODEL || 'large',
  base = process.argv[2] || 'http://127.0.0.1:4180/';
const out = path.resolve(
  process.argv[3] ||
    `eval/chat/results/full-qa-${model}${process.env.F16 === 'off' ? '-f32' : ''}.json`,
);
const ctx = await chromium.launchPersistentContext(
  process.env.PROFILE || `.cache/full-qa-${model}`,
  {
    channel: 'chrome',
    headless: process.env.HEADLESS !== '0',
    args: ['--enable-unsafe-webgpu'],
    viewport: { width: 1440, height: 900 },
  },
);
const origin = new URL(base).origin;
if (process.env.FORWARD_ORIGIN || process.env.F16 === 'off')
  await ctx.route(`${origin}/**`, async (route) => {
    const url = route
        .request()
        .url()
        .replace(origin, process.env.FORWARD_ORIGIN || origin),
      res = await route.fetch({ url });
    if (process.env.F16 === 'off' && /\.js(?:\?|$)/.test(url)) {
      const body = (await res.text()).replace(
        /features\.has\((["'])shader-f16\1\)/g,
        'features.has("qa-force-f32")',
      );
      await route.fulfill({ response: res, body });
    } else await route.fulfill({ response: res });
  });
const page = ctx.pages()[0] || (await ctx.newPage()),
  errors = [],
  results = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((choice) => {
  localStorage.setItem('room-ggu-model-choice', choice);
  localStorage.removeItem('room-ggu-model');
  localStorage.removeItem('room-ggu-v2');
  localStorage.removeItem('room-ggu-thread-v1');
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => {
        if (typeof e.data.result === 'string') window.__qaRaw = e.data.result;
      });
    }
  };
}, model);
const started = Date.now();
const flush = () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        model,
        base,
        build: process.env.BUILD || null,
        ms: Date.now() - started,
        results,
        errors,
      },
      null,
      2,
    ),
  );
};
async function say(text, { engine = true, check } = {}) {
  const t = Date.now();
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !window.__roomggu.app.busy, null, { timeout: 110000 });
  const data = await page.evaluate(() => {
    const { app } = window.__roomggu;
    return {
      turn: [...app.thread].reverse().find((t) => t.role === 'assistant'),
      state: app.state,
      design: app.design,
      raw: window.__qaRaw,
      model: app.ai.model,
      draft: app.draft,
      queue: app.queue,
    };
  });
  const record = {
    text,
    ms: Date.now() - t,
    engine: data.turn.engine,
    fallback: data.turn.fallback,
    note: data.turn.note,
    reply: data.turn.text,
    fixes: data.turn.fixes,
    raw: data.raw,
    model: data.model,
    passed: false,
  };
  try {
    if (engine)
      assert.ok(
        ['gemma', 'qwen'].includes(data.turn.engine) && !data.turn.fallback,
        '실제 모델 추론이어야 함',
      );
    assert.notEqual(data.turn.tone, 'error', data.turn.text);
    const tools = (data.turn.surfaces || []).map((s) => ({
      surfaceId: `tool-${s.id}`,
      component: TOOL_COMPONENTS[s.kind],
    }));
    // 모델의 계획이 최종 카드까지 공식 A2UI 경로로 이어졌는지도 확인한다.
    await page.waitForFunction(
      ({ turnId, tools }) => {
        const turn = [...document.querySelectorAll('[data-turn]')].find(
          (n) => n.dataset.turn === turnId,
        );
        if (!turn || turn.querySelector('[aria-label="도구 오류"]')) return false;
        const cards = [...turn.querySelectorAll('[data-a2ui-surface]')];
        return tools.every((tool) =>
          cards.some(
            (card) =>
              card.dataset.a2uiSurface === tool.surfaceId &&
              card.dataset.a2uiComponent === tool.component &&
              card.dataset.a2uiVersion === '1.0',
          ),
        );
      },
      { turnId: data.turn.id, tools },
      { timeout: 5000 },
    );
    record.a2ui = tools;
    if (check) await check(data, record);
    record.passed = true;
  } catch (e) {
    record.error = e.message;
  }
  results.push(record);
  flush();
  console.log(JSON.stringify(record));
  return data;
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.__roomggu?.ready());
  for (let i = 0; i < 600; i++) {
    const s = await page.evaluate(() => ({
      status: window.__roomggu.app.ai.text,
      error: window.__roomggu.app.ai.error,
      mb: window.__roomggu.app.ai.download?.mb,
    }));
    if (i % 15 === 0) console.log('model', model, JSON.stringify(s));
    if (s.status === 'ready') break;
    if (['error', 'unsupported', 'off'].includes(s.status))
      throw Error(`실제 모델 실행 실패: ${JSON.stringify(s)}`);
    if (i === 599) throw Error('모델 준비 10분 초과');
    await page.waitForTimeout(1000);
  }
  if (process.env.SCENARIO === 'followup') {
    await say('100평 집 전체를 재팬디로 꾸며줘', {
      check(d) {
        assert.ok(d.design);
        assert.deepEqual(d.design.omitted, []);
      },
    });
    await say('초안 적용해줘', { engine: false });
    await say('안방 침대 가로 180cm로 바꿔줘', {
      check(d) {
        assert.equal(d.state.name, '안방');
        assert.equal(d.state.items.find((i) => i.type === 'bed').dims[0], 180);
      },
    });
    await say('높이는 60cm로 바꿔줘', {
      check(d) {
        assert.equal(d.state.items.find((i) => i.type === 'bed').dims[1], 60);
        assert.equal(d.state.room.h, 2.5);
      },
    });
    await say('네이비로 바꿔줘', {
      check(d) {
        assert.equal(d.state.items.find((i) => i.type === 'bed').color, '#3f4d63');
        assert.equal(d.state.items.find((i) => i.type === 'bed').dims[1], 60);
      },
    });
  }
  if (process.env.SCENARIO !== 'catalog' && process.env.SCENARIO !== 'followup') {
    for (const [key, theme] of Object.entries(THEMES)) {
      await say(`100평 집 전체를 ${theme.name} 테마로 빠짐없이 인테리어해줘`, {
        check(d, r) {
          const p = d.design;
          assert.ok(p && !p.applied, '새 초안');
          assert.equal(p.theme, key);
          assert.deepEqual(p.omitted, [], '가구 누락 없음');
          const s = validateState(p.state),
            list = spaces(s);
          assert.equal(list.length, 12);
          assert.equal(floorplanWarnings(list, s.floorplan).size, 0);
          for (const room of list)
            assert.equal(
              layoutWarnings({
                ...s,
                ...room,
                otherRooms: list.filter((r) => r.roomId !== room.roomId),
              }).all.size,
              0,
              room.name,
            );
          const area = list.reduce((n, x) => n + x.room.w * x.room.d, 0);
          assert.ok(Math.abs(area / 3.3058 - 100) < 0.2);
          Object.assign(r, {
            areaM2: area,
            rooms: list.map((x) => ({ name: x.name, type: x.room.type, items: x.items.length })),
            items: list.reduce((n, x) => n + x.items.length, 0),
            omitted: p.omitted,
          });
        },
      });
      await say('이대로 적용해줘', {
        engine: false,
        check(d) {
          assert.equal(spaces(d.state).length, 12);
          assert.equal(d.design.applied, true);
        },
      });
    }
    await say(
      '100평 집 전체를 침실 3개 욕실 2개로 구성하고 가족들이 책 읽기 좋은 재팬디로 인테리어해줘',
      {
        check(d) {
          assert.ok(d.design && !d.design.applied);
          const rooms = spaces(d.design.state);
          assert.equal(rooms.filter((r) => r.room.type === 'bedroom').length, 3);
          assert.equal(rooms.filter((r) => r.room.type === 'bathroom').length, 2);
          assert.deepEqual(d.design.omitted, []);
          assert.ok(
            rooms.some(
              (r) =>
                ['living', 'bedroom', 'office'].includes(r.room.type) &&
                r.items.some((i) => i.type === 'armchair') &&
                r.items.some((i) => i.type === 'shelf'),
            ),
            '독서용 좌석과 책장을 함께 구성',
          );
        },
      },
    );
    await say('초안 적용해줘', { engine: false });
    await say('안방 침대 가로 180cm로 바꿔줘', {
      check(d) {
        assert.equal(d.state.name, '안방');
        assert.equal(d.state.items.filter((i) => i.type === 'bed').length, 1);
        assert.equal(d.state.items.find((i) => i.type === 'bed').dims[0], 180);
        assert.equal(d.draft, null);
      },
    });
    await say('안방 침대 네이비로 바꿔줘', {
      check(d) {
        assert.equal(d.state.items.find((i) => i.type === 'bed').color, '#3f4d63');
        assert.equal(d.state.items.find((i) => i.type === 'bed').dims[0], 180);
      },
    });
    await say('다이닝룸 의자 색을 화이트로 바꿔줘', {
      check(d) {
        assert.equal(d.state.name, '다이닝룸');
        assert.match(d.turn.text, /먼저 골라/);
        assert.equal(d.draft, null);
      },
    });
    await say('거실 벽은 세이지로 바꿔줘', {
      check(d) {
        assert.equal(d.state.name, '거실');
        assert.equal(d.state.room.wallColor, '#c0cbbb');
      },
    });
    await say('소파랑 식탁이랑 책상이랑 의자랑 책장이랑 화분이랑 조명 놓고 싶어', {
      check(d) {
        assert.ok(d.draft);
        assert.equal(d.queue.length, 6);
      },
    });
    const before = await page.evaluate(() => window.__roomggu.app.state.items.length);
    await say('모두 놓아줘', {
      check(d) {
        assert.equal(d.state.items.length, before + 7);
        assert.equal(d.queue.length, 0);
        assert.equal(d.draft, null);
      },
    });
    await say('되돌려줘', {
      check(d) {
        assert.equal(d.state.items.length, before);
      },
    });
    await say('집 전체 빈티지 말고 미니멀로 바꿔줘', {
      check(d) {
        assert.equal(d.design.theme, 'minimal');
        assert.equal(d.design.mode, 'theme');
      },
    });
    await say('초안 적용해줘', { engine: false });
  }
  if (process.env.SCENARIO === 'catalog' || process.env.CATALOG === '1') {
    for (const [type, info] of Object.entries(TYPES))
      await say(`새로 ${info.name} 하나 놓고 싶어`, {
        check(d, r) {
          assert.ok(d.draft, '가구 초안');
          assert.equal(d.draft.type, type);
          assert.ok(d.draft.dims.every((n) => Number.isFinite(n) && n >= 1 && n <= 1500));
          r.furniture = type;
          r.dims = d.draft.dims;
        },
      });
  }
  await page.screenshot({ path: `.cache/full-qa-${model}-desktop.png` });
  console.log(
    'SUMMARY',
    JSON.stringify({
      model,
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      errors,
    }),
  );
} catch (e) {
  errors.push(e.stack || e.message);
  console.error(e);
} finally {
  flush();
  await ctx.close();
}
if (errors.length || results.some((r) => !r.passed)) process.exitCode = 1;
