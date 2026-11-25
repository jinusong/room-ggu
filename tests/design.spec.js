import { test, expect } from '@playwright/test';
const ready = (page) => page.waitForFunction(() => window.__roomggu?.ready());
const state = (page) => page.evaluate(() => structuredClone(window.__roomggu.app.state));
const proposal = (page) => page.evaluate(() => structuredClone(window.__roomggu.app.design));
const frames = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !window.__roomggu.app.busy);
}
async function start(page) {
  await page.goto('/?model=off');
  await ready(page);
}
const list = (s) => [s, ...s.otherRooms];

for (const width of [1440, 1024, 900, 390, 320])
  test(`${width}px: 집 전체 상담 → 초안 확인 → 적용 → 실행 취소 → 복원`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 900 });
    await start(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const initial = await state(page);
    await say(page, '100평 집 전체를 재팬디로 인테리어해줘');
    const panel = page.locator('[data-surface=design]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.design-rooms li')).toHaveCount(12);
    await expect(panel).toContainText('약 100.0평');
    expect(await state(page)).toEqual(initial);
    // 모델을 끈 UI 회귀 검사: 실제 모델 성능 검사와 별개로 명시한다.
    await expect(page.locator('.msg.assistant').last()).toContainText(
      '상담 모델을 쓰지 않은 기본 구성',
    );
    await page.getByRole('button', { name: '초안 적용', exact: true }).click();
    const applied = await state(page);
    expect(list(applied)).toHaveLength(12);
    expect(applied.scope).toBe('house');
    expect(list(applied).every((r) => r.items.length > 0)).toBe(true);
    await expect(page.getByRole('button', { name: '적용됨', exact: true })).toBeDisabled();
    await page.evaluate(() => window.__roomggu.store.undo());
    expect(await state(page)).toEqual(initial);
    await page.evaluate(() => window.__roomggu.store.redo());
    expect(await state(page)).toEqual(applied);
    await page.reload();
    await ready(page);
    expect(await state(page)).toEqual(applied);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(errors).toEqual([]);
  });

test('작은 집 초안은 욕실 설비를 넣고 생략한 공간을 알린다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const before = await state(page);
  await say(page, '40m² 집 전체를 재팬디로 꾸며줘');
  const panel = page.locator('[data-surface=design]');
  const bath = panel.locator('.design-rooms li').filter({ hasText: '공용 욕실' });
  await expect(bath).toContainText('샤워부스');
  const notice = panel.getByRole('status').filter({ hasText: '면적이 모자라 뺀 공간' });
  await expect(notice).toContainText(/드레스룸.*다용도실|다용도실.*드레스룸/);
  expect(await state(page)).toEqual(before);
  await panel.getByRole('button', { name: '초안 적용' }).click();
  const applied = list(await state(page));
  expect(applied).toHaveLength(4);
  expect(applied.find((r) => r.name === '공용 욕실').items.map((i) => i.type)).toContain('shower');
  await page.evaluate(() => window.__roomggu.store.undo());
  expect(await state(page)).toEqual(before);
});

test('초안은 새로고침 뒤에도 적용할 수 있고, 배치 편집 뒤에는 오래된 초안으로 덮어쓰지 않는다', async ({
  page,
}) => {
  await start(page);
  await say(page, '100평 집 전체를 북유럽 스타일로 꾸며줘');
  await page.reload();
  await ready(page);
  await expect(page.getByRole('button', { name: '초안 적용', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    store.select(app.state.items[0].id);
  });
  await page.locator('#rotate').click();
  await expect(page.getByRole('button', { name: '초안 적용', exact: true })).toBeDisabled();
  await expect(page.locator('[data-surface=design]')).toContainText('배치가 바뀌었어요');
  await say(page, '초안 적용해줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('배치가 바뀌었어요');
  expect(list(await state(page))).toHaveLength(1);
});

test('상담만으로 집을 적용하고 전체 테마를 바꾸며 치수·위치·직접 설정 출처를 보존한다', async ({
  page,
}) => {
  await start(page);
  await say(page, '100평 집 전체를 내추럴로 꾸며줘');
  await say(page, '이대로 적용해줘');
  const before = await state(page);
  await say(page, '집 전체 빈티지 말고 모던으로 바꿔줘');
  await expect(page.locator('[data-surface=design]')).toContainText('모던');
  await say(page, '초안 적용해줘');
  const after = await state(page);
  expect(after.floorplan).toEqual(before.floorplan);
  expect(
    list(after).map((r) => [
      r.roomId,
      r.room.w,
      r.room.d,
      r.items.map((i) => [i.id, i.dims, i.x, i.z, i.angle]),
    ]),
  ).toEqual(
    list(before).map((r) => [
      r.roomId,
      r.room.w,
      r.room.d,
      r.items.map((i) => [i.id, i.dims, i.x, i.z, i.angle]),
    ]),
  );
  expect(after.room.wallColor).toBe('#d5d2cb');
});

test('100평 집의 방 12개를 하나의 평면도에서 가구를 직접 끌고 한 번에 되돌린다', async ({
  page,
}) => {
  await start(page);
  await say(page, '100평 집 전체를 코지로 꾸며줘');
  await say(page, '초안 적용해줘');
  const rooms = list(await state(page));
  for (const room of rooms) {
    await page.evaluate((id) => {
      const { store } = window.__roomggu;
      store.switchSpace(id);
    }, room.roomId);
    await frames(page);
    const before = await state(page),
      item = before.items.find((i) => i.type !== 'rug');
    const point = await page.evaluate((id) => {
      const { app } = window.__roomggu;
      const p = app.scenes.house.anchor(id, { center: true });
      return { ...p, scale: app.scenes.house.scale };
    }, item.id);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + point.scale * 0.25, point.y + point.scale * 0.25, { steps: 8 });
    await page.mouse.up();
    const next = await state(page),
      moved = next.items.find((i) => i.id === item.id);
    expect(moved.x !== item.x || moved.z !== item.z, room.name).toBe(true);
    expect(moved.dims).toEqual(item.dims);
    await page.evaluate(() => window.__roomggu.store.undo());
    expect((await state(page)).items).toEqual(before.items);
  }
});

test('모델 선택은 첫 화면에서 열고 네 후보의 크기와 실행 차이를 확인한다', async ({
  page,
  context,
}) => {
  // 모델 카드 조작 뒤 새로고침 복원까지 포함하는 전체 시나리오의 한도다.
  test.setTimeout(60_000);
  const requests = [];
  await context.route(/huggingface\.co|raw\.githubusercontent\.com/, (r) => {
    requests.push(r.request().url());
    r.abort();
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', {
      value: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) },
      configurable: true,
    }),
  );
  await start(page);
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    store.select(app.state.items[0].id);
  });
  const itemsBefore = (await state(page)).items;
  await page.getByRole('button', { name: '상담 모델 선택', exact: true }).click();
  const radios = page.getByRole('radio');
  await expect(radios).toHaveCount(4);
  await expect(page.getByRole('radio', { name: /Gemma 4 E2B/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: /^Qwen3 0.6B/ })).toContainText('350MB');
  await expect(page.locator('[data-model=light]')).toContainText('f16 미지원');
  await page.getByRole('radio', { name: /Gemma 4 E2B/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-model=qwen]')).toBeFocused();
  await expect(page.locator('[data-model=qwen]')).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).items).toEqual(itemsBefore);
  expect(await page.evaluate(() => localStorage.getItem('room-ggu-model-choice'))).toBe('qwen');
  await page.reload();
  // 모델 설정 복원은 앱 초기화 직후 확인한다. 이 검사에는 3D 준비를 기다릴 필요가 없다.
  await page.waitForFunction(() => !!window.__roomggu?.app);
  expect(await page.evaluate(() => window.__roomggu.app.ai.choice)).toBe('qwen');
});

test('면적 누락·범위 초과·지원 개수 초과는 배치를 바꾸지 않고 구체적으로 답한다', async ({
  page,
}) => {
  await start(page);
  const before = await state(page);
  for (const [text, message] of [
    ['집 전체 인테리어해줘', '면적'],
    ['1000평 집 전체를 꾸며줘', '40~660'],
    ['100평 집전체 침실 9개 욕실 8개 인테리어해줘', '최대 12개'],
  ]) {
    await say(page, text);
    await expect(page.locator('.msg.assistant').last()).toContainText(message);
    expect(await state(page)).toEqual(before);
  }
});

test('방 이름과 가구를 한 문장으로 지정하면 그 방의 기존 가구를 고치고, 같은 종류가 여럿이면 되묻는다', async ({
  page,
}) => {
  await start(page);
  await say(page, '100평 집 전체를 내추럴로 꾸며줘');
  await say(page, '초안 적용해줘');
  await say(page, '안방 침대 가로 180cm로 바꿔줘');
  const s = await state(page);
  expect(s.name).toBe('안방');
  expect(s.items.filter((i) => i.type === 'bed')).toHaveLength(1);
  expect(s.items.find((i) => i.type === 'bed').dims[0]).toBe(180);
  expect(await page.evaluate(() => window.__roomggu.app.draft)).toBe(null);
  await expect(page.locator('.target.is-item')).toContainText('침대');
  await say(page, '높이는 60cm로 바꿔줘');
  expect((await state(page)).items.find((i) => i.type === 'bed').dims).toEqual([180, 60, 200]);
  expect((await state(page)).room.h).toBe(2.5);
  await say(page, '다이닝룸 의자 색을 화이트로 바꿔줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('먼저 골라');
  expect((await state(page)).items.filter((i) => i.type === 'chair')).toHaveLength(4);
});

test('가구 일곱 개를 한 번에 설명해도 빠뜨리지 않고, 새로고침 후 모두 놓기·되돌리기를 한다', async ({
  page,
}) => {
  await start(page);
  await say(page, '거실 가로 12m 세로 10m로 바꿔줘');
  const n = (await state(page)).items.length;
  await say(page, '소파랑 식탁이랑 책상이랑 의자랑 책장이랑 화분이랑 조명 놓고 싶어');
  expect(await page.evaluate(() => window.__roomggu.app.queue.length)).toBe(6);
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.__roomggu.app.queue.length)).toBe(6);
  await say(page, '모두 놓아줘');
  expect((await state(page)).items).toHaveLength(n + 7);
  await say(page, '되돌려줘');
  expect((await state(page)).items).toHaveLength(n);
});

async function delayedModel(page) {
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage(m) {
        if (m.task === 'interpret') window.__qaPending = { worker: this, message: m };
      }
      terminate() {}
    };
  });
  await start(page);
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    app.ai.text = 'ready';
    app.ai.model = 'gemma-4-E2B-it-q4f16_1-MLC';
    store.select(app.state.items.find((i) => i.type === 'desk').id);
    store.emit();
  });
}
async function finishDelayed(page) {
  await page.evaluate(() => {
    const { worker, message } = window.__qaPending;
    worker.onmessage({
      data: {
        id: message.id,
        result: JSON.stringify({
          intent: 'furniture',
          action: 'none',
          furniture: 'desk',
          size: 'unknown',
          depth: 'unknown',
          height: 'unknown',
          color: 'none',
          wall: 'none',
          floor: 'none',
          room_type: 'none',
          seats: null,
          space: 'none',
          ui: 'furniture_dims',
          reply: '책상 너비를 맞췄어요.',
        }),
      },
    });
  });
  await page.waitForFunction(() => !window.__roomggu.app.busy);
}

test('모델이 답하는 사이 다른 가구를 골라도 응답을 새 대상에 덮어쓰지 않는다', async ({ page }) => {
  await delayedModel(page);
  await page.locator('#chat-input').fill('가로 140cm로 바꿔줘');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !!window.__qaPending);
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    store.select(app.state.items.find((i) => i.type === 'bed').id);
  });
  await finishDelayed(page);
  const s = await state(page);
  expect(s.items.find((i) => i.type === 'desk').dims[0]).toBe(140);
  expect(s.items.find((i) => i.type === 'bed').dims[0]).toBe(150);
});

test('모델을 기다리면서 직접 치수를 고쳤으면 늦은 응답으로 직접 편집을 덮어쓰지 않는다', async ({
  page,
}) => {
  await delayedModel(page);
  await page.locator('#chat-input').fill('가로 140cm로 바꿔줘');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !!window.__qaPending);
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    const i = app.state.items.find((i) => i.type === 'desk');
    store.setItemDim({ type: 'item', id: i.id }, 0, 160);
  });
  await finishDelayed(page);
  expect((await state(page)).items.find((i) => i.type === 'desk').dims[0]).toBe(160);
  await expect(page.locator('.msg.assistant').last()).toContainText('상담 중에 배치가 바뀌었어요');
});

test('모델을 빠르게 바꾸면 이전 로딩의 취소 오류가 새 모델의 준비 상태를 망치지 않는다', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__qaWorkers = [];
    window.Worker = class {
      constructor() {
        window.__qaWorkers.push(this);
      }
      postMessage(m) {
        this.message = m;
      }
      terminate() {
        this.stopped = true;
      }
    };
  });
  await start(page);
  await page.evaluate(() => {
    const { store } = window.__roomggu;
    store.setModelChoice('qwen');
    store.setModelChoice('light');
  });
  await expect.poll(() => page.evaluate(() => window.__roomggu.app.ai.text)).toBe('loading');
  await page.evaluate(() => {
    const w = window.__qaWorkers.at(-1);
    w.onmessage({ data: { id: w.message.id, result: 'gemma3-1b-it-q4f16_1-MLC' } });
  });
  await expect.poll(() => page.evaluate(() => window.__roomggu.app.ai.text)).toBe('ready');
  expect(await page.evaluate(() => window.__roomggu.app.ai.choice)).toBe('light');
  expect(await page.evaluate(() => window.__roomggu.app.ai.error)).toBe('');
});

test('집 전체 상담을 취소하면 늦은 모델 응답으로 초안이나 배치를 만들지 않는다', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage(m) {
        if (m.task === 'design') window.__qaPending = { worker: this, message: m };
      }
      terminate() {}
    };
  });
  await start(page);
  const before = await state(page);
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    app.ai.text = 'ready';
    app.ai.model = 'gemma-4-E2B-it-q4f16_1-MLC';
    store.emit();
  });
  await page.locator('#chat-input').fill('100평 집 전체를 모던으로 꾸며줘');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !!window.__qaPending);
  await page.locator('.thinking').getByRole('button', { name: '취소', exact: true }).click();
  await page.evaluate(() => {
    const { worker, message } = window.__qaPending;
    worker.onmessage({
      data: {
        id: message.id,
        result: JSON.stringify(
          Object.fromEntries([
            ['theme', 'modern'],
            ...Array.from({ length: 12 }, (_, i) => [`room${i + 1}`, 'standard']),
          ]),
        ),
      },
    });
  });
  expect(await state(page)).toEqual(before);
  expect(await proposal(page)).toBe(null);
  await expect(page.locator('.msg.assistant').last()).toContainText('멈췄어요');
});

test('상담 도중 새 대화를 시작하면 예전 모델 응답과 초안이 다시 나타나지 않는다', async ({
  page,
}) => {
  await delayedModel(page);
  const before = await state(page);
  await page.locator('#chat-input').fill('가로 140cm로 바꿔줘');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !!window.__qaPending);
  await page.getByRole('button', { name: '새 대화', exact: true }).click();
  await page.getByRole('button', { name: '대화 지우기', exact: true }).click();
  await finishDelayed(page);
  expect(await state(page)).toEqual(before);
  await expect(page.locator('.msg.assistant')).toHaveCount(0);
});

for (const width of [1440, 390])
  test(`${width}px: 상담으로 만든 가구를 평면도에서 끌고 되돌린다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await start(page);
    await say(page, '100평 집 전체를 내추럴로 꾸며줘');
    await say(page, '초안 적용해줘');
    if (width < 900) await page.evaluate(() => window.__roomggu.store.setSheet('peek'));
    // 시트를 낮추는 동안 도면 축척이 바뀐다. 실제 배치가 멈춘 뒤 보이는 가구 중심을 잡는다.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    await frames(page);
    const before = await state(page),
      item = before.items.find((i) => i.type === 'sofa');
    const p = await page.evaluate((id) => window.__roomggu.anchor(id, { center: true }), item.id);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 32, p.y + 28, { steps: 10 });
    await page.mouse.up();
    const moved = (await state(page)).items.find((i) => i.id === item.id);
    expect(moved.x !== item.x || moved.z !== item.z).toBe(true);
    await page.evaluate(() => window.__roomggu.store.undo());
    expect((await state(page)).items).toEqual(before.items);
  });
